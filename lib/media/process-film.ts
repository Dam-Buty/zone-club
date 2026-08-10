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

function setStatus(filmId: number, status: string, progress = 0, error: string | null = null) {
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

    try {
        // Idempotence: si vo.mp4 existe déjà, on considère fait
        try {
            await access(join(outDir, 'vo.mp4'))
            setStatus(filmId, 'done', 100)
            updateFilmMedia(filmId, { media_dir: mediaDir, file_path_vo_transcoded: `${mediaDir}/vo.mp4` })
            return
        } catch {}

        setStatus(filmId, 'probing', 0)
        const { streams } = await probeStreams(mkv)
        const tracks = identifyTracks(streams, film.original_language)
        if (tracks.voAudioIndex == null) throw new Error('aucune piste audio détectée')

        await mkdir(outDir, { recursive: true })

        // 2. Backup MKV
        setStatus(filmId, 'backing_up', 0)
        const backupDir = join(BACKUP, mediaDir)
        await mkdir(backupDir, { recursive: true })
        await copyFile(mkv, join(backupDir, 'original.mkv'))

        // 3. Transcode vidéo GPU (audio = VO)
        setStatus(filmId, 'transcoding_remote', 0)
        const voOrdinal = tracks.voAudioOrdinal ?? audioOrdinal(streams, tracks.voAudioIndex)
        const job = await createJob(mkv, { targetHeight: 1080, preset: 'p4', targetBitrate: '4M', audioOrdinal: voOrdinal })
        await waitForJob(job.id, pct => setStatus(filmId, 'transcoding_remote', pct))
        await downloadOutput(job.id, join(outDir, 'vo.mp4'))

        // 4. Mux VF local si présent
        let vfRel: string | null = null
        if (tracks.vfAudioIndex != null) {
            setStatus(filmId, 'muxing', 90)
            const vfOrdinal = tracks.vfAudioOrdinal ?? audioOrdinal(streams, tracks.vfAudioIndex)
            await muxVf(join(outDir, 'vo.mp4'), mkv, vfOrdinal, join(outDir, 'vf.mp4'))
            vfRel = `${mediaDir}/vf.mp4`
        }

        // 5. Subs
        setStatus(filmId, 'subtitles', 95)
        const subCols: Record<string, string> = {}
        for (const s of tracks.textSubs) {
            const srt = `sub.${s.lang}.srt`, vtt = `sub.${s.lang}.vtt`
            await extractSub(mkv, s.streamIndex, join(outDir, srt), join(outDir, vtt))
            subCols[`subtitle_${s.lang}_srt`] = `${mediaDir}/${srt}`
            subCols[`subtitle_${s.lang}_vtt`] = `${mediaDir}/${vtt}`
        }
        if (tracks.imageSubsFlagged) console.warn(`[processFilm] "${film.title}" a des subs IMAGE non extraits (PGS/VOBSUB)`)

        // 6. DB
        updateFilmMedia(filmId, {
            media_dir: mediaDir,
            file_path_vo_transcoded: `${mediaDir}/vo.mp4`,
            file_path_vf_transcoded: vfRel,
            ...subCols,
        })
        db.prepare('UPDATE films SET is_available = 1 WHERE id = ?').run(filmId)
        setStatus(filmId, 'done', 100)

        // 7. Supprimer le MKV (dossier)
        await rm(join(LIBRARY, mediaDir), { recursive: true, force: true })

        // 8. "Verrou" Radarr
        await setMonitored(film.radarr_id, false)
        console.log(`[processFilm] OK "${film.title}" → ${mediaDir}`)
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
function drain() {
    while (active < MAX && queue.length) {
        const id = queue.shift()!
        active++
        processFilm(id).catch(() => {}).finally(() => { active--; drain() })
    }
}
