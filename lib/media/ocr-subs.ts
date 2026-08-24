import { spawn } from 'child_process'
import { rename, access, rm, readFile, writeFile } from 'fs/promises'

// Conversion des sous-titres image (PGS/VobSub) en SRT par OCR.
//
// Les BluRay de catalogue ne proposent souvent QUE du PGS — des bitmaps, pas du
// texte. Le pipeline les ignorait, et le contrôle qualité refusait donc des
// releases qui portaient pourtant des sous-titres français : Saving Private Ryan,
// Die Hard 2 et Naked Gun ont tous été rejetés pour cette raison alors que
// MediaInfo les annonçait correctement.
//
// L'OCR (tesseract, via pgsrip) rend ces pistes exploitables. Mesuré sur un film
// entier — La La Land, piste anglaise de 939 sous-titres — : 100 s. C'est assez
// court pour tenir dans la phase parallèle, à côté de l'encodage GPU.
//
// Avantage sur une récupération externe (OpenSubtitles) : la synchronisation est
// exacte par construction, puisque les temps viennent de la release elle-même.
// Un SRT tiers vise un autre montage ou un autre master et dérive.

const TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 15 * 60 * 1000)

// pgsrip déduit la langue du NOM de fichier (via babelfish) et écarte en silence
// tout fichier qu'il n'arrive pas à étiqueter — un `t.sup` donne
// « 1 file filtered out » sans autre explication. D'où le suffixe obligatoire.
const ALPHA3: Record<'fr' | 'en', string> = { fr: 'fra', en: 'eng' }

function run(
    cmd: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<{ code: number; out: string }> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        child.stdout.on('data', (c: Buffer) => { out += c.toString() })
        child.stderr.on('data', (c: Buffer) => { out += c.toString() })
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
        timer.unref()
        // L'OCR dure des minutes : sans arrêt explicite, un tesseract continuerait
        // à tourner longtemps après l'abandon du film qui l'a lancé.
        const onAbort = (): void => { child.kill('SIGKILL') }
        signal?.addEventListener('abort', onAbort, { once: true })
        const done = (r: { code: number; out: string }): void => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            resolve(r)
        }
        child.on('error', err => done({ code: -1, out: `${out}${err.message}` }))
        child.on('close', code => done({ code: code ?? -1, out }))
    })
}

const exists = (p: string) => access(p).then(() => true, () => false)

// Corrections des confusions de tesseract, établies en comptant les caractères
// réellement produits sur trois films OCR-isés (Las Vegas Parano, Kiss Kiss Bang
// Bang, L'Associé du diable) et en les comparant à des fichiers issus de pistes
// TEXTE, qui n'en portent aucun :
//
//   `|`  163 lignes, dont 129 en fin de ligne, ZÉRO en début de mot — donc jamais
//        un `I` ou un `l` mal lu, toujours un point d'exclamation. Le caractère
//        n'a par ailleurs aucun usage légitime dans un sous-titre français.
//   `Ÿ`  5 occurrences, inexistant en français courant : c'est un `Y`.
//
// Volontairement limité à ces deux-là : `€` et `°` apparaissent aussi mais sont
// légitimes (le fichier témoin en contient également).
const OCR_FIXES: [RegExp, string][] = [
    [/\|/g, '!'],
    [/Ÿ/g, 'Y'],
]

async function cleanOcrText(srt: string): Promise<number> {
    const before = await readFile(srt, 'utf8')
    let after = before
    for (const [re, to] of OCR_FIXES) after = after.replace(re, to)
    if (after === before) return 0
    await writeFile(srt, after, 'utf8')
    // Nombre de caractères corrigés, pour le journal.
    let n = 0
    for (const [re] of OCR_FIXES) n += (before.match(re) || []).length
    return n
}

// Convertit un .sup en .srt. Rend le chemin du SRT, ou null si l'OCR n'a rien
// produit — un échec d'OCR n'est jamais fatal, on retombe sur les pistes texte.
export async function ocrSupToSrt(
    supPath: string,
    lang: 'fr' | 'en',
    signal?: AbortSignal,
): Promise<string | null> {
    // Nom imposé par pgsrip : `<base>.<lang2>.sup` → `<base>.<lang2>.srt`. Le base
    // est dérivé du chemin d'entrée, déjà unique par flux : un nom fixe ferait
    // collisionner deux pistes image de même langue (courant — une forcée et une
    // complète), la seconde écrasant le SRT de la première.
    const base = supPath.replace(/\.sup$/, '')
    const tagged = `${base}.${lang}.sup`
    const srt = `${base}.${lang}.srt`
    if (supPath !== tagged) await rename(supPath, tagged)

    const { code, out } = await run('pgsrip', ['-l', ALPHA3[lang], '--force', tagged], TIMEOUT_MS, signal)
    // Le .sup taggé a échappé au nom d'origine : il se nettoie ici, sinon il
    // resterait sur le disque de sortie (plusieurs Mo par piste).
    await rm(tagged, { force: true }).catch(() => {})
    if (await exists(srt)) {
        const fixed = await cleanOcrText(srt).catch(() => 0)
        if (fixed > 0) console.log(`[ocr-subs] ${lang}: ${fixed} caractère(s) mal lu(s) corrigé(s)`)
        return srt
    }

    console.warn(`[ocr-subs] aucun SRT produit pour ${lang} (code ${code}): ${out.trim().slice(-200)}`)
    return null
}
