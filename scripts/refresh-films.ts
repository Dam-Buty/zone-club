/**
 * Refresh films — relance la chaîne download → transcode pour un film ou tous les films sans media
 *
 * Usage:
 *   npx tsx scripts/refresh-films.ts --film <id>       # refresh par id INTERNE (films.id)
 *   npx tsx scripts/refresh-films.ts --tmdb <id>       # refresh par tmdb_id
 *   npx tsx scripts/refresh-films.ts --all-empty       # refresh tous les films sans file_path_vo_transcoded
 *
 * ⚠️  --all-empty appelle Radarr (rate-limited 500ms/film) — ne pas lancer sans prévoir le trafic.
 */

import { emptyFilmIds, refreshFilm, refreshFilmByTmdb } from '../lib/media/refresh'

const RATE_LIMIT_MS = 500

const args = process.argv.slice(2)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function usage(): void {
    console.log(`Usage:
  npx tsx scripts/refresh-films.ts --film <id>
  npx tsx scripts/refresh-films.ts --tmdb <id>
  npx tsx scripts/refresh-films.ts --all-empty`)
}

async function main(): Promise<void> {
    const filmIdx = args.indexOf('--film')
    const tmdbIdx = args.indexOf('--tmdb')
    const filmRef = filmIdx !== -1 ? args[filmIdx + 1] : undefined
    const tmdbRef = tmdbIdx !== -1 ? args[tmdbIdx + 1] : undefined
    const hasAllEmpty = args.includes('--all-empty')

    const flagCount = (filmIdx !== -1 ? 1 : 0) + (tmdbIdx !== -1 ? 1 : 0) + (hasAllEmpty ? 1 : 0)
    if (flagCount > 1) {
        console.error('Erreur : --film, --tmdb et --all-empty sont mutuellement exclusifs')
        usage()
        process.exit(1)
    }

    if (filmIdx !== -1) {
        if (!filmRef) {
            console.error('Erreur : --film nécessite un argument <id> (id interne films.id)')
            usage()
            process.exit(1)
        }
        const result = await refreshFilm(Number(filmRef))
        console.log(`[refresh] film #${filmRef} → ${result}`)
        return
    }

    if (tmdbIdx !== -1) {
        if (!tmdbRef) {
            console.error('Erreur : --tmdb nécessite un argument <id>')
            usage()
            process.exit(1)
        }
        const result = await refreshFilmByTmdb(Number(tmdbRef))
        console.log(`[refresh] tmdb ${tmdbRef} → ${result}`)
        return
    }

    if (hasAllEmpty) {
        const ids = emptyFilmIds()
        console.log(`[refresh] ${ids.length} film(s) sans media (file_path_vo_transcoded NULL)`)
        const counts: Record<string, number> = {}
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i]
            try {
                const result = await refreshFilm(id)
                counts[result] = (counts[result] ?? 0) + 1
                console.log(`[refresh] [${i + 1}/${ids.length}] film ${id} → ${result}`)
            } catch (err) {
                counts['error'] = (counts['error'] ?? 0) + 1
                console.error(`[refresh] [${i + 1}/${ids.length}] film ${id} : ${errMsg(err)}`)
            }
            if (i < ids.length - 1) await sleep(RATE_LIMIT_MS)
        }
        console.log(`[refresh] Terminé : ${ids.length} film(s) → ${JSON.stringify(counts)}`)
        return
    }

    usage()
    process.exit(1)
}

main().catch((err) => {
    console.error('Erreur fatale :', errMsg(err))
    process.exit(1)
})
