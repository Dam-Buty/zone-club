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
import { planVideo, estimateVideoBitrate, isHdrSource } from './video-plan'
import { checkRelease, maxQcAttempts } from './quality-control'
import { startRun, patchRun, finishRun } from './run-stats'

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

// Les backups s'exécutent EN FILE, un seul à la fois.
//
// backupDone est délibérément non bloquant : le film est publié sans attendre sa
// copie. Mais du coup, le film suivant démarrait la sienne pendant que la
// précédente tournait encore, et rien ne les limitait. Sur vingt films d'affilée,
// plusieurs copies SSHFS se disputaient le lien Hetzner et étranglaient tout le
// reste — mesuré : 40 s pour le premier backup, 283 s, 1378 s, 4765 s, jusqu'à
// 7307 s pour le dernier. Les colonnes de The Murderer le montrent bien
// (enc=1379 aud=1378 sub=1378 bkp=1378 : quatre étapes au rythme du disque).
//
// Les sérialiser ne coûte rien puisqu'ils sont hors du chemin critique, et rend
// le reste plus rapide.
let backupChain: Promise<unknown> = Promise.resolve()

function queueBackup<T>(task: () => Promise<T>): Promise<T> {
    const run = backupChain.then(task, task)
    // La chaîne ne doit jamais rester en état rejeté, sinon tous les backups
    // suivants seraient court-circuités.
    backupChain = run.catch(() => {})
    return run
}

