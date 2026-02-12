import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { triggerDownload } from '@/lib/films';
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
        const film = await triggerDownload(filmId);
        return NextResponse.json({ film });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
