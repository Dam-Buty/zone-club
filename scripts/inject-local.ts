/**
 * Injecte un fichier déjà présent sur le disque comme s'il venait d'un
 * téléchargement Radarr.
 *
 * Le pipeline ne scanne jamais la library : il demande à Radarr où est le fichier
 * (`movieFile.path`). Déposer un MKV dans le bon dossier ne suffit donc pas — il
 * faut aussi déclencher un RescanMovie pour que Radarr l'adopte et publie
 * `hasFile=true`. C'est cette seconde étape qui manque quand on copie à la main.
 *
 * Le fichier est DÉPLACÉ, pas copié : source et destination sont sur le même
 * système de fichiers, donc l'opération est instantanée là où une copie de
 * plusieurs Go prendrait des minutes.
 *
 * Usage:
 *   npx tsx scripts/inject-local.ts                 # simulation
 *   npx tsx scripts/inject-local.ts --apply
 */
import { db } from '../lib/db'
import { readdirSync, mkdirSync, renameSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'

const APPLY = process.argv.includes('--apply')
const SRC = process.env.INJECT_SRC || '/data/phat-two/videoclub'
const BASE = process.env.RADARR_URL
const KEY = process.env.RADARR_API_KEY

// Association explicite fichier → film. Volontairement écrite à la main : le
// rapprochement automatique par titre se trompe (préfixes de release, titres
// français contre originaux), et se tromper ici publierait un film sous une autre
// identité.
const MAP: [string, number][] = [
    ['Searching.For.Sugar.Man', 234],
    ['Le Vent se Lève', 87],
    ['Human.Traffic', 319],
    ['25th Hour', 280],
    ['South Park', 312],
    ['Men in Black 1', 193],
    ["Buffalo '66", 315],
    ['La Classe americaine', 294],
    ['Le Temps des Gitans', 23],
    ['Memories.of.Murder', 26],
]

// Films acceptés malgré un contrôle qualité négatif (source choisie sciemment).
const FORCE = new Set([234])   // Sugar Man : documentaire, pas de VF

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${BASE}/api/v3${path}`, {
        ...init,
        headers: { 'X-Api-Key': KEY as string, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    const body = await r.text()
    return (body ? JSON.parse(body) : undefined) as T
}

async function main(): Promise<void> {
    const fichiers = readdirSync(SRC)
    let n = 0
    for (const [motif, filmId] of MAP) {
        const nom = fichiers.find(f => f.includes(motif))
        const film = db.prepare('SELECT id, title, radarr_id FROM films WHERE id = ?')
            .get(filmId) as { id: number; title: string; radarr_id: number | null } | undefined
        if (!film) { console.warn(`  ⚠ film #${filmId} absent de la base`); continue }
        if (!nom) { console.warn(`  ⚠ ${film.title} : aucun fichier ne contient "${motif}"`); continue }
        if (!film.radarr_id) { console.warn(`  ⚠ ${film.title} : pas de radarr_id`); continue }

        const m = await api<{ path: string; hasFile: boolean }>(`/movie/${film.radarr_id}`)
        const src = join(SRC, nom)
        const dest = join(m.path, basename(nom))
        const go = (statSync(src).size / 1e9).toFixed(1)

        if (m.hasFile) { console.warn(`  ⚠ ${film.title} : Radarr a déjà un fichier — ignoré`); continue }
        console.log(`  ${APPLY ? '→' : '[simulation]'} ${film.title} (${go} Go)`)
        console.log(`      ${m.path}/`)
        if (!APPLY) { n++; continue }

        mkdirSync(m.path, { recursive: true })
        renameSync(src, dest)
        // Sans ce rescan, Radarr ignore le fichier et le film reste en `pending`.
        await api('/command', { method: 'POST', body: JSON.stringify({ name: 'RescanMovie', movieId: film.radarr_id }) })

        if (FORCE.has(filmId)) {
            db.prepare('UPDATE films SET qc_force = 1 WHERE id = ?').run(filmId)
            console.log('      qc_force posé (release acceptée malgré un QC négatif)')
        }
        // Le film doit être remis en file : un statut `qc_failed` ou `error` le
        // laisserait de côté malgré le nouveau fichier.
        db.prepare("UPDATE films SET transcode_status='pending', transcode_error=NULL, qc_attempts=0 WHERE id=?").run(filmId)
        n++
    }
    console.log(`  ${n} film(s) ${APPLY ? 'injectés' : 'à injecter'}`)
    if (!APPLY) console.log('  Relancer avec --apply.')
    if (APPLY) console.log('  Radarr met quelques secondes à scanner ; vérifier ensuite hasFile.')
}

main().catch(err => { console.error('Erreur fatale :', err instanceof Error ? err.message : err); process.exit(1) })
