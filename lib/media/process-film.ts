import { join } from 'path'
import { mkdir, copyFile, rm, access, stat } from 'fs/promises'
import { db } from '../db'
import { getFilmById, updateFilmMedia } from '../films'
import { getMovieStatus, setMonitored, rejectCurrentRelease } from '../radarr'
import { probeStreams } from './probe'
import { identifyTracks } from './identify-tracks'
import { isFrench } from './iso639'
import { mediaDirFromMoviePath } from './media-dir'
import { encodeVideoRemote } from './remote-encode'
import { encodeAudioTracks, remuxOutputs, extractSubs, type AudioTarget, type RemuxTarget } from './ffmpeg-ops'
import { planVideo } from './video-plan'
import { checkRelease, maxQcAttempts } from './quality-control'

const LIBRARY = process.env.MEDIA_LIBRARY_PATH || '/media/library'   // MKV bruts (mount raw Radarr)
const FILMS = process.env.MEDIA_FILMS_PATH || '/media/films'          // sorties transcodées
const BACKUP = process.env.MEDIA_BACKUP_PATH || '/media/backup/zone-club'

function setStatus(filmId: number, status: string, progress = 0, error: string | null = null): void {
    db.prepare('UPDATE films SET transcode_status=?, transcode_progress=?, transcode_error=? WHERE id=?')
        .run(status, progress, error, filmId)
}

async function exists(p: string): Promise<boolean> {
    try { await access(p); return true } catch { return false }
}

// Copie du MKV source vers le backup SSHFS, lancée EN PARALLÈLE de l'encodage.
//
// Les deux tiennent largement ensemble : l'encodage pousse ~16 Mo/s vers le Spark
// (il est limité par le GPU, pas par le réseau) et le backup ~10 Mo/s vers Hetzner,
// sur un lien mesuré à 58 Mo/s et un disque source à 82 Mo/s. En série, le backup
// ajoutait 10 à 20 min au bout-en-bout ; en parallèle il disparaît derrière
// l'encodage.
//
// Ne rejette jamais : un backup raté ne doit pas empêcher la publication du film
// (il empêche seulement la suppression du MKV, voir releaseSource).
const backupsInFlight = new Set<string>()

async function backupSource(mkv: string, mediaDir: string, title: string): Promise<boolean> {
    const log = (msg: string) => console.log(`[backup] "${title}": ${msg}`)
    if (backupsInFlight.has(mediaDir)) {
        log('backup déjà en cours pour ce dossier — nouvelle copie ignorée')
        return false
    }
    backupsInFlight.add(mediaDir)
    try {
        const backupDir = join(BACKUP, mediaDir)
        const dest = join(backupDir, 'original.mkv')
        // Idempotence : depuis que le backup démarre en tête de pipeline, le moindre
        // retraitement (retry, refresh, correctif de subs) le relancerait. Une copie
        // de même taille est déjà la bonne — inutile de repousser plusieurs Go sur
        // un lien à 10 Mo/s.
        const [srcStat, destStat] = await Promise.all([
            stat(mkv).catch(() => null),
            stat(dest).catch(() => null),
        ])
        if (srcStat && destStat && srcStat.size === destStat.size) {
            log(`backup déjà présent et de même taille (${(destStat.size / 1e9).toFixed(1)} Go) — copie sautée`)
            return true
        }
        log('début backup SSHFS (en parallèle de l\'encodage)…')
        const started = Date.now()
        await mkdir(backupDir, { recursive: true })
        await copyFile(mkv, dest)
        log(`backup OK en ${((Date.now() - started) / 1000).toFixed(0)}s`)
        return true
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[backup] Erreur "${title}": ${msg} — MKV conservé dans library`)
        return false
    } finally {
        backupsInFlight.delete(mediaDir)
    }
}

// Supprime le MKV de la library et unmonitor Radarr ("verrou" : le film reste
// catalogué mais Radarr ne relance plus de recherche).
//
// À n'appeler qu'une fois le backup réussi ET le traitement terminé : le mux lit
// l'audio directement dans le MKV source, donc une suppression déclenchée à la fin
// de la copie — qui se termine avant le mux — effacerait un fichier encore ouvert.
// DELETE_MKV_AFTER_BACKUP=false inhibe la suppression (debug).
async function releaseSource(mediaDir: string, title: string, radarrId: number): Promise<void> {
    const log = (msg: string) => console.log(`[backup] "${title}": ${msg}`)
    if (process.env.DELETE_MKV_AFTER_BACKUP === 'false') {
        log('DELETE_MKV_AFTER_BACKUP=false → MKV conservé dans library, pas de unmonitor')
        return
    }
    try {
        log('suppression MKV library…')
        await rm(join(LIBRARY, mediaDir), { recursive: true, force: true })
        log('MKV supprimé, unmonitor Radarr…')
        await setMonitored(radarrId, false)
        log('terminé')
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[backup] Erreur libération "${title}": ${msg}`)
    }
}

