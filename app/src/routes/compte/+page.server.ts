import type { PageServerLoad } from './$types';
import { getUserActiveRentals, getUserRentalHistory } from '$lib/server/rentals';
import { getUserReviews } from '$lib/server/reviews';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(302, '/login');
    }

    const activeRentals = getUserActiveRentals(locals.user.id);
    const rentalHistory = getUserRentalHistory(locals.user.id);
    const reviews = getUserReviews(locals.user.id);

    return { activeRentals, rentalHistory, reviews };
};
