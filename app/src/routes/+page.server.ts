import type { PageServerLoad } from './$types';
import { getAllFilms, getGenresWithFilmCount } from '$lib/server/films';

export const load: PageServerLoad = async () => {
    const films = getAllFilms(true).slice(0, 12);
    const genres = getGenresWithFilmCount().slice(0, 6);

    return { films, genres };
};
