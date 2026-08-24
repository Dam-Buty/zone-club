import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { pipeline } from 'stream/promises'

// Encodage vidéo GPU sur le Spark via un pipe SSH.
//
// Remplace l'ancien service HTTP (upload → poll → download) : les trois phases
// se recouvrent au lieu de s'additionner, le Spark n'écrit aucun octet sur son
// disque, et le temps total tombe à celui du seul encodage.
//
//   ffmpeg local (démux vidéo seule, -c copy)
//     │ pipe
//     ▼
//   ssh spark → ffmpeg (nvdec → h264_nvenc → matroska sur stdout)
//     │ pipe
//     ▼
//   fichier local <dest>.part → rename atomique
//
// Seule la piste vidéo transite : audio et sous-titres ne quittent jamais le
// PowerEdge (ils sont remuxés localement depuis le MKV d'origine).

const SSH_HOST = process.env.SPARK_SSH_HOST || 'spark'
const PRESET = process.env.GPU_ENCODE_PRESET || 'p5'
const CQ = Number(process.env.GPU_ENCODE_CQ || 23)
const MAX_HEIGHT = Number(process.env.GPU_MAX_HEIGHT || 1080)
const MAX_WIDTH = Number(process.env.GPU_MAX_WIDTH || 1920)

export interface EncodeProgress {
    outSeconds: number   // position dans le flux encodé
    fps: number
    speed: number        // multiple du temps réel
}

export interface RemoteEncodeOptions {
    sourceHeight?: number | null
    sourceWidth?: number | null
    // Étiquette HDR de la source ("HDR10 (PQ)", "HLG") — déclenche le tonemapping.
    hdr?: string | null
    sourceCodec?: string | null
    sourcePixFmt?: string | null
    // Durée de la source (s), telle que rapportée par le conteneur. Sert de
    // garde-fou LARGE contre une source tronquée — voir minRatio.
    expectedDuration?: number | null
    // Seuil délibérément bas (0.80), parce que `expectedDuration` vient du
    // conteneur, c'est-à-dire du flux le PLUS LONG, qui n'est pas toujours la
    // vidéo : sur Ford v Ferrari les sous-titres courent 6 min après la dernière
    // image, ce qui donnait un ratio de 96 % pour un film parfaitement complet —
    // à un point du rejet. Mesurer la vraie durée du flux vidéo coûterait de 1 à
    // 5 minutes de lecture par film, donc on garde le conteneur et on desserre.
    // La détection fine est assurée par la sortie d'erreur du démux.
    minRatio?: number   // défaut 0.80
    onProgress?: (p: EncodeProgress) => void
}

// Commande exécutée sur le Spark. `scale_cuda` (pas `scale_npp` : le ffmpeg
// Ubuntu de l'hôte est construit sans libnpp) uniquement si la source sort du
// cadre 1920×1080 — sinon on ne touche pas à la définition, et on n'agrandit
// jamais.
//
// Le cadre est contraint sur les DEUX dimensions : un simple `-2:1080` ne
// plafonne que la hauteur, donc une source 4K en scope (3840×1608) sortirait en
// 2578×1080 — plus large que 1920 et un tiers de pixels en trop.
// `force_original_aspect_ratio=decrease` fait tenir l'image dans la boîte en
// gardant son ratio (3840×1608 → 1920×804), `force_divisible_by=2` garantit des
// dimensions paires, exigées par yuv420p.
export interface SourceInfo {
    height?: number | null
    width?: number | null
    // Étiquette de transfert HDR ("HDR10 (PQ)", "HLG") ou null si SDR.
    hdr?: string | null
    codec?: string | null
    pixFmt?: string | null
}

// La sortie est TOUJOURS du SDR BT.709, et doit le déclarer.
//
// ffmpeg recopie sinon les tags colorimétriques de la source : un H.264 8 bits
// se retrouvait étiqueté `smpte2084`/`bt2020nc`, c'est-à-dire annoncé comme du
// HDR10 alors qu'il n'en est plus. Sur un écran d'ordinateur ça passait inaperçu
// (les lecteurs ne déclenchent leur traitement HDR que sur du HEVC/AV1 10 bits),
// mais une TV HDR via Chromecast — usage central ici — honore ces tags et
// bascule en mode HDR sur un fichier qui n'en est pas un.
const SDR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']

