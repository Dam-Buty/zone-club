import type { PageServerLoad } from './$types';
import { getFilmsByGenre, getAllGenres } from '$lib/server/films';
import { getFilmRentalStatus } from '$lib/server/rentals';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
    const genres = getAllGenres();
    const genre = genres.find(g => g.slug === params.slug);

    if (!genre) {
        throw error(404, 'Rayon non trouvé');
    }

    const films = getFilmsByGenre(params.slug);
    const filmsWithStatus = films.map(film => ({
        ...film,
        rental_status: getFilmRentalStatus(film.id, locals.user?.id ?? null)
    }));

    return { genre, films: filmsWithStatus };
};
