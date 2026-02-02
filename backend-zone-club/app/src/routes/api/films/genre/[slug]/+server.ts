import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFilmsByGenre, getAllGenres } from '$lib/server/films';

// GET /api/films/genre/[slug] - Liste les films d'un genre
export const GET: RequestHandler = async ({ params }) => {
    const { slug } = params;

    // Vérifier que le genre existe
    const genres = getAllGenres();
    const genre = genres.find(g => g.slug === slug);

    if (!genre) {
        throw error(404, 'Genre non trouvé');
    }

    const films = getFilmsByGenre(slug);

    return json({
        genre,
        films
    });
};
