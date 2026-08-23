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
    // Durée de la source (s). Un MKV tronqué fait sortir le démux ffmpeg en code 0
    // après un simple "File ended prematurely" : l'encodage distant est alors
    // parfaitement valide mais incomplet, et rien ne le signale. Comparer la durée
    // encodée à celle attendue est la seule détection fiable — elle vit ici plutôt
    // que chez l'appelant pour qu'on ne puisse pas l'oublier.
    expectedDuration?: number | null
    minRatio?: number   // défaut 0.95
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
export function remoteFfmpegCommand(sourceHeight?: number | null, sourceWidth?: number | null): string {
    const downscale = (!!sourceHeight && sourceHeight > MAX_HEIGHT) || (!!sourceWidth && sourceWidth > MAX_WIDTH)
    const scaleFilter = `scale_cuda=w=${MAX_WIDTH}:h=${MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    return [
        'ffmpeg', '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error',
        '-progress', 'pipe:2',
        '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', 'pipe:0',
        ...(downscale ? ['-vf', scaleFilter] : []),
        '-c:v', 'h264_nvenc', '-preset', PRESET, '-cq', String(CQ),
        '-f', 'matroska', 'pipe:1',
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
                        if (line.trim()) errorLines.push(line.trim())
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
    const remoteCmd = remoteFfmpegCommand(opts.sourceHeight, opts.sourceWidth)

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
        const minRatio = opts.minRatio ?? 0.95
        // Pas de `encoded > 0` dans la condition : un encodage vide (ratio 0) doit
        // être rejeté comme n'importe quelle autre troncature, pas ignoré.
        if (expected > 0 && encoded / expected < minRatio) {
            throw new Error(
                `encodage tronqué: ${encoded.toFixed(0)}s encodées pour ${expected.toFixed(0)}s de source ` +
                `(${((encoded / expected) * 100).toFixed(1)}%) — MKV source probablement incomplet` +
                (demuxErrors.length ? ` | démux: ${demuxErrors.join('').trim().slice(-200)}` : '')
            )
        }
        await rename(tmp, dest)
        return encoded
    } catch (err) {
        // Un spawn qui échoue laisse l'autre processus tourner (un encodage GPU
        // orphelin peut durer des minutes) : on coupe les deux avant de remonter.
        demux.kill()
        ssh.kill()
        await rm(tmp, { force: true }).catch(() => {})
        throw err
    }
}
