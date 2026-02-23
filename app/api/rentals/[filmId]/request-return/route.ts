import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createReturnRequest } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';

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
        createReturnRequest(filmId, user.id);
        return NextResponse.json({ ok: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
