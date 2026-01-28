import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setFilmAvailability } from '$lib/server/films';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const filmId = parseInt(params.filmId);
    const { available } = await request.json();

    setFilmAvailability(filmId, available);
    return json({ success: true });
};
