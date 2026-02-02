import type { PageServerLoad } from './$types';
import { getFilmByTmdbId } from '$lib/server/films';
import { getFilmRentalStatus } from '$lib/server/rentals';
import { getReviewsByFilm, getFilmRatings, canUserReview } from '$lib/server/reviews';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
    const tmdbId = parseInt(params.id);
    const film = getFilmByTmdbId(tmdbId);

    if (!film) {
        throw error(404, 'Film non trouvé');
    }

    const rentalStatus = getFilmRentalStatus(film.id, locals.user?.id ?? null);
    const reviews = getReviewsByFilm(film.id);
    const ratings = getFilmRatings(film.id);
    const canReview = locals.user ? canUserReview(locals.user.id, film.id) : { allowed: false, reason: 'Connectez-vous pour critiquer' };

    return { film, rentalStatus, reviews, ratings, canReview };
};
