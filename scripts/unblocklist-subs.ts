/**
 * Retire des releases de la blocklist Radarr et relance ce qui en a besoin.
 *
 * Avant l'OCR des PGS, une release dont les sous-titres français n'étaient que des
 * images était refusée au contrôle qualité, blacklistée, puis remplacée. Ces
 * releases sont bonnes : ce script les rend à nouveau disponibles.
 *
 * La sélection se fait par IDENTIFIANT DE BLOCKLIST, pas par le message d'erreur
 * en base : celui-ci est effacé dès que le film repasse en `pending` (la reprise au
 * démarrage le fait), ce qui rendait toute sélection par motif inopérante quelques
 * minutes après le rejet.
 *
 * Usage:
 *   npx tsx scripts/unblocklist-subs.ts --ids 112,125,126,129,130,131
 *   npx tsx scripts/unblocklist-subs.ts --ids ... --apply
 */

// Sans au moins un import/export, TypeScript traite le fichier comme un script
// GLOBAL et non comme un module : ses `api` et `main` collisionnent alors avec
// celles de configure-radarr.ts (« Duplicate function implementation »).
export {}
const APPLY = process.argv.includes('--apply')
const BASE = process.env.RADARR_URL
const KEY = process.env.RADARR_API_KEY

const idsArg = process.argv[process.argv.indexOf('--ids') + 1]
const IDS = process.argv.includes('--ids') && idsArg
    ? idsArg.split(',').map(s => Number(s.trim())).filter(Number.isFinite)
    : []

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${BASE}/api/v3${path}`, {
        ...init,
        headers: { 'X-Api-Key': KEY as string, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    const body = await r.text()
    return (body ? JSON.parse(body) : undefined) as T
}

interface BlocklistItem { id: number; movieId: number; sourceTitle: string }
interface QueueItem { movieId: number }

async function main(): Promise<void> {
    if (!IDS.length) { console.error('Rien à faire : passer --ids 1,2,3'); process.exit(1) }

    const bl = await api<{ records: BlocklistItem[] }>('/blocklist?pageSize=500')
    const found = (bl.records || []).filter(b => IDS.includes(b.id))
    const missing = IDS.filter(id => !found.some(b => b.id === id))
    for (const id of missing) console.warn(`  ⚠️  blocklist id ${id} introuvable (déjà retirée ?)`)

    const movieIds = [...new Set(found.map(b => b.movieId))]
    for (const b of found) {
        console.log(`  ${APPLY ? 'retrait' : '[à retirer]'} ${b.sourceTitle}`)
        if (APPLY) await api(`/blocklist/${b.id}`, { method: 'DELETE' })
    }
    if (!APPLY) { console.log('\nRien appliqué. Relancer avec --apply.'); return }

    // Ne relancer une recherche QUE pour les films qui n'ont ni fichier ni
    // téléchargement en cours : sinon Radarr pourrait abandonner une release déjà
    // téléchargée à 100 % au profit d'une autre, et on paierait la bande passante
    // deux fois pour rien.
    const queue = await api<{ records: QueueItem[] }>('/queue?pageSize=200')
    const busy = new Set((queue.records || []).map(q => q.movieId))
    for (const movieId of movieIds) {
        const m = await api<{ title: string; hasFile: boolean }>(`/movie/${movieId}`)
        if (m.hasFile || busy.has(movieId)) {
            console.log(`  ${m.title} : déjà servi (fichier ou téléchargement en cours) — pas de recherche`)
            continue
        }
        await api('/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }) })
        console.log(`  ${m.title} : recherche relancée`)
    }
}

main().catch(err => { console.error('Erreur fatale :', err instanceof Error ? err.message : err); process.exit(1) })