// Release qui ne remplit pas le contrat : on la jette et on en cherche une autre,
// jusqu'à QC_MAX_ATTEMPTS. Passé ce plafond on flagge le film et on s'arrête —
// certains films n'ont tout simplement pas de release conforme, et boucler dessus
// brûlerait de la bande passante sans fin.
async function rejectRelease(
    filmId: number,
    film: { title: string; radarr_id: number | null; qc_attempts: number },
    missing: string[],
    log: (msg: string) => void,
): Promise<void> {
    const attempts = (film.qc_attempts ?? 0) + 1
    const max = maxQcAttempts()
    const why = missing.join(', ')
    db.prepare('UPDATE films SET qc_attempts = ? WHERE id = ?').run(attempts, filmId)

    if (attempts >= max) {
        log(`release refusée (${why}) — ${attempts}/${max} tentatives, film flaggé pour traitement manuel`)
        // On ne supprime rien : le fichier reste disponible si tu veux t'en servir.
        setStatus(filmId, 'qc_failed', 0, `${max} releases refusées, dernière: ${why}`)
        return
    }

    log(`release refusée (${why}) — tentative ${attempts}/${max}, blacklist + nouvelle recherche`)
    setStatus(filmId, 'rejected_release', 0, `manque: ${why}`)
    try {
        const rejected = await rejectCurrentRelease(film.radarr_id!)
        log(`release "${rejected ?? '?'}" blacklistée, recherche relancée`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`échec du rejet côté Radarr: ${msg}`)
        setStatus(filmId, 'error', 0, `rejet Radarr impossible: ${msg}`)
    }
}

