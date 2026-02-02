import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateRequestStatus, getRequestByTmdbId } from '$lib/server/requests';
import { addFilmFromTmdb } from '$lib/server/films';
import { db } from '$lib/server/db';

// PATCH /api/admin/requests/:id - Mettre à jour le statut d'une demande
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const requestId = parseInt(params.id);
    const { status, admin_note } = await request.json();

    if (!['approved', 'rejected', 'added'].includes(status)) {
        return json({ error: 'Statut invalide' }, { status: 400 });
    }

    // If approving, also add the film to the catalog
    if (status === 'added') {
        const filmRequest = db.prepare('SELECT * FROM film_requests WHERE id = ?').get(requestId) as any;
        if (!filmRequest) {
            return json({ error: 'Demande non trouvée' }, { status: 404 });
        }

        try {
            await addFilmFromTmdb(filmRequest.tmdb_id);
        } catch (err) {
            return json({ error: (err as Error).message }, { status: 400 });
        }
    }

    updateRequestStatus(requestId, status, admin_note);
    return json({ success: true });
};
