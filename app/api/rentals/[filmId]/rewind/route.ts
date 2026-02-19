import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { claimRewindCredit } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';
import { db } from '@/lib/db';

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);

    try {
        claimRewindCredit(user.id, filmId);
        const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };
        return NextResponse.json({ ok: true, credits: updatedUser.credits });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
