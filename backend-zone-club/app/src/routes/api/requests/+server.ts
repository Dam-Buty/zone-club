import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createFilmRequest, getFilmRequests, getUserRequests } from '$lib/server/requests';

// GET /api/requests - Liste les demandes (toutes pour admin, les siennes pour user)
export const GET: RequestHandler = async ({ locals, url }) => {
    if (!locals.user) {
        return json({ error: 'Non authentifié' }, { status: 401 });
    }

    const status = url.searchParams.get('status') || undefined;

    if (locals.user.is_admin) {
        const requests = getFilmRequests(status);
        return json(requests);
    } else {
        const requests = getUserRequests(locals.user.id);
        return json(requests);
    }
};

// POST /api/requests - Créer une demande de film
export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { tmdb_id, title, poster_url } = await request.json();

    if (!tmdb_id || !title) {
        return json({ error: 'tmdb_id et title requis' }, { status: 400 });
    }

    try {
        const filmRequest = createFilmRequest(
            locals.user.id,
            tmdb_id,
            title,
            poster_url || null
        );
        return json({ request: filmRequest });
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
    }
};
