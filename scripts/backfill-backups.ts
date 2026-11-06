/**
 * Backfill des backups SSHFS manquants (storage box pleine → backup échoué).
 *
 * Quand `backupSource()` échoue (ENOSPC sur la storage box, lien coupé…), le film
 * est quand même publié (`done`, `is_available=1`) mais `releaseSource()` n'est
 * jamais appelé : le MKV reste dans la library et le film reste `monitored` dans
 * Radarr. Il n'y a alors AUCUNE copie de secours — c'est le pire des cas, car le
 * MKV d'origine sera supprimé de la library à la prochaine occasion sans avoir
 * jamais été sauvegardé.
 *
 * Ce script identifie ces films (`done` + MKV toujours présent dans la library +
 * backup absent ou incomplet) et rejoue la fin de pipeline exactement comme le
 * ferait `processFilm` :
 *
 *   1. copie du MKV vers `<MEDIA_BACKUP_PATH>/<media_dir>/original.mkv`
 *      (sérialisée, comme la file de backup du pipeline — ne pas paralléliser :
 *      vingt copies SSHFS concurrentes étranglent le lien Hetzner) ;
 *   2. une fois la copie vérifiée (même taille que la source), suppression du
 *      dossier MKV dans la library ;
 *   3. `setMonitored(radarr_id, false)` dans Radarr.
 *
 * Idempotent : un backup de même taille est déjà le bon → copie sautée ; un MKV
 * déjà supprimé → film sauté.
 *
 * Usage :
 *   npx tsx --env-file=.env scripts/backfill-backups.ts            # dry-run (rien ne bouge)
 *   npx tsx --env-file=.env scripts/backfill-backups.ts --apply    # exécute copie + release
 *
 * Les chemins hôte par défaut reflètent les mounts de docker-compose.yml :
 *   MEDIA_LIBRARY_PATH=/data/phat-two/zone-club-radarr
 *   MEDIA_BACKUP_PATH=/mnt/backup/zone-club
 */

import { db } from '../lib/db'
import { setMonitored } from '../lib/radarr'
import { access, copyFile, mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'

const LIBRARY = process.env.MEDIA_LIBRARY_PATH || '/data/phat-two/zone-club-radarr'
const BACKUP = process.env.MEDIA_BACKUP_PATH || '/mnt/backup/zone-club'

const APPLY = process.argv.includes('--apply')

interface FilmRow {
    id: number
    title: string
    media_dir: string
    radarr_id: number
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function exists(p: string): Promise<boolean> {
    try { await access(p); return true } catch { return false }
}

// Premier .mkv du dossier library (Radarr n'en dépose qu'un par film).
async function findMkv(dir: string): Promise<string | null> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return null }
    const mkv = entries.find((e) => e.toLowerCase().endsWith('.mkv'))
    return mkv ? join(dir, mkv) : null
}

async function main(): Promise<void> {
    const startedAt = Date.now()
    const rows = db.prepare(`
        SELECT id, title, media_dir, radarr_id FROM films
        WHERE transcode_status = 'done'
          AND media_dir IS NOT NULL
          AND radarr_id IS NOT NULL
        ORDER BY id
    `).all() as FilmRow[]

    const todo: { film: FilmRow; mkv: string; srcBytes: number; backupBytes: number | null }[] = []
    const skipped: string[] = []

    for (const film of rows) {
        const mkv = await findMkv(join(LIBRARY, film.media_dir))
        if (!mkv) {
            // MKV déjà supprimé → source déjà libérée (ou film traité entre-temps).
            continue
        }
        const srcStat = await stat(mkv).catch(() => null)
        if (!srcStat) continue
        const backupFile = join(BACKUP, film.media_dir, 'original.mkv')
        const bStat = await stat(backupFile).catch(() => null)
        if (bStat && bStat.size === srcStat.size) {
            // Backup déjà complet mais MKV encore là : release seulement.
            todo.push({ film, mkv, srcBytes: srcStat.size, backupBytes: bStat.size })
        } else {
            todo.push({ film, mkv, srcBytes: srcStat.size, backupBytes: bStat?.size ?? null })
        }
    }

    const total = todo.reduce((sum, t) => sum + (t.backupBytes === t.srcBytes ? 0 : t.srcBytes), 0)
    console.log(`Films 'done' avec MKV restant en library : ${todo.length}`)
    console.log(`Volume à copier                                : ${(total / 1e9).toFixed(1)} Go`)
    console.log(`Mode                                           : ${APPLY ? 'APPLY (copie + release)' : 'dry-run (aucune modification)'}\n`)

    for (const { film, mkv, srcBytes, backupBytes } of todo) {
        const backupOk = backupBytes === srcBytes
        if (!APPLY) {
            console.log(
                `  ${backupOk ? 'RELEASE-ONLY' : 'BACKUP+RELEASE'}  #${film.id} ${film.title}  (${(srcBytes / 1e9).toFixed(1)} Go)`
            )
            continue
        }

        const log = (msg: string) => console.log(`  [backfill] "${film.title}": ${msg}`)
        try {
            if (!backupOk) {
                const backupDir = join(BACKUP, film.media_dir)
                await mkdir(backupDir, { recursive: true })
                const part = join(backupDir, 'original.mkv.part')
                const dest = join(backupDir, 'original.mkv')
                log(`copie ${(srcBytes / 1e9).toFixed(1)} Go → ${dest}`)
                await copyFile(mkv, part)
                const partStat = await stat(part)
                if (partStat.size !== srcBytes) {
                    throw new Error(`copie tronquée: ${partStat.size} octets copiés pour ${srcBytes} attendus`)
                }
                await rename(part, dest)
                log('backup OK')
            } else {
                log('backup déjà complet — copie sautée')
            }

            log('suppression MKV library…')
            await rm(join(LIBRARY, film.media_dir), { recursive: true, force: true })
            log('unmonitor Radarr…')
            await setMonitored(film.radarr_id, false)
            log('terminé')
        } catch (err) {
            console.error(`  [backfill] Erreur "${film.title}": ${errMsg(err)} — MKV conservé dans library`)
        }
    }

    console.log(`\nDurée : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    if (!APPLY) {
        console.log('Relancer avec --apply pour exécuter la copie et la release.')
    }
    if (skipped.length) {
        console.log(`\nSkippés : ${skipped.join(', ')}`)
    }
}

main().catch((err) => {
    console.error('Erreur fatale :', errMsg(err))
    process.exit(1)
})
