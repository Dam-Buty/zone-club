import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFilmByTmdbId } from '$lib/server/films';
import { getFilmRentalStatus } from '$lib/server/rentals';

// GET /api/films/[tmdbId] - Récupère un film par son ID TMDB
export const GET: RequestHandler = async ({ params, locals }) => {
    const tmdbId = parseInt(params.tmdbId);

    if (isNaN(tmdbId)) {
        throw error(400, 'ID TMDB invalide');
    }

    const film = getFilmByTmdbId(tmdbId);

    if (!film) {
        throw error(404, 'Film non trouvé');
    }

    // Ajouter le statut de location
    const rentalStatus = getFilmRentalStatus(film.id, locals.user?.id || null);

    return json({
        ...film,
        rental_status: rentalStatus
    });
};
