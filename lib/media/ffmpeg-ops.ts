import ffmpeg from 'fluent-ffmpeg'
import { rename, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { ocrSupToSrt } from './ocr-subs'

export interface AudioTarget {
    out: string           // chemin du .m4a intermédiaire
    audioOrdinal: number  // Nième piste audio du MKV source (0-based)
}

export interface RemuxTarget {
    out: string           // chemin final (.mp4)
    audio: string         // .m4a produit par encodeAudioTracks
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
// Encode les pistes audio voulues en AAC stéréo, SANS toucher à la vidéo.
//
// Séparer l'audio de la vidéo permet de le sortir du chemin critique : cette
// fonction ne dépend que du MKV source, donc elle tourne pendant l'encodage GPU
// (comme le backup). Le mux final n'a plus alors qu'à recopier des flux déjà
// encodés — mesuré 681 ms contre 5 732 ms quand tout était fait en une passe.
//
// Vérifié bit à bit : l'audio produit par ce détour via un .m4a intermédiaire est
// rigoureusement identique à celui d'un mux direct (différence à -inf dB).
export function encodeAudioTracks(mkv: string, targets: AudioTarget[]): Promise<void> {
    if (targets.length === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg().input(mkv)
        for (const t of targets) {
            cmd.output(`${t.out}.part`).outputOptions([
                '-y', '-vn', '-sn', '-dn',
                // Extension `.part` non reconnue par ffmpeg → forcer le muxer.
                '-f', 'mp4',
                '-map', `0:a:${t.audioOrdinal}`,
                '-c:a', 'aac', '-ac', AUDIO_CHANNELS, '-b:a', AUDIO_BITRATE,
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

// Assemble vidéo + audio déjà encodés, en copie pure. Aucun décodage, aucun
// réencodage : le coût est celui de l'I/O.
//
// `videoSrc` = le fichier dont on copie la piste vidéo — video.mkv après passage
// GPU, ou le MKV source quand le réencodage n'apportait rien (voir video-plan.ts).
export function remuxOutputs(videoSrc: string, targets: RemuxTarget[]): Promise<void> {
    if (targets.length === 0) return Promise.resolve()
    return Promise.all(targets.map(t => new Promise<void>((resolve, reject) => {
        ffmpeg()
            .input(videoSrc)
            .input(t.audio)
            .outputOptions([
                '-y', '-f', 'mp4',
                '-map', '0:v:0', '-map', '1:a:0',
                '-c', 'copy',
                '-movflags', '+faststart',
            ])
            .output(`${t.out}.part`)
            .on('end', () => rename(`${t.out}.part`, t.out).then(resolve, reject))
            .on('error', reject)
            .run()
    }))).then(() => undefined)
}

export interface SubCandidate { lang: 'fr' | 'en'; streamIndex: number; kind?: 'text' | 'image' }

// En dessous de ce nombre de cues, une piste ressemble à une piste FORCÉE
// (panneaux et dialogues étrangers, ~90 à 150 lignes) plutôt qu'aux dialogues
// complets (800 à 2000). Quand la meilleure piste texte est sous ce seuil et
// qu'une piste image existe dans la même langue, on tente l'OCR : sur Gran Torino
// la seule piste texte française EST la piste forcée, et la version complète
// n'existe qu'en PGS — le film a donc été publié avec des sous-titres partiels.
// Seuil volontairement haut : une OCR inutile ne coûte que ~100 s de CPU, alors
// que servir des sous-titres forcés en guise de dialogues passe inaperçu.
const FORCED_LIKE_MAX_CUES = Number(process.env.SUB_FORCED_MAX_CUES || 400)
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

    const textCands = candidates.filter(c => c.kind !== 'image')
    const imageCands = candidates.filter(c => c.kind === 'image')

    const tmpOf = (c: SubCandidate) => join(outDir, `.sub-cand.${c.lang}.${c.streamIndex}.vtt`)
    const supOf = (c: SubCandidate) => join(outDir, `.sub-cand.${c.lang}.${c.streamIndex}.sup`)

    // Une seule lecture du MKV pour tout le monde : les pistes texte sortent en
    // WebVTT, les pistes image en .sup par simple copie de flux. Sortir les .sup
    // ici ne coûte presque rien (aucun décodage), alors qu'une passe séparée
    // relirait tout le fichier — et sur ce disque, saturé par les téléchargements,
    // relire 15 Go se paie en minutes.
    await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg(mkv)
        for (const c of textCands) {
            cmd.output(tmpOf(c)).outputOptions([
                '-y', '-f', 'webvtt', '-c:s', 'webvtt', '-map', `0:${c.streamIndex}`,
            ])
        }
        for (const c of imageCands) {
            cmd.output(supOf(c)).outputOptions([
                '-y', '-f', 'sup', '-c:s', 'copy', '-map', `0:${c.streamIndex}`,
            ])
        }
        cmd.on('end', () => resolve()).on('error', reject).run()
    })

    const scored = await Promise.all(
        textCands.map(async c => ({ ...c, tmp: tmpOf(c), cues: await countCues(tmpOf(c)) })),
    )

    // OCR des pistes image, uniquement là où le texte est absent ou suspect.
    for (const lang of ['fr', 'en'] as const) {
        const images = imageCands.filter(c => c.lang === lang)
        if (images.length === 0) continue
        const bestText = scored.filter(s => s.lang === lang && s.cues > 0)
            .reduce((a, b) => (!a || b.cues > a.cues ? b : a), null as (typeof scored)[number] | null)
        if (bestText && bestText.cues >= FORCED_LIKE_MAX_CUES) continue
        for (const c of images) {
            const srt = await ocrSupToSrt(supOf(c), lang)
            if (!srt) continue
            // Ramené en WebVTT pour rejoindre les candidats texte et être départagé
            // au nombre de cues, comme eux.
            const vtt = join(outDir, `.sub-cand.${lang}.${c.streamIndex}.ocr.vtt`)
            await new Promise<void>((resolve, reject) => {
                ffmpeg(srt).outputOptions(['-y', '-f', 'webvtt', '-c:s', 'webvtt'])
                    .output(vtt).on('end', () => resolve()).on('error', reject).run()
            })
            await rm(srt, { force: true }).catch(() => {})
            scored.push({ ...c, tmp: vtt, cues: await countCues(vtt) })
        }
    }
    await Promise.all(imageCands.map(c => rm(supOf(c), { force: true }).catch(() => {})))

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

