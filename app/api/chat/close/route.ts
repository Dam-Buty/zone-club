import { cookies } from 'next/headers';
import { getUserFromSession, getUserFromApiKey } from '@/lib/session';
import { langfuseSpanProcessor } from '@/instrumentation';

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = getUserFromApiKey(req) ?? getUserFromSession(cookieStore.get('session')?.value);
  if (!user) {
    return new Response(null, { status: 401 });
  }

  // Flush any pending Langfuse traces
  await langfuseSpanProcessor.forceFlush();

  return new Response(null, { status: 204 });
}