export async function processFilm(filmId: number): Promise<void> {
    const film = getFilmById(filmId)
    if (!film || !film.radarr_id) throw new Error(`processFilm: film ${filmId} sans radarr_id`)

    // 1. Localiser le MKV via Radarr
    const status = await getMovieStatus(film.radarr_id)
    if (!status.hasFile || !status.movieFile?.path) { setStatus(filmId, 'pending'); return; }
    const radarrRoot = process.env.RADARR_ROOT_FOLDER || '/movies'
    const moviePath = status.movieFile.path                 // ex /movies/Titre (Année)/x.mkv
    const relPath = moviePath.startsWith(radarrRoot + '/')
        ? moviePath.slice(radarrRoot.length + 1)              // Titre (Année)/x.mkv
        : moviePath.replace(/^\/movies\//, '')                // fallback ancien format
    const mkv = join(LIBRARY, relPath)
    // Double-check: Radarr peut avoir hasFile=true obsolète (fichier supprimé hors Radarr)
    try { await access(mkv) } catch { setStatus(filmId, 'pending'); return; }
    const mediaDir = mediaDirFromMoviePath(moviePath)
    const outDir = join(FILMS, mediaDir)
    const log = (msg: string) => console.log(`[processFilm] "${film.title}": ${msg}`)

    const voMp4 = join(outDir, 'vo.mp4')
    const vfMp4 = join(outDir, 'vf.mp4')
    const videoMkv = join(outDir, 'video.mkv')   // intermédiaire: vidéo encodée sans audio
    const voAac = join(outDir, 'audio.vo.m4a')   // intermédiaires: audio encodé pendant que le GPU travaille
    const vfAac = join(outDir, 'audio.vf.m4a')

    try {
        // 2. Probe + identification (rapide, ré-exécuté à chaque reprise — pas de persistance nécessaire)
        setStatus(filmId, 'probing', 0)
        log('probe ffprobe…')
        const { streams, duration: sourceDuration, size: sourceSize } = await probeStreams(mkv)
        const tracks = identifyTracks(streams, film.original_language)
        if (tracks.voAudioOrdinal == null) throw new Error('aucune piste audio détectée')
        const frenchFilm = isFrench(film.original_language)
        const videoStream = streams.find(s => s.codec_type === 'video')
        const sourceHeight = videoStream?.height ?? null
        const sourceWidth = videoStream?.width ?? null
        // Film FR natif : la piste "VO" est déjà la VF, un seul fichier suffit.
        const wantVf = tracks.vfAudioOrdinal != null && !frenchFilm
        log(
            `pistes: VO ordinal ${tracks.voAudioOrdinal}` +
            (wantVf ? `, VF ordinal ${tracks.vfAudioOrdinal}` : ' (pas de VF séparée)') +
            (tracks.textSubs.length ? `, subs ${tracks.textSubs.map(s => s.lang).join('+')}` : ' (aucun sub texte)') +
            (tracks.imageSubsFlagged ? ' ⚠️ subs IMAGE ignorés' : '') +
            (frenchFilm ? ' 🇫🇷 film FR natif' : '') +
            ` | source ${sourceDuration.toFixed(0)}s ${sourceWidth ?? '?'}×${sourceHeight ?? '?'}`
        )
        // 2bis. Contrôle qualité de la release, AVANT tout travail coûteux : rien ne
        //       sert de sauvegarder puis d'encoder une release qu'on va rejeter.
        //
        //       Un film déjà publié depuis cette release y échappe : le QC est un
        //       filtre à l'entrée, pas un juge rétroactif. Sans cette porte, un simple
        //       retraitement (correctif de subs, reprise) ferait blacklister et
        //       supprimer une release qui sert déjà dans le vidéoclub.
        const alreadyPublished = film.transcode_status === 'done' && (await exists(voMp4))
        if (alreadyPublished) {
            log('film déjà publié depuis cette release — contrôle qualité non rejoué')
        } else {
            const verdict = checkRelease(tracks, film.original_language)
            if (!verdict.ok) {
                await rejectRelease(filmId, film, verdict.missing, log)
                return
            }
        }

        await mkdir(outDir, { recursive: true })

        // Backup lancé maintenant, pas à la fin : il tourne pendant l'encodage.
        // On garde la promesse pour ne libérer la source qu'une fois la copie finie.
        const backupDone = backupSource(mkv, mediaDir, film.title)

        // 3 + 4. Vidéo (GPU distant ou copie directe) et audio/sous-titres EN PARALLÈLE,
        //        puis remux final en copie pure.
        //        Skippés si les sorties finales sont déjà là (reprise après crash).
        const subCols: Record<string, string> = {}
        if (!(await exists(voMp4)) || (wantVf && !(await exists(vfMp4)))) {
            const plan = planVideo(streams, sourceSize, sourceDuration)
            let encodedDuration: number | null = null

            // Ni l'audio ni les sous-titres ne dépendent de la vidéo encodée : ils
            // partent maintenant et se terminent pendant que le GPU travaille. Le
            // chemin critique se réduit alors au seul remux (mesuré 8,4× plus rapide
            // qu'un mux qui décode et réencode l'audio).
            const audioTargets: AudioTarget[] = [{ out: voAac, audioOrdinal: tracks.voAudioOrdinal }]
            if (wantVf) audioTargets.push({ out: vfAac, audioOrdinal: tracks.vfAudioOrdinal! })
            const sideWork = (async () => {
                const todo = await Promise.all(audioTargets.map(async t => (await exists(t.out)) ? null : t))
                const missing = todo.filter((t): t is AudioTarget => t !== null)
                if (missing.length) {
                    log(`encodage audio ${missing.length} piste(s) → AAC stéréo (en parallèle de la vidéo)…`)
                    await encodeAudioTracks(mkv, missing)
                    log('audio encodé')
                } else {
                    log('audio déjà encodé — étape sautée')
                }
                if (tracks.textSubs.length) {
                    log(`extraction de ${tracks.textSubs.length} piste(s) sub candidate(s) en une passe…`)
                    for (const s of await extractSubs(mkv, tracks.textSubs, outDir)) {
                        log(`sub ${s.lang}: ${s.cues} cues retenues`)
                        subCols[`subtitle_${s.lang}_srt`] = `${mediaDir}/sub.${s.lang}.srt`
                        subCols[`subtitle_${s.lang}_vtt`] = `${mediaDir}/sub.${s.lang}.vtt`
                    }
                }
            })()
            // Sans ce catch immédiat, un échec de la branche parallèle remonterait en
            // rejet non géré pendant qu'on attend la vidéo.
            let sideError: unknown = null
            sideWork.catch(err => { sideError = err })

            if (plan.action === 'copy') {
                log(`vidéo copiée sans réencodage — ${plan.reason}`)
            } else if (await exists(videoMkv)) {
                log('video.mkv déjà présent — encodage skippé')
            } else {
                log(`réencodage nécessaire — ${plan.reason}`)
                setStatus(filmId, 'transcoding_remote', 0)
                log('encodage GPU distant (démux vidéo seule → pipe SSH → nvenc)…')
                const t0 = Date.now()
                let lastLog = 0
                encodedDuration = await encodeVideoRemote(mkv, videoMkv, {
                    sourceHeight,
                    sourceWidth,
                    expectedDuration: sourceDuration,
                    onProgress: p => {
                        const pct = sourceDuration > 0 ? Math.min(100, (p.outSeconds / sourceDuration) * 100) : 0
                        setStatus(filmId, 'transcoding_remote', pct)
                        // ffmpeg émet ~2 événements/s : on ne loggue qu'une fois par minute.
                        if (Date.now() - lastLog >= 60_000) {
                            lastLog = Date.now()
                            log(`encodage ${pct.toFixed(0)}% (${p.speed.toFixed(1)}×, ${p.fps.toFixed(0)} fps)`)
                        }
                    },
                })
                log(`encodage terminé en ${((Date.now() - t0) / 1000).toFixed(0)}s`)
            }

            // Le contrôle anti-troncature vit dans encodeVideoRemote (il rejette et
            // nettoie tout seul) ; ici on ne fait que tracer.
            if (encodedDuration != null && sourceDuration > 0) {
                log(`durée encodée: ${encodedDuration.toFixed(0)}s (${((encodedDuration / sourceDuration) * 100).toFixed(1)}% de la source)`)
            }

            // On rejoint la branche parallèle avant d'assembler.
            setStatus(filmId, 'muxing', 90)
            await sideWork
            if (sideError) throw sideError

            const videoSrc = plan.action === 'copy' ? mkv : videoMkv
            const targets: RemuxTarget[] = [{ out: voMp4, audio: voAac }]
            if (wantVf) targets.push({ out: vfMp4, audio: vfAac })
            log(`remux ${targets.length} sortie(s) en copie pure…`)
            const t1 = Date.now()
            await remuxOutputs(videoSrc, targets)
            log(`vo.mp4${wantVf ? ' + vf.mp4' : ''} écrits en ${((Date.now() - t1) / 1000).toFixed(0)}s`)
            await Promise.all([
                rm(videoMkv, { force: true }),
                rm(voAac, { force: true }),
                rm(vfAac, { force: true }),
            ])
        } else {
            log('sorties déjà présentes — vidéo, audio et mux skippés')
            // Les sorties existent mais la DB peut être à refaire (retraitement) :
            // on relit les sous-titres présents pour repeupler les colonnes.
            for (const lang of ['fr', 'en'] as const) {
                if (await exists(join(outDir, `sub.${lang}.vtt`))) {
                    subCols[`subtitle_${lang}_srt`] = `${mediaDir}/sub.${lang}.srt`
                    subCols[`subtitle_${lang}_vtt`] = `${mediaDir}/sub.${lang}.vtt`
                }
            }
        }

        const vfRel = wantVf ? `${mediaDir}/vf.mp4` : (frenchFilm ? `${mediaDir}/vo.mp4` : null)

        // Les sous-titres ont été extraits dans la phase parallèle (subCols rempli là).
        if (tracks.imageSubsFlagged) console.warn(`[processFilm] "${film.title}": subs IMAGE non extraits (PGS/VOBSUB)`)

        // 6. DB + dispo immédiate — UNIQUEMENT ici, une fois tout terminé.
        //    (ne pas écrire file_path_vo_transcoded avant : getPendingFilms() s'en sert pour la reprise)
        updateFilmMedia(filmId, {
            media_dir: mediaDir,
            file_path_vo_transcoded: `${mediaDir}/vo.mp4`,
            file_path_vf_transcoded: vfRel,
            ...subCols,
        })
        db.prepare('UPDATE films SET is_available = 1 WHERE id = ?').run(filmId)
        setStatus(filmId, 'done', 100)
        log('OK → dispo dans le videoclub')

        // 7. Libération de la source, une fois le backup terminé. Non-bloquant :
        //    ne retient pas la queue d'encodage. Si le backup a échoué, le MKV
        //    reste en place et le film reste monitored → retraitable.
        const radarrId = film.radarr_id
        backupDone.then(ok => (ok ? releaseSource(mediaDir, film.title, radarrId) : undefined))
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[processFilm] Erreur "${film.title}":`, msg)
        setStatus(filmId, 'error', 0, msg)
        // NB: on ne supprime PAS le MKV, on ne unmonitor PAS → retriable
        throw err
    }
}

// File d'attente : un seul encodage à la fois par défaut (le GPU du Spark est
// partagé avec le service HTTP de Pablo).
// `active` protège aussi contre le double traitement : le poller re-sélectionne
// un film tant que file_path_vo_transcoded est NULL, donc tant qu'il n'a pas
// terminé — sans ce garde, il serait ré-enfilé et retraité une seconde fois
// (re-copie du backup de plusieurs Go sur le SSHFS).
const queue: number[] = []
const active = new Set<number>()
const MAX = Number(process.env.PROCESS_MAX_CONCURRENT || 1)

export function enqueueProcessFilm(filmId: number): void {
    if (queue.includes(filmId) || active.has(filmId)) return
    queue.push(filmId)
    drain()
}

function drain(): void {
    while (active.size < MAX && queue.length) {
        const id = queue.shift()!
        active.add(id)
        processFilm(id).catch(() => {}).finally(() => { active.delete(id); drain() })
    }
}
