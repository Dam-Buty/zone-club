// @ts-nocheck
import type { PageServerLoad } from './$types';
import { getAllFilms } from '$lib/server/films';
import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }: Parameters<PageServerLoad>[0]) => {
    if (!locals.user?.is_admin) {
        throw redirect(302, '/');
    }

    const films = getAllFilms(false);
    return { films };
};
