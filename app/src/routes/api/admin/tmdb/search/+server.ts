import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMovies } from '$lib/server/tmdb';

export const GET: RequestHandler = async ({ url, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const query = url.searchParams.get('q') || '';
    if (query.length < 2) {
        return json({ results: [] });
    }

    const results = await searchMovies(query);
    return json({
        results: results.slice(0, 10).map(r => ({
            id: r.id,
            title: r.title,
            release_date: r.release_date
        }))
    });
};
