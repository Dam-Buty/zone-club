import { NextRequest, NextResponse } from 'next/server';
import { getFilmByTmdbId } from '@/lib/films';
import { trailerStatus } from '@/lib/trailers';

// Où en est la bande-annonce d'un film : prête, en préparation (sa récupération est alors lancée),
// absente ou en échec. La borne interroge cette route, puis lit le fichier sur /trailer.

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ tmdbId: string }> }
) {
    const tmdbId = parseInt((await params).tmdbId);
    if (isNaN(tmdbId)) {
        return NextResponse.json({ error: 'ID TMDB invalide' }, { status: 400 });
    }
    const film = getFilmByTmdbId(tmdbId);
    if (!film || !film.is_available) {
        return NextResponse.json({ error: 'Film non trouvé' }, { status: 404 });
    }
    return NextResponse.json(await trailerStatus(tmdbId), { headers: { 'Cache-Control': 'no-store' } });
}
