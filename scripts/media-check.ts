/**
 * Contrôle des fichiers des films disponibles (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
 * § 6). À lancer sur la machine qui héberge les fichiers.
 *
 * Pour chaque film disponible et chaque version (VF, VO) : le fichier existe, s'ouvre, a une piste vidéo et une piste
 * audio, se décode sur ses dix dernières secondes ; la VF et la VO ont la même durée (elles partagent la même vidéo) et
 * ne descendent pas sous 90 % de la durée TMDB. Le jugement vit dans lib/media/file-check.ts.
 *
 * Usage :
 *   npm run media:check                    # rapport seul : une ligne par anomalie, rien n'est écrit
 *   npm run media:check -- --film <id>     # un seul film (id INTERNE, films.id)
 *   npm run media:check -- --mark          # marque les versions défectueuses (vf_unplayable / vo_unplayable)
 *
 * Code de sortie : 0 sans anomalie, 1 s'il y en a (avec ou sans --mark), 2 sur une erreur d'usage ou d'environnement.
 *
 * `--mark` pose le drapeau d'une version qui a ses propres anomalies et le retire d'une version redevenue saine ; un
 * écart VF / VO seul ne marque rien. Une version marquée compte comme absente partout (fiche, location), et un film qui
 * n'a plus de version lisible ne se loue plus. Le script ne touche ni à la disponibilité des films ni à `duration_sec`
 * (la durée de la chaîne 24/7). Un fichier refait par le pipeline garde son drapeau : relancer `--mark` pour le lever.
 *
 * Les médias directs du seed (adresse ou chemin racine) ne sont pas contrôlés. Le rapport cite des chemins sous
 * MEDIA_FILMS_PATH, jamais l'adresse de diffusion d'une location.
 */

import { spawn } from 'child_process'
import { access, readdir } from 'fs/promises'
import { resolve } from 'path'
import { db } from '../lib/db'
import { judgeFilm, reportLines, tailDecoded, versionsToMark, type FileProbe } from '../lib/media/file-check'
import { probeStreams } from '../lib/media/probe'
import { isDirectMediaUrl } from '../lib/symlinks'

const MEDIA_FILMS_PATH = process.env.MEDIA_FILMS_PATH || '/media/films'
/** Le décodage de la fin d'un fichier ne doit pas bloquer le contrôle : 60 s au plus, puis « fin indécodable ». */
const TAIL_TIMEOUT_MS = 60_000

interface FilmRow {
    id: number
    title: string
    runtime: number | null
    file_path_vf_transcoded: string | null
    file_path_vo_transcoded: string | null
    vf_unplayable: number | null
    vo_unplayable: number | null
}

type Flags = { vf: number; vo: number }

const ABSENT: FileProbe = { exists: false, opens: false, hasVideo: false, hasAudio: false, duration: 0, tailDecodes: false }

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** « 1 film », « 3 films » (0 au singulier, comme en français). */
const count = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

function usage(): void {
    console.log(`Usage :
  npm run media:check                    rapport seul (rien n'est écrit)
  npm run media:check -- --film <id>     un seul film (id interne, films.id)
  npm run media:check -- --mark          marque les versions défectueuses`)
}

function parseArgs(argv: string[]): { mark: boolean; filmId: number | null } | null {
    let mark = false
    let filmId: number | null = null
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--mark') {
            mark = true
        } else if (argv[i] === '--film') {
            const id = Number(argv[++i])
            if (!Number.isInteger(id) || id <= 0) return null
            filmId = id
        } else {
            return null
        }
    }
    return { mark, filmId }
}

/** Chemin d'une version sous MEDIA_FILMS_PATH ; `null` pour une version absente ou un média direct du seed. */
function realPath(value: string | null): string | null {
    if (!value || isDirectMediaUrl(value)) return null
    return resolve(MEDIA_FILMS_PATH, value)
}

/** Un outil répond à `-version`. */
function answers(tool: string): Promise<boolean> {
    return new Promise((done) => {
        const child = spawn(tool, ['-version'], { stdio: 'ignore' })
        child.on('error', () => done(false))
        child.on('close', (code) => done(code === 0))
    })
}

/**
 * Décode les dix dernières secondes sans rien écrire. La progression (`-progress pipe:1`) dit si quelque chose a été
 * décodé : sans elle, un fichier coupé bien avant sa fin passerait pour sain (voir tailDecoded).
 */
