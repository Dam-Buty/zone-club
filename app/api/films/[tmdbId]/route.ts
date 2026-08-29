import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilmByTmdbId, type Film } from '@/lib/films';
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

    if (!film || !film.is_available) {
        return NextResponse.json({ error: 'Film non trouvé' }, { status: 404 });
    }

    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    const rentalStatus = getFilmRentalStatus(film.id, user?.id || null);

    // Les versions réellement jouables = le fichier TRANSCODÉ existe (même source de vérité que les
    // streaming_urls de lib/rentals.ts). Exposées en booléens : la fiche a besoin de savoir quelles
    // versions existent, pas d'où elles sont sur le disque.
    return NextResponse.json({
        ...omitInternalColumns(film),
        has_vf: !!film.file_path_vf_transcoded,
        has_vo: !!film.file_path_vo_transcoded,
        rental_status: rentalStatus
    });
}

/**
 * Colonnes internes : chemins disque, ids Radarr, détail du contrôle qualité. Cette route est publique
 * (pas de gate admin) et son seul consommateur est la fiche K7, qui n'en a besoin d'aucune. Pendant de
 * FILM_LIST_COLUMNS pour les routes de liste — l'admin passe par /api/films?all=true.
 */
const INTERNAL_FILM_COLUMNS = [
    'file_path_vo_transcoded', 'file_path_vf_transcoded', 'media_dir',
    'subtitle_fr_vtt', 'subtitle_fr_srt', 'subtitle_en_vtt', 'subtitle_en_srt',
    'radarr_id', 'radarr_vo_id', 'radarr_vf_id',
    'qc_attempts', 'qc_force', 'transcode_error',
] as const;

function omitInternalColumns(film: Film): Omit<Film, typeof INTERNAL_FILM_COLUMNS[number]> {
    const out = { ...film };
    for (const column of INTERNAL_FILM_COLUMNS) delete (out as Record<string, unknown>)[column];
    return out;
}