// NVDEC ne décode le H.264 QU'EN 8 BITS : le profil High 10 n'est pas géré (seuls
// HEVC et AV1 le sont). Le décodeur refuse alors la trame et toute la chaîne tombe
// sur AVERROR(ENOSYS) — vu sur Saving Private Ryan, qui sortait en « ssh code 218 »
// sans autre explication. Pour ces sources, on décode sur le CPU du Spark et on
// garde NVENC pour l'encodage : vérifié fonctionnel.
function needsSoftwareDecode(src: SourceInfo): boolean {
    return src.codec === 'h264' && !!src.pixFmt && src.pixFmt !== 'yuv420p'
}

export function remoteFfmpegCommand(src: SourceInfo = {}): string {
    const sourceHeight = src.height
    const sourceWidth = src.width
    const downscale = (!!sourceHeight && sourceHeight > MAX_HEIGHT) || (!!sourceWidth && sourceWidth > MAX_WIDTH)
    const swDecode = needsSoftwareDecode(src)

    if (src.hdr) return hdrCommand(src, downscale, swDecode)
    if (swDecode) return softwareDecodeCommand(downscale)
    return cudaCommand(downscale)
}

// Chaîne HDR → SDR. `tonemap_cuda` n'existe pas dans le ffmpeg du Spark et
// l'interop CUDA→Vulkan y répond « Function not implemented », donc les trames
// transitent par la mémoire système entre le décodeur et libplacebo. Coût mesuré
// sur une source 10 bits : 6,0× contre 9,1× sans tonemapping, soit −34 %.
// Sans cette conversion, les valeurs PQ sont lues comme du gamma SDR : image
// délavée et couleurs BT.2020 interprétées en BT.709 (−27 % de saturation mesurés
// sur Starship Troopers).
function hdrCommand(src: SourceInfo, downscale: boolean, swDecode: boolean): string {
    // `format=p010le` est obligatoire pour préserver les 10 bits jusqu'au
    // tonemapper : passer par nv12 tronquerait à 8 bits AVANT la conversion, ce qui
    // ruinerait précisément ce qu'on cherche à récupérer.
    const download = swDecode ? [] : ['hwdownload', 'format=p010le']
    const box = downscale ? `w=${MAX_WIDTH}:h=${MAX_HEIGHT}:force_original_aspect_ratio=decrease:` : ''
    const chain = [
        ...(swDecode ? ['format=p010le'] : download),
        'hwupload',
        `libplacebo=${box}tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p`,
        'hwdownload',
        'format=yuv420p',
    ].join(',')
    return [
        'ffmpeg', '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
        '-progress', 'pipe:2',
        '-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk',
        ...(swDecode ? [] : ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']),
        '-i', 'pipe:0', '-vf', chain,
        '-c:v', 'h264_nvenc', '-preset', PRESET, '-cq', String(CQ),
        ...SDR_TAGS, '-f', 'matroska', 'pipe:1',
    ].join(' ')
}

// Décodage CPU (H.264 10 bits), redimensionnement logiciel, encodage NVENC.
function softwareDecodeCommand(downscale: boolean): string {
    const scale = downscale
        ? `scale=w=${MAX_WIDTH}:h=${MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`
        : 'format=yuv420p'
    return [
        'ffmpeg', '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
        '-progress', 'pipe:2', '-i', 'pipe:0', '-vf', scale,
        '-c:v', 'h264_nvenc', '-preset', PRESET, '-cq', String(CQ),
        ...SDR_TAGS, '-f', 'matroska', 'pipe:1',
    ].join(' ')
}

function cudaCommand(downscale: boolean): string {
    // `format=yuv420p` est OBLIGATOIRE, redimensionnement ou pas : h264_nvenc
    // n'encode qu'en 8 bits. Une source 10 bits (HEVC Main10, AV1 10 bits — très
    // répandues) fait sortir du décodeur des trames CUDA en p010 que l'encodeur
    // refuse avec « Error registering an input resource: invalid param (8) », et
    // le ssh meurt sans que rien d'explicite ne remonte. La conversion se fait sur
    // le GPU, donc sans retour par le CPU.
    const scaleFilter = downscale
        ? `scale_cuda=w=${MAX_WIDTH}:h=${MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2:format=yuv420p`
        : 'scale_cuda=format=yuv420p'
    return [
        'ffmpeg', '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
        '-progress', 'pipe:2',
        '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', 'pipe:0',
        '-vf', scaleFilter,
        '-c:v', 'h264_nvenc', '-preset', PRESET, '-cq', String(CQ),
        ...SDR_TAGS, '-f', 'matroska', 'pipe:1',
    ].join(' ')
}

// Parse le flux `-progress pipe:2` (lignes `clé=valeur`) et rappelle onProgress.
// Les lignes qui ne matchent pas sont des messages d'erreur ffmpeg → conservées.
function makeProgressParser(onProgress?: (p: EncodeProgress) => void) {
    let buffer = ''
    let outSeconds = 0
    let fps = 0
    let speed = 0
    const errorLines: string[] = []
    return {
        feed(chunk: Buffer): void {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                const eq = line.indexOf('=')
                const key = eq > 0 ? line.slice(0, eq) : ''
                const value = eq > 0 ? line.slice(eq + 1).trim() : ''
                switch (key) {
                    // Les premiers événements portent "N/A" tant que rien n'est encodé
                    // → Number() donne NaN, qu'il ne faut pas propager en pourcentage.
                    case 'out_time_us':
                    case 'out_time_ms': {  // ffmpeg écrit des µs malgré le nom `_ms`
                        const us = Number(value)
                        if (Number.isFinite(us)) outSeconds = us / 1e6
                        break
                    }
                    case 'fps': fps = Number(value) || 0; break
                    case 'speed': speed = parseFloat(value) || 0; break
                    case 'progress': onProgress?.({ outSeconds, fps, speed }); break
                    default:
                        // Ne retenir comme erreur que ce qui n'appartient PAS au flux
                        // `-progress`. Auparavant tout `clé=valeur` non traité y
                        // atterrissait — `bitrate=`, `total_size=`, `dup_frames=`… —
                        // et comme on ne garde que les 5 dernières lignes, ces clés
                        // chassaient le vrai message. Sur Saving Private Ryan l'échec
                        // se résumait à « bitrate=N/A | total_size=0 | out_time=N/A »,
                        // alors que ffmpeg avait bien écrit « Function not
                        // implemented » : il a fallu reproduire l'erreur à la main
                        // pour la retrouver.
                        if (line.trim() && !/^[A-Za-z0-9_]+=/.test(line.trim())) {
                            errorLines.push(line.trim())
                        }
                }
            }
        },
        errors(): string {
            return errorLines.slice(-5).join(' | ')
        },
        encodedSeconds(): number {
            return outSeconds
        },
    }
}

