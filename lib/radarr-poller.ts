import { db } from './db'
import { getMovieStatus } from './radarr'
import { enqueueProcessFilm } from './media/process-film'

const POLL_INTERVAL = 2 * 60 * 1000 // 2 minutes

let started = false

interface PendingFilm {
    id: number
    radarr_id: number
}

function getPendingFilms(): PendingFilm[] {
    return db.prepare(`
        SELECT id, radarr_id FROM films
        WHERE radarr_id IS NOT NULL
          AND file_path_vo_transcoded IS NULL
          AND (transcode_status IS NULL OR transcode_status NOT IN ('done', 'qc_failed'))
    `).all() as PendingFilm[]
}

async function pollRadarrStatus(): Promise<void> {
    const pending = getPendingFilms()
    if (pending.length === 0) return

    for (const film of pending) {
        try {
            const status = await getMovieStatus(film.radarr_id)
            if (status.hasFile) {
                enqueueProcessFilm(film.id)
            }
        } catch (error) {
            console.error(`[radarr-poller] Erreur pour film #${film.id}:`, error)
        }
    }
}

export function recoverMediaPipeline(): void {
    const pending = getPendingFilms()
    for (const film of pending) {
        enqueueProcessFilm(film.id)
    }
    if (pending.length > 0) {
        console.log(`[radarr-poller] Recovery: ${pending.length} film(s) ré-enqueue`)
    }
}

export function startRadarrPoller(): void {
    if (started) return
    started = true
    console.log('[radarr-poller] Démarré (intervalle: 2min)')
    pollRadarrStatus()
    setInterval(pollRadarrStatus, POLL_INTERVAL)
}