function decodesTail(file: string): Promise<boolean> {
    return new Promise((done) => {
        const ffmpeg = spawn('ffmpeg', ['-progress', 'pipe:1', '-v', 'error', '-sseof', '-10', '-i', file, '-f', 'null', '-'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let progress = ''
        let stderr = ''
        ffmpeg.stdout.on('data', (chunk) => { progress += chunk })
        ffmpeg.stderr.on('data', (chunk) => { stderr += chunk })
        const timer = setTimeout(() => ffmpeg.kill('SIGKILL'), TAIL_TIMEOUT_MS)
        ffmpeg.on('error', () => { clearTimeout(timer); done(false) })
        ffmpeg.on('close', (code) => { clearTimeout(timer); done(tailDecoded({ code, stderr, progress })) })
    })
}

async function probeFile(file: string): Promise<FileProbe> {
    try { await access(file) } catch { return ABSENT }
    let probe: Awaited<ReturnType<typeof probeStreams>>
    try { probe = await probeStreams(file) } catch { return { ...ABSENT, exists: true } }
    return {
        exists: true,
        opens: true,
        hasVideo: probe.streams.some((s) => s.codec_type === 'video'),
        hasAudio: probe.streams.some((s) => s.codec_type === 'audio'),
        duration: probe.duration,
        tailDecodes: await decodesTail(file),
    }
}

/** « VF retirée du site », « VO de nouveau proposée » : ce qu'un changement de drapeaux fait sur le site. */
function describeChange(film: FilmRow, before: Flags, after: Flags): string {
    const parts: string[] = []
    for (const [key, label] of [['vf', 'VF'], ['vo', 'VO']] as const) {
        if (before[key] === after[key]) continue
        parts.push(after[key] ? `${label} retirée du site` : `${label} de nouveau proposée`)
    }
    return `[${film.id}] ${film.title} — ${parts.join(', ')}`
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2))
    if (!args) {
        usage()
        return 2
    }

    // Lecture seule de la disponibilité : le script ne l'écrit jamais.
    const films = db.prepare(`
        SELECT id, title, runtime, file_path_vf_transcoded, file_path_vo_transcoded, vf_unplayable, vo_unplayable
        FROM films
        WHERE is_available ${args.filmId !== null ? 'AND id = ?' : ''}
        ORDER BY id
    `).all(...(args.filmId !== null ? [args.filmId] : [])) as FilmRow[]

    if (films.length === 0) {
        if (args.filmId !== null) {
            console.error(`Film ${args.filmId} : introuvable parmi les films disponibles.`)
            return 2
        }
        console.log('Aucun film disponible : rien à contrôler.')
        return 0
    }

    const toCheck = films.filter((f) => realPath(f.file_path_vf_transcoded) || realPath(f.file_path_vo_transcoded))
    const seed = films.filter((f) => !toCheck.includes(f)
        && (isDirectMediaUrl(f.file_path_vf_transcoded) || isDirectMediaUrl(f.file_path_vo_transcoded))).length
    const noFile = films.length - toCheck.length - seed
    const ignored = [
        seed > 0 ? count(seed, 'film au média de seed', 'films aux médias de seed') : null,
        noFile > 0 ? count(noFile, 'film sans fichier transcodé', 'films sans fichier transcodé') : null,
    ].filter((s) => s !== null)

    if (toCheck.length === 0) {
        console.log(noFile === 0
            ? `Tous les médias sont des médias de seed (adresses directes) : aucun fichier à contrôler (${count(seed, 'film', 'films')}).`
            : `Aucun fichier à contrôler — ignorés : ${ignored.join(', ')}.`)
        return 0
    }

    // Sans ffmpeg ni ffprobe, ou sans le dossier des films (non monté), chaque fichier paraîtrait absent ou illisible,
    // et --mark retirerait tout le catalogue du site.
    if (!(await answers('ffprobe')) || !(await answers('ffmpeg'))) {
        console.error('ffprobe et ffmpeg sont nécessaires et ne répondent pas : rien n\'est contrôlé.')
        return 2
    }
    const folder = await readdir(MEDIA_FILMS_PATH).catch(() => [])
    if (folder.length === 0) {
        console.error(`Dossier des films vide ou introuvable : ${MEDIA_FILMS_PATH} (MEDIA_FILMS_PATH). Rien n'est contrôlé.`)
        return 2
    }

    console.log(`Contrôle de ${count(toCheck.length, 'film', 'films')} sous ${MEDIA_FILMS_PATH}`
        + (args.mark ? ' — marquage demandé (--mark)' : ' — rapport seul, rien n\'est écrit'))

    let anomalies = 0
    let filmsWithAnomaly = 0
    const changes: { film: FilmRow; before: Flags; after: Flags }[] = []
    for (const film of toCheck) {
        const vfPath = realPath(film.file_path_vf_transcoded)
        const voPath = realPath(film.file_path_vo_transcoded)
        const vf = vfPath ? await probeFile(vfPath) : null
        const vo = voPath ? await probeFile(voPath) : null
        const judgement = judgeFilm({ runtimeMin: film.runtime, vf, vo })
        const lines = reportLines(film, judgement)
        for (const line of lines) console.log(line)
        if (lines.length > 0) {
            filmsWithAnomaly++
            anomalies += lines.length
        }
        // Une version contrôlée prend le drapeau de son jugement ; une version non contrôlée garde le sien.
        const want = versionsToMark(judgement)
        const before: Flags = { vf: film.vf_unplayable ? 1 : 0, vo: film.vo_unplayable ? 1 : 0 }
        const after: Flags = { vf: vf ? Number(want.vf) : before.vf, vo: vo ? Number(want.vo) : before.vo }
        if (after.vf !== before.vf || after.vo !== before.vo) changes.push({ film, before, after })
    }

    console.log(`\nBilan : ${count(toCheck.length, 'film contrôlé', 'films contrôlés')}, `
        + `${filmsWithAnomaly} avec anomalie (${count(anomalies, 'anomalie', 'anomalies')})`
        + (ignored.length > 0 ? ` ; ignorés : ${ignored.join(', ')}` : '') + '.')

    if (changes.length === 0) {
        console.log('Drapeaux : rien à changer.')
    } else if (!args.mark) {
        console.log(`Avec --mark, ${count(changes.length, 'film changerait', 'films changeraient')} :`)
        for (const c of changes) console.log(`  ${describeChange(c.film, c.before, c.after)}`)
    } else {
        const setFlags = db.prepare('UPDATE films SET vf_unplayable = ?, vo_unplayable = ? WHERE id = ?')
        db.transaction(() => {
            for (const c of changes) setFlags.run(c.after.vf, c.after.vo, c.film.id)
        })()
        console.log(`Drapeaux mis à jour sur ${count(changes.length, 'film', 'films')} :`)
        for (const c of changes) console.log(`  ${describeChange(c.film, c.before, c.after)}`)
    }

    return anomalies > 0 ? 1 : 0
}

main().then(
    (code) => { process.exitCode = code },
    (err) => {
        console.error('Erreur fatale :', errMsg(err))
        process.exitCode = 2
    },
)
