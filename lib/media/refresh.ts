import { db } from '../db'
import { getFilmById, getFilmByTmdbId, triggerDownload } from '../films'
import { getMovieStatus, searchMovie } from '../radarr'
import { enqueueProcessFilm } from './process-film'

export type RefreshResult = 'processing' | 'searching' | 'downloading'

export async function refreshFilm(filmId: number): Promise<RefreshResult> {
    let film = getFilmById(filmId)
    if (!film) throw new Error('film introuvable')

    if (!film.radarr_id) {
        film = await triggerDownload(filmId) // (re)add + search
        return 'searching'
    }

    const status = await getMovieStatus(film.radarr_id)
    if (status.hasFile) {
        enqueueProcessFilm(filmId)
        return 'processing'
    }

    await searchMovie(film.radarr_id)
    return 'downloading'
}

export function emptyFilmIds(): number[] {
    const rows = db.prepare(
        'SELECT id FROM films WHERE file_path_vo_transcoded IS NULL ORDER BY id'
    ).all() as { id: number }[]
    return rows.map(r => r.id)
}

export function refreshFilmByTmdb(tmdbId: number): Promise<RefreshResult> {
    const film = getFilmByTmdbId(tmdbId)
    if (!film) throw new Error(`film introuvable (tmdb: ${tmdbId})`)
    return refreshFilm(film.id)
}
