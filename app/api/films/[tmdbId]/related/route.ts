import { NextRequest, NextResponse } from 'next/server';
import { getAllFilms, getFilmByTmdbId } from '@/lib/films';
import { relatedFilmIds } from '@/lib/related-films';

// « À voir aussi » dans la fiche détaillée de la borne : les films de nos rayons qui partagent le
// réalisateur ou des acteurs avec ce film (lib/related-films.ts). On renvoie des identifiants
// internes ; la borne retrouve les jaquettes dans le catalogue qu'elle a déjà.

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
    return NextResponse.json(relatedFilmIds(film, getAllFilms(true)), {
        headers: { 'Cache-Control': 'public, max-age=300' },
    });
}
