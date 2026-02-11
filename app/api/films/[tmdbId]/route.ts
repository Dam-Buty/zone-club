import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilmByTmdbId } from '@/lib/films';
import { getFilmRentalStatus } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ tmdbId: string }> }
) {
    const { tmdbId: tmdbIdStr } = await params;
    const tmdbId = parseInt(tmdbIdStr);

    if (isNaN(tmdbId)) {
        return NextResponse.json({ error: 'ID TMDB invalide' }, { status: 400 });
    }

    const film = getFilmByTmdbId(tmdbId);

    if (!film) {
        return NextResponse.json({ error: 'Film non trouvé' }, { status: 404 });
    }

    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    const rentalStatus = getFilmRentalStatus(film.id, user?.id || null);

    return NextResponse.json({
        ...film,
        rental_status: rentalStatus
    });
}
