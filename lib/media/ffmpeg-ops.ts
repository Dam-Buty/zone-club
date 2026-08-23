import ffmpeg from 'fluent-ffmpeg'
import { rename, rm, readFile } from 'fs/promises'
import { join } from 'path'

export interface MuxTarget {
    out: string           // chemin final (.mp4)
    audioOrdinal: number  // Nième piste audio du MKV source (0-based)
}

const AUDIO_BITRATE = process.env.MUX_AUDIO_BITRATE || '192k'
const AUDIO_CHANNELS = process.env.MUX_AUDIO_CHANNELS || '2'

// Produit vo.mp4 et vf.mp4 en UNE passe ffmpeg à deux sorties.
//
// La vidéo est copiée telle quelle depuis l'encodage GPU (identique dans les deux
// fichiers → synchro garantie), seule l'audio est réencodée en AAC. En une seule
// invocation, ffmpeg lit ses deux entrées une fois au lieu de deux, décode chaque
// piste audio une fois, et encode les deux AAC en parallèle sur ses threads
// internes : deux fois moins d'I/O que deux processus séparés, pour le même temps
// de mur (mesuré : 10 s de wall-clock pour 21 s de CPU sur un segment de test).
//
// Downmix stéréo : 6 canaux à 192k donnaient ~21 kbps/canal (ce que servait
// l'ancienne chaîne). En stéréo on monte à 96 kbps/canal, lisible par tous les
// navigateurs et le Chromecast.
//
// Écriture atomique (.part puis rename) pour qu'une coupure ne laisse jamais un
// fichier partiel confondu avec un fichier complet.
// `videoMkv` à null = la vidéo est copiée directement depuis le MKV source (cas où
// le réencodage GPU n'apportait rien, voir video-plan.ts) : une seule entrée, donc
// le fichier n'est lu qu'une fois au lieu de deux.
export function muxOutputs(videoMkv: string | null, mkv: string, targets: MuxTarget[]): Promise<void> {
    if (targets.length === 0) return Promise.resolve()
    const videoMap = '0:v:0'
    const audioInput = videoMkv ? 1 : 0
    return new Promise((resolve, reject) => {
        const cmd = videoMkv ? ffmpeg().input(videoMkv).input(mkv) : ffmpeg().input(mkv)
        for (const t of targets) {
            cmd.output(`${t.out}.part`).outputOptions([
                '-y',
                // Extension `.part` non reconnue par ffmpeg → forcer le muxer.
                '-f', 'mp4',
                '-map', videoMap,
                '-map', `${audioInput}:a:${t.audioOrdinal}`,
                '-c:v', 'copy',
                '-c:a', 'aac', '-ac', AUDIO_CHANNELS, '-b:a', AUDIO_BITRATE,
                '-movflags', '+faststart',
            ])
        }
        cmd
            .on('end', () => {
                Promise.all(targets.map(t => rename(`${t.out}.part`, t.out)))
                    .then(() => resolve(), reject)
            })
            .on('error', reject)
            .run()
    })
}

export interface SubCandidate { lang: 'fr' | 'en'; streamIndex: number }
export interface ExtractedSub { lang: 'fr' | 'en'; vtt: string; srt: string; cues: number }

// Compte les cues d'un WebVTT : une cue = une ligne contenant "-->".
async function countCues(path: string): Promise<number> {
    try {
        const text = await readFile(path, 'utf8')
        return (text.match(/-->/g) || []).length
    } catch {
        return 0
    }
}

// Extrait TOUTES les pistes candidates en UNE passe ffmpeg, puis garde par langue
// celle qui a le plus de cues.
//
// Pourquoi le nombre de cues : les métadonnées ne distinguent pas une piste forcée
// (panneaux à l'écran, ~90 cues) d'une piste de dialogues complète (~1500 cues).
// L'écart d'un ordre de grandeur, lui, est sans ambiguïté.
//
// Pourquoi une seule passe : extraire une piste oblige ffmpeg à démuxer tout le
// MKV. Avec N passes on relisait N fois un fichier de plusieurs Go ; ici on le lit
// une fois et on écrit N sorties.
export async function extractSubs(
    mkv: string,
    candidates: SubCandidate[],
    outDir: string,
): Promise<ExtractedSub[]> {
    if (candidates.length === 0) return []

    const tmpOf = (c: SubCandidate) => join(outDir, `.sub-cand.${c.lang}.${c.streamIndex}.vtt`)

    await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg(mkv)
        for (const c of candidates) {
            cmd.output(tmpOf(c)).outputOptions([
                '-y', '-f', 'webvtt', '-c:s', 'webvtt', '-map', `0:${c.streamIndex}`,
            ])
        }
        cmd.on('end', () => resolve()).on('error', reject).run()
    })

    const scored = await Promise.all(
        candidates.map(async c => ({ ...c, tmp: tmpOf(c), cues: await countCues(tmpOf(c)) })),
    )

    const kept: ExtractedSub[] = []
    for (const lang of ['fr', 'en'] as const) {
        const forLang = scored.filter(s => s.lang === lang && s.cues > 0)
        if (forLang.length === 0) continue
        const best = forLang.reduce((a, b) => (b.cues > a.cues ? b : a))
        const vtt = join(outDir, `sub.${lang}.vtt`)
        const srt = join(outDir, `sub.${lang}.srt`)
        await rename(best.tmp, vtt)
        // webvtt → srt par transcodage (la copie `subrip` sur certains MKV bloque
        // ffmpeg sur un EOF mal détecté ; repasser par le vtt déjà extrait est sûr).
        await new Promise<void>((resolve, reject) => {
            const tmp = `${srt}.part`
            ffmpeg(vtt)
                .outputOptions(['-y', '-f', 'srt', '-c:s', 'srt'])
                .output(tmp)
                .on('end', () => rename(tmp, srt).then(resolve, reject))
                .on('error', reject)
                .run()
        })
        kept.push({ lang, vtt, srt, cues: best.cues })
    }

    // Candidats perdants (et pistes vides) : on ne garde rien sur disque.
    await Promise.all(scored.map(s => rm(s.tmp, { force: true }).catch(() => {})))
    return kept
}

