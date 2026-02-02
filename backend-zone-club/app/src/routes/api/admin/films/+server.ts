import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addFilmFromTmdb } from '$lib/server/films';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const { tmdb_id } = await request.json();

    try {
        const film = await addFilmFromTmdb(tmdb_id);
        return json({ film });
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 400 });
    }
};
