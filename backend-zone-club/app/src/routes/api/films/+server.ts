import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllFilms } from '$lib/server/films';

// GET /api/films - Liste tous les films disponibles (ou tous pour admin)
export const GET: RequestHandler = async ({ url, locals }) => {
    const includeAll = url.searchParams.get('all') === 'true';

    // Only admins can see unavailable films
    const availableOnly = includeAll && locals.user?.is_admin ? false : true;

    const films = getAllFilms(availableOnly);
    return json(films);
};
