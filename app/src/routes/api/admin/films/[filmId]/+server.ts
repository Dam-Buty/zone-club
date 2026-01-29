import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteFilm } from '$lib/server/films';

export const DELETE: RequestHandler = async ({ params, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const filmId = parseInt(params.filmId);
    deleteFilm(filmId);
    return json({ success: true });
};
