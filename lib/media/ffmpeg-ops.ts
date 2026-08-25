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

// Exécute une commande fluent-ffmpeg en la rendant interruptible.
//
// Sans ça, l'audio et les sous-titres — lancés EN PARALLÈLE de l'encodage GPU —
// survivaient à l'échec de celui-ci : processFilm remontait l'erreur et rendait la
// main, le film sortait de `active`, le poller le remettait en file deux minutes
// plus tard, et une nouvelle paire de ffmpeg démarrait par-dessus la précédente.
// Constaté sur American Psycho pendant l'indisponibilité du GPU du Spark :
// 6 tentatives = 12 ffmpeg vivants, tous à relire le même MKV de 8,7 Go, saturant
// le disque au passage.
function runFfmpeg(cmd: ReturnType<typeof ffmpeg>, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false
        const onAbort = (): void => {
            if (settled) return
            settled = true
            try { cmd.kill('SIGKILL') } catch { /* déjà mort */ }
            reject(new Error('opération ffmpeg annulée'))
        }
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        const finish = (err?: Error): void => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', onAbort)
            if (err) reject(err); else resolve()
        }
        cmd.on('end', () => finish()).on('error', (e: Error) => finish(e)).run()
    })
}

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
function addAudioOutputs(cmd: ReturnType<typeof ffmpeg>, targets: AudioTarget[]): void {
    for (const t of targets) {
        cmd.output(`${t.out}.part`).outputOptions([
            '-y', '-vn', '-sn', '-dn',
            // Extension `.part` non reconnue par ffmpeg → forcer le muxer.
            '-f', 'mp4',
            '-map', `0:a:${t.audioOrdinal}`,
            '-c:a', 'aac', '-ac', AUDIO_CHANNELS, '-b:a', AUDIO_BITRATE,
        ])
    }
}

export async function encodeAudioTracks(
    mkv: string,
    targets: AudioTarget[],
    signal?: AbortSignal,
): Promise<void> {
    if (targets.length === 0) return
    const cmd = ffmpeg().input(mkv)
    addAudioOutputs(cmd, targets)
    try {
        await runFfmpeg(cmd, signal)
    } catch (err) {
        // Une annulation laisse des .part derrière elle : ils seraient pris pour
        // des fichiers valides au prochain passage (le code teste l'existence).
        await Promise.all(targets.map(t => rm(`${t.out}.part`, { force: true }).catch(() => {})))
        throw err
    }
    await Promise.all(targets.map(t => rename(`${t.out}.part`, t.out)))
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
// Extrait audio ET sous-titres en UNE SEULE lecture du MKV.
//
// Les deux étapes lisaient auparavant le fichier chacune de leur côté, en
// parallèle. Avec le démux qui alimente l'encodage GPU, ça faisait TROIS curseurs
// de lecture sur le même fichier de plusieurs Go — et sur un plateau mécanique,
// trois flux séquentiels entrelacés deviennent de l'accès aléatoire. Mesuré à
// l'œuvre : `phat-two` occupé à 100 % pour seulement 19 Mo/s de lecture, pendant
// qu'un unrar tentait d'y écrire.
//
// Une passe unique à N sorties ramène le pipeline à deux lecteurs. C'est le même
// procédé que celui déjà employé pour les pistes de sous-titres entre elles et
// pour les deux pistes audio, et il ne coûte rien au recouvrement : la passe reste
// lancée en parallèle de l'encodage GPU.
export async function extractAudioAndSubs(
    mkv: string,
    audioTargets: AudioTarget[],
    candidates: SubCandidate[],
    outDir: string,
    signal?: AbortSignal,
): Promise<ExtractedSub[]> {
    if (audioTargets.length === 0 && candidates.length === 0) return []

    const textCands = candidates.filter(c => c.kind !== 'image')
    const imageCands = candidates.filter(c => c.kind === 'image')

    const tmpOf = (c: SubCandidate) => join(outDir, `.sub-cand.${c.lang}.${c.streamIndex}.vtt`)
    const supOf = (c: SubCandidate) => join(outDir, `.sub-cand.${c.lang}.${c.streamIndex}.sup`)

    // Les pistes texte sortent en WebVTT, les pistes image en .sup par simple copie
    // de flux (aucun décodage, donc quasi gratuit), l'audio en AAC — le tout depuis
    // la même entrée.
    const pass = ffmpeg(mkv)
    addAudioOutputs(pass, audioTargets)
    for (const c of textCands) {
        pass.output(tmpOf(c)).outputOptions([
            '-y', '-f', 'webvtt', '-c:s', 'webvtt', '-map', `0:${c.streamIndex}`,
        ])
    }
    for (const c of imageCands) {
        pass.output(supOf(c)).outputOptions([
            '-y', '-f', 'sup', '-c:s', 'copy', '-map', `0:${c.streamIndex}`,
        ])
    }
    try {
        await runFfmpeg(pass, signal)
    } catch (err) {
        await Promise.all(audioTargets.map(t => rm(`${t.out}.part`, { force: true }).catch(() => {})))
        throw err
    }
    // L'audio n'est publié qu'une fois la passe entière réussie : un .part promu
    // trop tôt serait pris pour un fichier valide au prochain passage.
    await Promise.all(audioTargets.map(t => rename(`${t.out}.part`, t.out)))

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
            // L'OCR est la phase la plus longue : sans ce test, une annulation
            // attendrait la fin de chaque piste avant d'être prise en compte.
            if (signal?.aborted) throw new Error('extraction des sous-titres annulée')
            const srt = await ocrSupToSrt(supOf(c), lang, signal)
            if (!srt) continue
            // Ramené en WebVTT pour rejoindre les candidats texte et être départagé
            // au nombre de cues, comme eux.
            const vtt = join(outDir, `.sub-cand.${lang}.${c.streamIndex}.ocr.vtt`)
            await runFfmpeg(
                ffmpeg(srt).outputOptions(['-y', '-f', 'webvtt', '-c:s', 'webvtt']).output(vtt),
                signal,
            )
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
        const srtTmp = `${srt}.part`
        await runFfmpeg(
            ffmpeg(vtt).outputOptions(['-y', '-f', 'srt', '-c:s', 'srt']).output(srtTmp),
            signal,
        )
        await rename(srtTmp, srt)
        kept.push({ lang, vtt, srt, cues: best.cues })
    }

    // Candidats perdants (et pistes vides) : on ne garde rien sur disque.
    await Promise.all(scored.map(s => rm(s.tmp, { force: true }).catch(() => {})))
    return kept
}

