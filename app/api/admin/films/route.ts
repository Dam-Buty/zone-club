import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { addFilmFromTmdb } from '@/lib/films';
import { getUserFromSession } from '@/lib/session';

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const { tmdb_id } = await request.json();

    try {
        const film = await addFilmFromTmdb(tmdb_id);
        return NextResponse.json({ film });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
