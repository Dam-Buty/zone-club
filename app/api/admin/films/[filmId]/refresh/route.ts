import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { refreshFilm } from '@/lib/media/refresh';
import { getUserFromSession } from '@/lib/session';

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);

    try {
        const result = await refreshFilm(filmId);
        return NextResponse.json({ result });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
