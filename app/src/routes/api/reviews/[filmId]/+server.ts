import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createReview } from '$lib/server/reviews';

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
