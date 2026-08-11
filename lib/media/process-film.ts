import { join } from 'path'
import { mkdir, copyFile, rm, access } from 'fs/promises'
import { db } from '../db'
import { getFilmById, updateFilmMedia } from '../films'
import { getMovieStatus, setMonitored } from '../radarr'
import { probeStreams } from './probe'
import { identifyTracks } from './identify-tracks'
import { mediaDirFromMoviePath } from './media-dir'
import { createJob, waitForJob, downloadOutput } from './transcode-service'
import { muxVf, extractSub } from './ffmpeg-ops'

const LIBRARY = process.env.MEDIA_LIBRARY_PATH || '/media/library'   // MKV bruts (mount raw Radarr)
const FILMS = process.env.MEDIA_FILMS_PATH || '/media/films'          // sorties transcodées
const BACKUP = process.env.MEDIA_BACKUP_PATH || '/media/backup/zone-club'

// index audio ffprobe absolu → ordinal (Nième piste audio, 0-based)
function audioOrdinal(streams: { index: number; codec_type?: string }[], absoluteIndex: number): number {
    return streams.filter(s => s.codec_type === 'audio').findIndex(s => s.index === absoluteIndex)
}

function setStatus(filmId: number, status: string, progress = 0, error: string | null = null): void {
    db.prepare('UPDATE films SET transcode_status=?, transcode_progress=?, transcode_error=? WHERE id=?')
        .run(status, progress, error, filmId)
}

