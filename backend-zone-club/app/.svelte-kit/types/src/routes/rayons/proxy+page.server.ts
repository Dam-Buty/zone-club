// @ts-nocheck
import type { PageServerLoad } from './$types';
import { getGenresWithFilmCount } from '$lib/server/films';

export const load = async () => {
    const genres = getGenresWithFilmCount();
    return { genres };
};
;null as any as PageServerLoad;