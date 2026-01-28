import type { PageServerLoad } from './$types';
import { getAllFilms } from '$lib/server/films';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user?.is_admin) {
        throw redirect(302, '/');
    }

    const films = getAllFilms(false);
    return { films };
};