export async function processFilm(filmId: number): Promise<void> {
    const film = getFilmById(filmId)
    if (!film || !film.radarr_id) throw new Error(`processFilm: film ${filmId} sans radarr_id`)

    // 1. Localiser le MKV via Radarr
    const status = await getMovieStatus(film.radarr_id)
    if (!status.hasFile || !status.movieFile?.path) { setStatus(filmId, 'pending'); return; }
    const moviePath = status.movieFile.path                 // ex /movies/Titre (Année)/x.mkv
    const relFromMovies = moviePath.replace(/^\/movies\//, '')
    const mkv = join(LIBRARY, relFromMovies)
    const mediaDir = mediaDirFromMoviePath(moviePath)
    const outDir = join(FILMS, mediaDir)
    const log = (msg: string) => console.log(`[processFilm] "${film.title}": ${msg}`)

    try {
        // Idempotence: si vo.mp4 existe déjà, on considère fait
        try {
            await access(join(outDir, 'vo.mp4'))
            setStatus(filmId, 'done', 100)
            updateFilmMedia(filmId, { media_dir: mediaDir, file_path_vo_transcoded: `${mediaDir}/vo.mp4` })
            return
        } catch { /* vo.mp4 absent → on continue le traitement */ }

        setStatus(filmId, 'probing', 0)
        log('probe ffprobe…')
        const { streams } = await probeStreams(mkv)
        const tracks = identifyTracks(streams, film.original_language)
        if (tracks.voAudioIndex == null) throw new Error('aucune piste audio détectée')
        log(
            `pistes: VO idx ${tracks.voAudioIndex} (ordinal ${tracks.voAudioOrdinal})` +
            (tracks.vfAudioIndex != null ? `, VF idx ${tracks.vfAudioIndex} (ordinal ${tracks.vfAudioOrdinal})` : ' (pas de VF)') +
            (tracks.textSubs.length ? `, subs ${tracks.textSubs.map(s => s.lang).join('+')}` : ' (aucun sub texte)') +
            (tracks.imageSubsFlagged ? ' ⚠️ subs IMAGE ignorés' : '')
        )
        await mkdir(outDir, { recursive: true })

        // 2. Transcode distant EN PREMIER — démarre le GPU au plus tôt (l'upload rame sur le SSHFS)
        setStatus(filmId, 'transcoding_remote', 0)
        const voOrdinal = tracks.voAudioOrdinal ?? audioOrdinal(streams, tracks.voAudioIndex)
        log(`upload + transcode GPU (audio VO ordinal ${voOrdinal})…`)
        const job = await createJob(mkv, { targetHeight: 1080, preset: 'p4', targetBitrate: '4M', audioOrdinal: voOrdinal })
        log(`job ${job.id} créé côté service`)
        await waitForJob(job.id, pct => {
            setStatus(filmId, 'transcoding_remote', pct)
            log(`transcode ${pct.toFixed(0)}%`)
        })
        log('transcode terminé, téléchargement vo.mp4…')
        await downloadOutput(job.id, join(outDir, 'vo.mp4'))
        log('vo.mp4 écrit')

        // 3. Mux VF local si présent
        let vfRel: string | null = null
        if (tracks.vfAudioIndex != null) {
            setStatus(filmId, 'muxing', 90)
            const vfOrdinal = tracks.vfAudioOrdinal ?? audioOrdinal(streams, tracks.vfAudioIndex)
            log(`mux VF local (audio ordinal ${vfOrdinal})…`)
            await muxVf(join(outDir, 'vo.mp4'), mkv, vfOrdinal, join(outDir, 'vf.mp4'))
            vfRel = `${mediaDir}/vf.mp4`
            log('vf.mp4 écrit')
        }

        // 4. Subs
        setStatus(filmId, 'subtitles', 95)
        const subCols: Record<string, string> = {}
        for (const s of tracks.textSubs) {
            const srt = `sub.${s.lang}.srt`, vtt = `sub.${s.lang}.vtt`
            log(`extraction sub ${s.lang} (idx ${s.streamIndex})…`)
            await extractSub(mkv, s.streamIndex, join(outDir, srt), join(outDir, vtt))
            subCols[`subtitle_${s.lang}_srt`] = `${mediaDir}/${srt}`
            subCols[`subtitle_${s.lang}_vtt`] = `${mediaDir}/${vtt}`
        }
        if (tracks.imageSubsFlagged) console.warn(`[processFilm] "${film.title}": subs IMAGE non extraits (PGS/VOBSUB)`)

        // 5. Backup du MKV EN DERNIER (best-effort : on ne bloque pas la dispo si le SSHFS flanche)
        setStatus(filmId, 'backing_up', 98)
        let backedUp = false
        try {
            log('backup original.mkv (SSHFS)…')
            const backupDir = join(BACKUP, mediaDir)
            await mkdir(backupDir, { recursive: true })
            await copyFile(mkv, join(backupDir, 'original.mkv'))
            backedUp = true
            log('backup OK')
        } catch (err) {
            console.warn(`[processFilm] "${film.title}": backup échoué (${err instanceof Error ? err.message : String(err)}) — le MKV restera dans library`)
        }

        // 6. DB + dispo
        updateFilmMedia(filmId, {
            media_dir: mediaDir,
            file_path_vo_transcoded: `${mediaDir}/vo.mp4`,
            file_path_vf_transcoded: vfRel,
            ...subCols,
        })
        db.prepare('UPDATE films SET is_available = 1 WHERE id = ?').run(filmId)
        setStatus(filmId, 'done', 100)

        // 7. Supprimer le MKV de la library (seulement si backup OK)
        if (backedUp) {
            log('suppression MKV de la library…')
            await rm(join(LIBRARY, mediaDir), { recursive: true, force: true })
        } else {
            log('backup non fait — MKV conservé dans library')
        }

        // 8. "Verrou" Radarr
        await setMonitored(film.radarr_id, false)
        log('OK → dispo dans le videoclub')
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[processFilm] Erreur "${film.title}":`, msg)
        setStatus(filmId, 'error', 0, msg)
        // NB: on ne supprime PAS le MKV, on ne unmonitor PAS → retriable
        throw err
    }
}

// File d'attente simple pour éviter N uploads 12Go simultanés
const queue: number[] = []
let active = 0
const MAX = Number(process.env.PROCESS_MAX_CONCURRENT || 1)
export function enqueueProcessFilm(filmId: number): void {
    if (queue.includes(filmId)) return
    queue.push(filmId)
    drain()
}
function drain(): void {
    while (active < MAX && queue.length) {
        const id = queue.shift()!
        active++
        processFilm(id).catch(() => {}).finally(() => { active--; drain() })
    }
}
