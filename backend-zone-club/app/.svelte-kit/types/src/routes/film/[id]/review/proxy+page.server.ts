// @ts-nocheck
import type { PageServerLoad } from './$types';
import { getFilmByTmdbId } from '$lib/server/films';
import { canUserReview, getUserReview } from '$lib/server/reviews';
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

    const canReview = canUserReview(locals.user.id, film.id);
    const existingReview = getUserReview(locals.user.id, film.id);

    if (!canReview.allowed) {
        throw redirect(302, `/film/${tmdbId}`);
    }

    return { film, existingReview };
};