export async function encodeVideoRemote(
    srcMkv: string,
    dest: string,
    opts: RemoteEncodeOptions = {},
): Promise<number> {
    const tmp = `${dest}.part`
    const remoteCmd = remoteFfmpegCommand({
        height: opts.sourceHeight,
        width: opts.sourceWidth,
        hdr: opts.hdr,
        codec: opts.sourceCodec,
        pixFmt: opts.sourcePixFmt,
    })

    // Démux local : piste vidéo seule, sans réencodage.
    const demux = spawn('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-i', srcMkv, '-map', '0:v:0', '-c', 'copy', '-f', 'matroska', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    const ssh = spawn('ssh', [SSH_HOST, remoteCmd], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = createWriteStream(tmp)

    const demuxErrors: string[] = []
    demux.stderr.on('data', (c: Buffer) => { demuxErrors.push(c.toString()) })
    const remote = makeProgressParser(opts.onProgress)
    ssh.stderr.on('data', (c: Buffer) => remote.feed(c))

    demux.stdout.pipe(ssh.stdin)
    // `pipeline` et non `.pipe()` : pipe() appelle out.end() tout seul à la fin du
    // flux, donc un `await` sur l'événement 'finish' attaché après coup ne se
    // déclencherait jamais (promesse pendante → le process sort en silence).
    let writeError: Error | null = null
    const writeDone = pipeline(ssh.stdout, out).catch((err: Error) => { writeError = err })

    // Si ssh meurt en premier, le démux reçoit EPIPE : on l'absorbe ici, sinon
    // l'erreur remonte en 'uncaughtException' et tue le process Next.js.
    demux.stdout.on('error', () => {})
    ssh.stdin.on('error', () => {})

    const wait = (child: ChildProcess, name: string) =>
        new Promise<number>((resolve, reject) => {
            child.on('error', err => reject(new Error(`${name}: ${err.message}`)))
            child.on('close', code => resolve(code ?? -1))
        })

    // Si le ssh s'arrête (échec côté Spark), le démux doit mourir tout de suite,
    // sinon l'erreur distante reste invisible : Node cesse de lire son stdout dès
    // que la destination disparaît, le tube se remplit, et ffmpeg se bloque pour
    // toujours dans son write(). `Promise.all` ci-dessous ne se résout alors
    // jamais. Observé deux fois : ssh mort en 2 s, erreur rapportée 10 min plus
    // tard seulement après intervention manuelle.
    //
    // L'ordre compte, et SIGTERM seul NE SUFFIT PAS : ffmpeg bloqué en écriture
    // ne traite pas le signal (son gestionnaire lève un drapeau que la boucle
    // principale, coincée dans l'appel système, ne relit jamais). Vérifié : le
    // processus survit à SIGTERM et ne cède qu'à SIGKILL.
    //   1. détruire le tube  → ffmpeg reçoit EPIPE et sort proprement
    //   2. SIGTERM           → s'il est ailleurs que dans un write bloquant
    //   3. SIGKILL après 5 s → dernier recours
    ssh.on('close', () => {
        if (demux.exitCode !== null) return
        try { demux.stdout.destroy() } catch { /* déjà fermé */ }
        demux.kill('SIGTERM')
        setTimeout(() => { if (demux.exitCode === null) demux.kill('SIGKILL') }, 5000).unref()
    })

    try {
        const [demuxCode, sshCode] = await Promise.all([wait(demux, 'ffmpeg local'), wait(ssh, 'ssh')])
        await writeDone
        if (writeError) throw new Error(`écriture de ${dest}: ${(writeError as Error).message}`)
        if (sshCode !== 0) {
            throw new Error(`encodage distant échoué (ssh code ${sshCode}): ${remote.errors() || 'pas de détail'}`)
        }
        if (demuxCode !== 0) {
            throw new Error(`démux local échoué (code ${demuxCode}): ${demuxErrors.join('').trim().slice(-300)}`)
        }
        // Durée réellement encodée, lue sur le dernier événement de progression :
        // un matroska écrit dans un pipe ne porte pas de durée dans son en-tête
        // (ffprobe rend "N/A"), donc c'est la seule mesure disponible ici.
        const encoded = remote.encodedSeconds()
        const expected = opts.expectedDuration ?? 0
        const minRatio = opts.minRatio ?? 0.80
        const demuxOutput = demuxErrors.join('')

        // Signal principal : ffmpeg DIT que la source est incomplète. Il sort en
        // code 0 malgré tout (vérifié), mais il l'écrit sur stderr — c'est direct,
        // gratuit et précis, là où la comparaison de durées est indirecte.
        const truncated = /File ended prematurely|Invalid data found|Truncating packet|corrupt/i.test(demuxOutput)
        // Filet secondaire, volontairement large : attrape un démux mort en
        // silence, sans rejeter les fichiers dont les sous-titres dépassent
        // l'image. Pas de `encoded > 0` : un encodage vide (ratio 0) doit tomber.
        const tooShort = expected > 0 && encoded / expected < minRatio

        if (truncated || tooShort) {
            const why = truncated
                ? `le démux signale une source incomplète`
                : `${encoded.toFixed(0)}s encodées pour ${expected.toFixed(0)}s annoncées (${((encoded / expected) * 100).toFixed(1)}%)`
            throw new Error(
                `encodage tronqué: ${why} — MKV source probablement incomplet` +
                (demuxOutput ? ` | démux: ${demuxOutput.trim().slice(-200)}` : '')
            )
        }
        await rename(tmp, dest)
        return encoded
    } catch (err) {
        // Un spawn qui échoue laisse l'autre processus tourner (un encodage GPU
        // orphelin peut durer des minutes) : on coupe les deux avant de remonter.
        try { demux.stdout.destroy() } catch { /* déjà fermé */ }
        demux.kill('SIGKILL')
        ssh.kill('SIGKILL')
        await rm(tmp, { force: true }).catch(() => {})
        throw err
    }
}
