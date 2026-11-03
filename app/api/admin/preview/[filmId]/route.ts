import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilmById } from '@/lib/films';
import { buildStreamingUrls } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';
import { createPreviewSymlinks } from '@/lib/symlinks';

/**
 * Prépare les URLs de lecture d'un film pour la page admin, SANS créer de location.
 *
 * Le player du vidéoclub ne sait lire que des `streaming_urls` ; en production
 * elles viennent d'un dossier de symlinks propre à la location. Ici on réutilise
 * la même mécanique avec un dossier déterministe (`preview-<filmId>`) : l'admin
 * peut tester les permutations VF/VO/STFR/STEN sans consommer de crédit, sans
 * écrire dans l'historique et sans toucher au stock.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ filmId: string }> },
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const filmId = Number((await params).filmId);
    if (!Number.isInteger(filmId) || filmId <= 0) {
        return NextResponse.json({ error: 'ID de film invalide' }, { status: 400 });
    }

    const film = getFilmById(filmId);
    if (!film) {
        return NextResponse.json({ error: 'Film non trouvé' }, { status: 404 });
    }

    if (!film.file_path_vf_transcoded && !film.file_path_vo_transcoded) {
        return NextResponse.json(
            { error: 'Aucune version transcodée pour ce film' },
            { status: 409 },
        );
    }

    const symlinks = await createPreviewSymlinks(film.id, {
        vf: film.file_path_vf_transcoded,
        vo: film.file_path_vo_transcoded,
        subtitles: {
            fr: film.subtitle_fr_vtt,
            en: film.subtitle_en_vtt,
        },
    });

    const response = NextResponse.json({
        film_id: film.id,
        title: film.title,
        streaming_urls: buildStreamingUrls(film, symlinks.uuid),
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
