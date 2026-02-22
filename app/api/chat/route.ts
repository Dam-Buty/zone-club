import { cookies } from 'next/headers';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserFromSession } from '@/lib/session';
import { buildSystemPrompt } from '@/lib/chat';
import { createChatTools } from '@/lib/chat-tools';
import { createSession, appendMessages, getCurrentSession } from '@/lib/chat-history';
import { db } from '@/lib/db';

const CHAT_MODEL = process.env.CHAT_MODEL || 'z-ai/glm-4.7-flash';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get('session')?.value);
  if (!user) {
    return new Response(JSON.stringify({ message: 'Non authentifié' }), { status: 401 });
  }

  const body = await req.json();
  const { messages, events } = body;

  // Get user credits
  const userData = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };

  // Get or create chat session
  let session = getCurrentSession(user.id);
  if (!session) {
    const sessionId = createSession(user.id);
    session = { id: sessionId, user_id: user.id, raw_messages: '[]', summary: null, started_at: '', ended_at: null };
  }

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
        langfuseUserId: String(user.id),
        langfuseSessionId: String(session!.id),
      },
    },
    onFinish: async ({ text }) => {
      // Persist messages to DB
      const lastUserMsg = messages[messages.length - 1];
      const toStore: { role: string; content: string }[] = [];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        const userContent = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : lastUserMsg.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '';
        toStore.push({ role: 'user', content: userContent });
      }
      if (text) {
        toStore.push({ role: 'assistant', content: text });
      }
      if (toStore.length > 0) {
        appendMessages(session!.id, toStore);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
