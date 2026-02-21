import { cookies } from 'next/headers';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserFromSession } from '@/lib/session';
import { getCurrentSession, closeSession } from '@/lib/chat-history';

const CHAT_MODEL = process.env.CHAT_MODEL || 'z-ai/glm-4.7-flash';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get('session')?.value);
  if (!user) {
    return new Response(null, { status: 401 });
  }

  const session = getCurrentSession(user.id);
  if (!session) {
    return new Response(null, { status: 204 });
  }

  const messages = JSON.parse(session.raw_messages);
  if (messages.length === 0) {
    closeSession(session.id, '');
    return new Response(null, { status: 204 });
  }

  // Try LLM compaction
  let summary: string;
  try {
    const result = await generateText({
      model: openrouter.chat(CHAT_MODEL),
      system: 'Resume cette conversation de videoclub en 2-3 phrases concises en francais. Mentionne les films discutes, les locations effectuees, et les sujets abordes. Pas de mise en forme, juste du texte brut.',
      messages: [
        {
          role: 'user',
          content: messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n'),
        },
      ],
    });
    summary = result.text;
  } catch {
    // Fallback: basic summary
    const filmMentions = messages
      .filter((m: { role: string; content: string }) => m.role === 'assistant')
      .map((m: { content: string }) => m.content)
      .join(' ')
      .slice(0, 200);
    summary = `Conversation avec ${messages.length} messages. ${filmMentions}...`;
  }

  closeSession(session.id, summary);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
