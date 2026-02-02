import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGenresWithFilmCount } from '$lib/server/films';

// GET /api/genres - Liste tous les genres avec le nombre de films
export const GET: RequestHandler = async () => {
    const genres = getGenresWithFilmCount();
    return json(genres);
};
