import type { PageServerLoad } from './$types';
import { getGenresWithFilmCount } from '$lib/server/films';

export const load: PageServerLoad = async () => {
    const genres = getGenresWithFilmCount();
    return { genres };
};
