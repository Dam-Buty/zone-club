import { db } from '../db'
import { getQueue, removeQueueItem, type RadarrQueueItem } from '../radarr'
import { maxQcAttempts } from './quality-control'

// Surveillance des téléchargements que Radarr refuse d'importer.
//
// Notre contrôle qualité s'exerce APRÈS l'import : il sonde le fichier une fois
// Radarr l'a rangé dans la library. Mais une release peut échouer AVANT — Radarr
// bloque alors la file en `importPending` avec un avertissement, `hasFile` reste
// faux, processFilm répond « pending » et rend la main. Le film reste coincé
// indéfiniment, sans erreur nulle part.
//
// Vu en vrai le 23/08 sur Interstellar : une release de 19,5 Go dont les par2
// validaient mais qui n'était pas un Matroska (aucun en-tête EBML, données à
// entropie maximale). Radarr : « Unable to determine if file is a sample ».
// Sans intervention manuelle, le film n'aurait jamais avancé.
//
// On applique donc à ces blocages le même traitement qu'à un rejet QC : blacklist
// + nouvelle recherche, dans la limite du même compteur de tentatives.

// Un avertissement transitoire est normal pendant que Radarr scanne ou que
// SABnzbd finit son post-traitement : on n'agit qu'après persistance.
const STUCK_MINUTES = Number(process.env.IMPORT_STUCK_MINUTES || 15)

// downloadId → date de première observation en état bloqué.
const firstSeen = new Map<string, number>()

function isStuck(item: RadarrQueueItem): boolean {
    const state = item.trackedDownloadState || ''
    const status = item.trackedDownloadStatus || ''
    // `importPending`/`importBlocked` + warning|error = Radarr a le fichier mais
    // refuse de l'importer. `completed` seul est normal (import en cours).
    return (status === 'warning' || status === 'error')
        && (state === 'importPending' || state === 'importBlocked' || state === 'importFailed')
}

function describe(item: RadarrQueueItem): string {
    const msgs = (item.statusMessages || [])
        .flatMap(m => m.messages || [m.title || ''])
        .filter(Boolean)
    return item.errorMessage || msgs[0] || 'import refusé par Radarr'
}

export async function checkStuckImports(): Promise<void> {
    let queue: RadarrQueueItem[]
    try {
        queue = await getQueue()
    } catch (err) {
        console.error('[stuck-imports] file Radarr illisible:', err instanceof Error ? err.message : String(err))
        return
    }

    const live = new Set<string>()
    const now = Date.now()

    for (const item of queue) {
        const key = item.downloadId || String(item.id)
        live.add(key)
        if (!isStuck(item)) { firstSeen.delete(key); continue }

        const since = firstSeen.get(key)
        if (since === undefined) {
            firstSeen.set(key, now)
            console.log(`[stuck-imports] "${item.title}" en attente d'import (${describe(item)}) — observé, action dans ${STUCK_MINUTES} min si ça persiste`)
            continue
        }
        const minutes = (now - since) / 60000
        if (minutes < STUCK_MINUTES) continue

        // Le film doit être l'un des nôtres, sinon on ne touche à rien.
        const film = db.prepare('SELECT id, title, qc_attempts FROM films WHERE radarr_id = ?')
            .get(item.movieId) as { id: number; title: string; qc_attempts: number } | undefined
        if (!film) {
            console.warn(`[stuck-imports] "${item.title}" bloqué mais movieId ${item.movieId} inconnu en base — ignoré`)
            continue
        }

        const attempts = (film.qc_attempts ?? 0) + 1
        const max = maxQcAttempts()
        const why = describe(item)
        db.prepare('UPDATE films SET qc_attempts = ? WHERE id = ?').run(attempts, film.id)

        if (attempts >= max) {
            console.warn(`[stuck-imports] "${film.title}": ${attempts}/${max} tentatives — film flaggé, file laissée en l'état`)
            db.prepare('UPDATE films SET transcode_status = ?, transcode_error = ? WHERE id = ?')
                .run('qc_failed', `${max} releases refusées, dernière bloquée à l'import: ${why}`, film.id)
            firstSeen.delete(key)
            continue
        }

        console.log(`[stuck-imports] "${film.title}": bloqué depuis ${minutes.toFixed(0)} min (${why}) — tentative ${attempts}/${max}, blacklist + nouvelle recherche`)
        try {
            // blocklist=true : la release est mauvaise, on ne veut pas la revoir.
            // Radarr relance sa propre recherche (autoRedownloadFailed).
            await removeQueueItem(item.id, true)
            db.prepare('UPDATE films SET transcode_status = ?, transcode_error = ? WHERE id = ?')
                .run('rejected_release', `import bloqué: ${why}`, film.id)
            firstSeen.delete(key)
        } catch (err) {
            console.error(`[stuck-imports] échec du retrait de "${item.title}":`, err instanceof Error ? err.message : String(err))
        }
    }

    // Oublie les entrées qui ont quitté la file (importées ou supprimées).
    for (const key of firstSeen.keys()) if (!live.has(key)) firstSeen.delete(key)
}
