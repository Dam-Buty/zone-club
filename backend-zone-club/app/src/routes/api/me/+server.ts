import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserActiveRentals, getUserRentalHistory } from '$lib/server/rentals';
import { getUserReviews } from '$lib/server/reviews';

// GET /api/me - Récupère les infos de l'utilisateur connecté
export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        throw error(401, 'Non authentifié');
    }

    const activeRentals = getUserActiveRentals(locals.user.id);
    const rentalHistory = getUserRentalHistory(locals.user.id);
    const reviews = getUserReviews(locals.user.id);

    return json({
        user: {
            id: locals.user.id,
            username: locals.user.username,
            credits: locals.user.credits,
            is_admin: locals.user.is_admin,
            created_at: locals.user.created_at
        },
        activeRentals,
        rentalHistory,
        reviews
    });
};
