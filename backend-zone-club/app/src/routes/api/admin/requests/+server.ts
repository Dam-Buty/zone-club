import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFilmRequests } from '$lib/server/requests';

// GET /api/admin/requests - Liste toutes les demandes de films (admin only)
export const GET: RequestHandler = async ({ url, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const status = url.searchParams.get('status') || undefined;
    const requests = getFilmRequests(status);
    return json(requests);
};
