import { cookies } from 'next/headers';
import { after } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserFromSession, getUserFromApiKey } from '@/lib/session';
import { buildSystemPrompt } from '@/lib/chat';
import { createChatTools } from '@/lib/chat-tools';
import { db } from '@/lib/db';
import { langfuseSpanProcessor } from '@/instrumentation';

const CHAT_MODEL = process.env.CHAT_MODEL || 'z-ai/glm-4.7-flash';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = getUserFromApiKey(req) ?? getUserFromSession(cookieStore.get('session')?.value);
  if (!user) {
    return new Response(JSON.stringify({ message: 'Non authentifié' }), { status: 401 });
  }

  const body = await req.json();
  const { messages, events, sessionId } = body;

  // Get user credits
  const userData = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };

  const systemPrompt = buildSystemPrompt({
    userId: user.id,
    username: user.username,
    credits: userData.credits,
  });

  // Inject events as system messages at the start
  const eventMessages = (events || []).map((event: string) => ({
    role: 'system' as const,
    content: `[EVENEMENT] ${event}`,
  }));

  // Strip reasoning parts from assistant messages (OpenRouter doesn't support Responses API format)
  const cleanedMessages = messages.map((msg: any) => {
    if (msg.role === 'assistant' && Array.isArray(msg.parts)) {
      return { ...msg, parts: msg.parts.filter((p: any) => p.type !== 'reasoning') };
    }
    return msg;
  });

  // Convert UI messages to model messages for streamText
  const modelMessages = await convertToModelMessages(cleanedMessages);

  // Prepend event messages
  const allMessages = [...eventMessages, ...modelMessages];

  const tools = createChatTools(user.id);

  const result = streamText({
    model: openrouter.chat(CHAT_MODEL),
    maxOutputTokens: 800,
    system: systemPrompt,
    messages: allMessages,
    tools,
    stopWhen: stepCountIs(5),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat',
      metadata: {
        sessionId: sessionId || undefined,
        userId: String(user.id),
      },
    },
  });

  // Flush Langfuse traces after response is sent
  after(async () => await langfuseSpanProcessor.forceFlush());

  return result.toUIMessageStreamResponse();
}
