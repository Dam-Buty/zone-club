import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rentFilm } from '$lib/server/rentals';

export const POST: RequestHandler = async ({ params, locals }) => {
    if (!locals.user) {
        return json({ error: 'Non authentifié' }, { status: 401 });
    }

    const filmId = parseInt(params.filmId);

    try {
        const rental = await rentFilm(locals.user.id, filmId);
        return json({ rental });
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
    }
};
