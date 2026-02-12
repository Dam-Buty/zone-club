import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { getTranscodeStatuses } from '@/lib/films';

export async function GET() {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get('session')?.value);

  if (!user?.is_admin) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
  }

  const statuses = getTranscodeStatuses();
  return NextResponse.json(statuses);
}