async function backupSource(mkv: string, mediaDir: string, title: string): Promise<{ ok: boolean; seconds: number }> {
    const log = (msg: string) => console.log(`[backup] "${title}": ${msg}`)
    const startedAt = Date.now()
    if (backupsInFlight.has(mediaDir)) {
        log('backup déjà en cours pour ce dossier — nouvelle copie ignorée')
        return { ok: false, seconds: 0 }
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
            return { ok: true, seconds: 0 }
        }
        log('début backup SSHFS (en parallèle de l\'encodage)…')
        await mkdir(backupDir, { recursive: true })
        await copyFile(mkv, dest)
        const seconds = (Date.now() - startedAt) / 1000
        log(`backup OK en ${seconds.toFixed(0)}s`)
        return { ok: true, seconds }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[backup] Erreur "${title}": ${msg} — MKV conservé dans library`)
        return { ok: false, seconds: (Date.now() - startedAt) / 1000 }
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

    // Renseigné quand les jobs latéraux démarrent ; sert au nettoyage en cas d'échec.
    let sideAbortRef: AbortController | null = null

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

    const runStartedAt = Date.now()
    const runId = startRun(filmId)

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
            (tracks.imageSubs.length ? `, subs image ${tracks.imageSubs.map(s => s.lang).join('+')} (OCR)` : '') +
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
        patchRun(runId, {
            source_bytes: sourceSize,
            source_seconds: sourceDuration,
            source_video_codec: videoStream?.codec_name ?? null,
            source_video_height: sourceHeight,
            source_video_bitrate: estimateVideoBitrate(streams, sourceSize, sourceDuration),
        })

        const alreadyPublished = film.transcode_status === 'done' && (await exists(voMp4))
        if (alreadyPublished) {
            log('film déjà publié depuis cette release — contrôle qualité non rejoué')
        } else {
            const verdict = checkRelease(tracks, film.original_language)
            if (!verdict.ok) {
                await rejectRelease(filmId, film, verdict.missing, log)
                finishRun(runId, 'rejected', runStartedAt, verdict.missing.join(', '))
                return
            }
        }

        await mkdir(outDir, { recursive: true })

        // Backup lancé maintenant, pas à la fin : il tourne pendant l'encodage.
        // On garde la promesse pour ne libérer la source qu'une fois la copie finie.
        const backupDone = queueBackup(() => backupSource(mkv, mediaDir, film.title))

        // 3 + 4. Vidéo (GPU distant ou copie directe) et audio/sous-titres EN PARALLÈLE,
        //        puis remux final en copie pure.
        //        Skippés si les sorties finales sont déjà là (reprise après crash).
        const subCols: Record<string, string> = {}
        // Distingue un vrai traitement d'un passage à vide (reprise, refresh sur un
        // film déjà publié) : sans ça, les runs à 0,2 s pollueraient les moyennes.
        let didWork = false
        if (!(await exists(voMp4)) || (wantVf && !(await exists(vfMp4)))) {
            didWork = true
            const plan = planVideo(streams, sourceSize, sourceDuration)
            let encodedDuration: number | null = null

            // Ni l'audio ni les sous-titres ne dépendent de la vidéo encodée : ils
            // partent maintenant et se terminent pendant que le GPU travaille. Le
            // chemin critique se réduit alors au seul remux (mesuré 8,4× plus rapide
            // qu'un mux qui décode et réencode l'audio).
            // Les jobs latéraux tournent en parallèle de l'encodage GPU : s'il
            // échoue, il faut les TUER, sinon leurs ffmpeg survivent au film
            // abandonné et s'accumulent à chaque reprise du poller.
            const sideAbort = new AbortController()
            sideAbortRef = sideAbort
            const audioTargets: AudioTarget[] = [{ out: voAac, audioOrdinal: tracks.voAudioOrdinal }]
            if (wantVf) audioTargets.push({ out: vfAac, audioOrdinal: tracks.vfAudioOrdinal! })
            const audioJob = (async () => {
                const t = Date.now()
                const todo = await Promise.all(audioTargets.map(async t => (await exists(t.out)) ? null : t))
                const missing = todo.filter((t): t is AudioTarget => t !== null)
                if (missing.length) {
                    log(`encodage audio ${missing.length} piste(s) → AAC stéréo (en parallèle de la vidéo)…`)
                    await encodeAudioTracks(mkv, missing, sideAbort.signal)
                    log('audio encodé')
                    patchRun(runId, { audio_seconds: (Date.now() - t) / 1000 })
                } else {
                    log('audio déjà encodé — étape sautée')
                }
            })()

            const subsJob = (async () => {
                // Les pistes image partent avec les autres : elles sont extraites en
                // .sup dans la même passe, puis converties par OCR seulement si la
                // piste texte de la langue manque ou ressemble à une piste forcée.
                const subCandidates = [
                    ...tracks.textSubs.map(s => ({ ...s, kind: 'text' as const })),
                    ...tracks.imageSubs.map(s => ({ ...s, kind: 'image' as const })),
                ]
                if (!subCandidates.length) return
                const t = Date.now()
                const nImg = tracks.imageSubs.length
                log(`extraction de ${subCandidates.length} piste(s) sub candidate(s) en une passe…`
                    + (nImg ? ` (dont ${nImg} image, OCR si nécessaire)` : ''))
                const kept = await extractSubs(mkv, subCandidates, outDir, sideAbort.signal)
                for (const s of kept) {
                    log(`sub ${s.lang}: ${s.cues} cues retenues`)
                    subCols[`subtitle_${s.lang}_srt`] = `${mediaDir}/sub.${s.lang}.srt`
                    subCols[`subtitle_${s.lang}_vtt`] = `${mediaDir}/sub.${s.lang}.vtt`
                }
                patchRun(runId, {
                    subs_seconds: (Date.now() - t) / 1000,
                    sub_langs: kept.map(s => s.lang).join('+') || null,
                })
            })()

            // Audio et sous-titres côte à côte, pas l'un après l'autre : ils ne
            // dépendent que du MKV source. Enchaînés, l'extraction ne démarrait
            // qu'à la fin de l'audio et débordait de la fenêtre d'encodage — 109 s
            // ajoutées au chemin critique sur Interstellar.
            // allSettled plutôt que all : si l'un échoue, l'autre garde un
            // gestionnaire et ne remonte pas en rejet non géré.
            const sideWork = (async () => {
                const results = await Promise.allSettled([audioJob, subsJob])
                const failed = results.find(r => r.status === 'rejected')
                if (failed) throw (failed as PromiseRejectedResult).reason
            })()
            // Sans ce catch immédiat, un échec de la branche parallèle remonterait en
            // rejet non géré pendant qu'on attend la vidéo.
            let sideError: unknown = null
            sideWork.catch(err => { sideError = err })

            patchRun(runId, { video_action: plan.action, video_reason: plan.reason })

            if (plan.action === 'copy') {
                log(`vidéo copiée sans réencodage — ${plan.reason}`)
            } else if (await exists(videoMkv)) {
                log('video.mkv déjà présent — encodage skippé')
            } else {
                log(`réencodage nécessaire — ${plan.reason}`)
                const hdr = isHdrSource(streams)
                if (hdr) {
                    log(`source ${hdr} → tonemapping libplacebo vers BT.709 (environ −34 % de vitesse)`)
                }
                setStatus(filmId, 'transcoding_remote', 0)
                log('encodage GPU distant (démux vidéo seule → pipe SSH → nvenc)…')
                const t0 = Date.now()
                let lastLog = 0
                encodedDuration = await encodeVideoRemote(mkv, videoMkv, {
                    sourceHeight,
                    sourceWidth,
                    hdr,
                    sourceCodec: videoStream?.codec_name ?? null,
                    sourcePixFmt: videoStream?.pix_fmt ?? null,
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
                const encodeSeconds = (Date.now() - t0) / 1000
                log(`encodage terminé en ${encodeSeconds.toFixed(0)}s`)
                patchRun(runId, { encode_seconds: encodeSeconds })
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
            const remuxSeconds = (Date.now() - t1) / 1000
            log(`vo.mp4${wantVf ? ' + vf.mp4' : ''} écrits en ${remuxSeconds.toFixed(0)}s`)
            patchRun(runId, { remux_seconds: remuxSeconds })
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
        // Alerte seulement si une piste image existait ET qu'aucun sous-titre n'a
        // survécu : l'OCR a échoué, ce qui mérite un regard. Le cas nominal (OCR
        // réussi, ou piste texte préférée) ne dit plus rien.
        if (tracks.imageSubs.length && !Object.keys(subCols).length) {
            console.warn(`[processFilm] "${film.title}": OCR des subs image sans résultat (PGS/VOBSUB)`)
        }

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

        const [voStat, vfStat] = await Promise.all([
            stat(voMp4).catch(() => null),
            wantVf ? stat(vfMp4).catch(() => null) : Promise.resolve(null),
        ])
        patchRun(runId, { vo_bytes: voStat?.size ?? null, vf_bytes: vfStat?.size ?? null })
        finishRun(runId, didWork ? 'done' : 'skipped', runStartedAt)

        // 7. Libération de la source, une fois le backup terminé. Non-bloquant :
        //    ne retient pas la queue d'encodage. Si le backup a échoué, le MKV
        //    reste en place et le film reste monitored → retraitable.
        const radarrId = film.radarr_id
        backupDone.then(r => {
            patchRun(runId, { backup_seconds: r.seconds })
            // r.ok et non r : depuis que backupSource renvoie un objet, tester la
            // valeur elle-même serait toujours vrai — et supprimerait le MKV même
            // après un backup échoué.
            return r.ok ? releaseSource(mediaDir, film.title, radarrId) : undefined
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Couper l'audio et les sous-titres AVANT de rendre la main : sans ça le
        // film sort de `active`, le poller le remet en file, et une nouvelle paire
        // de ffmpeg démarre pendant que l'ancienne lit encore le MKV.
        sideAbortRef?.abort()
        console.error(`[processFilm] Erreur "${film.title}":`, msg)
        setStatus(filmId, 'error', 0, msg)
        finishRun(runId, 'error', runStartedAt, msg)
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
