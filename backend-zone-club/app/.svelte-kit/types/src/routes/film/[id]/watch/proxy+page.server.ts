// @ts-nocheck
import type { PageServerLoad } from './$types';
import { getFilmByTmdbId } from '$lib/server/films';
import { getFilmRentalStatus } from '$lib/server/rentals';
import { error, redirect } from '@sveltejs/kit';

export const load = async ({ params, locals }: Parameters<PageServerLoad>[0]) => {
    if (!locals.user) {
        throw redirect(302, '/login');
    }

    const tmdbId = parseInt(params.id);
    const film = getFilmByTmdbId(tmdbId);

    if (!film) {
        throw error(404, 'Film non trouvé');
    }

    const rentalStatus = getFilmRentalStatus(film.id, locals.user.id);

    if (!rentalStatus.rented_by_current_user || !rentalStatus.rental) {
        throw redirect(302, `/film/${tmdbId}`);
    }

    return {
        film,
        rental: rentalStatus.rental
    };
};
