import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createReview, getReviewsByFilm, getFilmRatings, canUserReview } from '$lib/server/reviews';

// GET /api/reviews/[filmId] - Liste les critiques d'un film
export const GET: RequestHandler = async ({ params, locals }) => {
    const filmId = parseInt(params.filmId);

    if (isNaN(filmId)) {
        return json({ error: 'ID film invalide' }, { status: 400 });
    }

    const reviews = getReviewsByFilm(filmId);
    const ratings = getFilmRatings(filmId);

    // Check if current user can review
    let canReview = { allowed: false, reason: 'Non authentifié' };
    if (locals.user) {
        canReview = canUserReview(locals.user.id, filmId);
    }

    return json({
        reviews,
        ratings,
        canReview
    });
};

// POST /api/reviews/[filmId] - Créer une critique
export const POST: RequestHandler = async ({ params, request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Non authentifié' }, { status: 401 });
    }

    const filmId = parseInt(params.filmId);
    const { content, rating_direction, rating_screenplay, rating_acting } = await request.json();

    try {
        const review = createReview(locals.user.id, filmId, content, {
            direction: rating_direction,
            screenplay: rating_screenplay,
            acting: rating_acting
        });
        return json({ review });
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
    }
};
