/**
 * Déblocage des releases blacklistées à tort pour « sous-titres français ».
 *
 * Avant l'OCR des PGS, une release dont les sous-titres français n'étaient que des
 * images était refusée au contrôle qualité, blacklistée, et remplacée par une
 * recherche. Ces releases sont bonnes : ce script les retire de la blocklist et
 * remet les films en file.
 *
 * Usage:
 *   npx tsx scripts/unblocklist-subs.ts            # liste seulement
 *   npx tsx scripts/unblocklist-subs.ts --apply    # applique
 */
import { db } from '../lib/db'

const APPLY = process.argv.includes('--apply')
const URL = process.env.RADARR_URL
const KEY = process.env.RADARR_API_KEY

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${URL}/api/v3${path}`, {
        ...init,
        headers: { 'X-Api-Key': KEY as string, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    return r.status === 200 && r.headers.get('content-length') !== '0'
        ? (r.json() as Promise<T>) : (undefined as T)
}

async function main(): Promise<void> {
    const films = db.prepare(
        "SELECT id, title, radarr_id FROM films WHERE transcode_error LIKE '%sous-titres%' AND radarr_id IS NOT NULL",
    ).all() as { id: number; title: string; radarr_id: number }[]
    if (!films.length) { console.log('Aucun film rejeté pour sous-titres.'); return }

    const bl = await api<{ records: { id: number; movieId: number; sourceTitle: string }[] }>('/blocklist?pageSize=500')
    const byMovie = new Map<number, typeof bl.records>()
    for (const b of bl.records || []) {
        if (!byMovie.has(b.movieId)) byMovie.set(b.movieId, [])
        byMovie.get(b.movieId)!.push(b)
    }

    for (const f of films) {
        const entries = byMovie.get(f.radarr_id) || []
        console.log(`${f.title} — ${entries.length} entrée(s)`)
        for (const b of entries) {
            console.log(`  ${APPLY ? 'déblocage' : '[à débloquer]'} ${b.sourceTitle}`)
            if (APPLY) await api(`/blocklist/${b.id}`, { method: 'DELETE' })
        }
        if (!APPLY) continue
        // Le compteur de tentatives doit repartir de zéro : sinon les films
        // rejetés 1 ou 2 fois atteindraient la limite dès la prochaine anomalie.
        db.prepare("UPDATE films SET qc_attempts = 0, transcode_status = 'pending', transcode_error = NULL WHERE id = ?")
            .run(f.id)
        await api('/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [f.radarr_id] }) })
        console.log('  → compteur remis à zéro, recherche relancée')
    }
    if (!APPLY) console.log('\nRien appliqué. Relancer avec --apply.')
}

main().catch(err => { console.error('Erreur fatale :', err instanceof Error ? err.message : err); process.exit(1) })
