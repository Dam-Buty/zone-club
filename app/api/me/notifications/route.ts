import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getReturnRequestsForUser } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const notifications = getReturnRequestsForUser(user.id);
    return NextResponse.json({ notifications });
}
