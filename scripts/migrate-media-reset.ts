/**
 * Migration media — backfill original_language + reset des paths (media pipeline redesign, Task 12)
 *
 * One-shot script pour la refonte : passage d'un modèle 2× Radarr (VO/VF séparés) vers un
 * Radarr unique produisant un MKV combiné, traité localement (VO.mp4 + VF.mp4 + subs EN/FR).
 *
 * Ce script :
 *   1. Backfill `films.original_language` depuis TMDB (rate-limit 250ms, tolérant aux erreurs)
 *   2. Vide tous les chemins media / transcode / radarr_id et masque les films (is_available = 0)
 *   3. Préserve `radarr_vo_id` / `radarr_vf_id` (historique / rollback)
 *
 * ⚠️  DESTRUCTIF — exécution MANUELLE au moment voulu par l'utilisateur, pas au build.
 * Idempotent : relançable sans risque (backfill ciblé NULL/vide, reset re-nulle simplement).
 *
 * Usage:
 *   npx tsx scripts/migrate-media-reset.ts
 */

import { db } from '../lib/db'
import { getMovie } from '../lib/tmdb'
import type { TmdbMovie } from '../lib/tmdb'

const TMDB_RATE_LIMIT_MS = 250

// `TmdbMovie` n'expose pas encore `original_language` dans son interface, mais le
// response TMDB brut le contient directement (Task 6 l'ajoutera à l'interface).
// L'intersection garde le cast valide une fois cette colonne ajoutée.
type TmdbMovieWithLang = TmdbMovie & { original_language?: string }

interface FilmRow {
    id: number
    tmdb_id: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

async function main(): Promise<void> {
    const startedAt = Date.now()

    const total = (db.prepare('SELECT COUNT(*) AS n FROM films').get() as { n: number }).n
    const rows = db.prepare(
        "SELECT id, tmdb_id FROM films WHERE original_language IS NULL OR original_language = ''"
    ).all() as FilmRow[]
    const updateLang = db.prepare('UPDATE films SET original_language = ? WHERE id = ?')

    let backfilled = 0
    let failed = 0

    console.log(`Films en base : ${total}, à backfiller : ${rows.length}`)

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
            const movie = (await getMovie(row.tmdb_id)) as TmdbMovieWithLang
            const lang = movie.original_language ?? null
            updateLang.run(lang, row.id)
            if (lang) {
                backfilled++
                console.log(`  [${i + 1}/${rows.length}] #${row.id} tmdb=${row.tmdb_id} → original_language='${lang}'`)
            } else {
                console.warn(`  [${i + 1}/${rows.length}] #${row.id} tmdb=${row.tmdb_id} → original_language vide`)
            }
        } catch (err) {
            failed++
            console.warn(`  [${i + 1}/${rows.length}] #${row.id} tmdb=${row.tmdb_id} : ${errMsg(err)}`)
        }
        await sleep(TMDB_RATE_LIMIT_MS)
    }

    const resetResult = db.prepare(`
        UPDATE films SET
            file_path_vf = NULL,
            file_path_vo = NULL,
            file_path_vo_transcoded = NULL,
            file_path_vf_transcoded = NULL,
            subtitle_path = NULL,
            subtitle_fr_vtt = NULL,
            subtitle_fr_srt = NULL,
            subtitle_en_vtt = NULL,
            subtitle_en_srt = NULL,
            media_dir = NULL,
            radarr_id = NULL,
            transcode_status = NULL,
            transcode_progress = 0,
            transcode_error = NULL,
            is_available = 0
    `).run()

    console.log('\n--- Récap ---')
    console.log(`Timestamp         : ${new Date().toISOString()}`)
    console.log(`Films en base     : ${total}`)
    console.log(`original_language : ${backfilled} backfillés, ${failed} échec(s)`)
    console.log(`Films reset       : ${resetResult.changes}`)
    console.log(`Durée             : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    if (failed > 0) {
        console.warn(`⚠️  ${failed} backfill(s) ont échoué — relancer le script les retentera (idempotent).`)
    }
    console.log('NB : radarr_vo_id / radarr_vf_id conservés (historique / rollback).')
}

main().catch((err) => {
    console.error('Erreur fatale :', errMsg(err))
    process.exit(1)
})
