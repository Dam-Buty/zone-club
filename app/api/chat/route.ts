import { cookies } from 'next/headers';
import { NextResponse, after } from 'next/server';
import { streamText, convertToModelMessages, isStepCount } from 'ai';
import { propagateAttributes } from '@langfuse/tracing';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserFromSession, getUserFromApiKey } from '@/lib/session';
import { buildSystemPrompt, buildGuestSystemPrompt } from '@/lib/chat';
import { createChatTools, createGuestChatTools } from '@/lib/chat-tools';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { langfuseSpanProcessor } from '@/instrumentation';

const CHAT_MODEL = process.env.CHAT_MODEL || 'z-ai/glm-4.7-flash';

/** Ce que le client envoie : des UIMessages du SDK, dont on ne lit ici que le rôle et les parts. */
interface IncomingMessage {
  role: string;
  parts?: { type: string }[];
  [key: string]: unknown;
}

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = getUserFromApiKey(req) ?? getUserFromSession(cookieStore.get('session')?.value);

  // Rate limit — guests are throttled harder than authed users (they burn
  // OpenRouter credits on our key). API-key callers are not rate-limited
  // (server-to-server use, already authenticated by their key).
  const isApiKey = !!getUserFromApiKey(req);
  if (!isApiKey) {
    const key = user
      ? `chat:user:${user.id}`
      : getRateLimitKey(req, 'chat-guest');
    const maxAttempts = user ? 40 : 8;
    const windowMs = 60 * 60 * 1000; // 1 hour
    const retryAfter = checkRateLimit(key, maxAttempts, windowMs);
    if (retryAfter !== null) {
      return NextResponse.json(
        { error: `Trop de requêtes. Réessayez dans ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
  }

  const body = await req.json();
  const { messages, events, sessionId } = body;

  let systemPrompt: string;
  let tools;

  if (user) {
    // Authenticated path
    const userData = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };
    systemPrompt = buildSystemPrompt({
      userId: user.id,
      username: user.username,
      credits: userData.credits,
    });
    tools = createChatTools(user.id);
  } else {
    // Guest path
    systemPrompt = buildGuestSystemPrompt();
    tools = createGuestChatTools();
  }

  // Inject events as system messages at the start
  const eventMessages = (events || []).map((event: string) => ({
    role: 'system' as const,
    content: `[EVENEMENT] ${event}`,
  }));

  // Strip reasoning parts from assistant messages (OpenRouter doesn't support Responses API format)
  const cleanedMessages = messages.map((msg: IncomingMessage) => {
    if (msg.role === 'assistant' && Array.isArray(msg.parts)) {
      return { ...msg, parts: msg.parts.filter(p => p.type !== 'reasoning') };
    }
    return msg;
  });

  // Convert UI messages to model messages for streamText
  const modelMessages = await convertToModelMessages(cleanedMessages);

  // Prepend event messages
  const allMessages = [...eventMessages, ...modelMessages];

  // sessionId / userId ne passent plus par `telemetry.metadata` : le champ a
  // disparu de TelemetryOptions en AI SDK 7, et Langfuse 5 ne lit de toute façon
  // plus les attributs `ai.telemetry.metadata.*`. La voie actuelle est
  // `propagateAttributes`, qui pose les attributs sur tous les spans ouverts
  // dans son callback — donc sur ceux qu'émet streamText.
  const result = propagateAttributes(
    {
      ...(sessionId ? { sessionId: String(sessionId) } : {}),
      userId: user ? String(user.id) : 'guest',
    },
    () =>
      streamText({
        model: openrouter.chat(CHAT_MODEL),
        maxOutputTokens: 800,
        instructions: systemPrompt,
        messages: allMessages,
        tools,
        stopWhen: isStepCount(5),
        // Pas de `isEnabled: true` : en AI SDK 7 la télémétrie est opt-out dès
        // que l'intégration est enregistrée (cf. instrumentation.ts).
        telemetry: {
          functionId: 'chat',
        },
      }),
  );

  // Flush Langfuse traces after response is sent
  after(async () => await langfuseSpanProcessor.forceFlush());

  return result.toUIMessageStreamResponse();
}
