/**
 * Refresh films — relance la chaîne download → transcode pour un film ou tous les films sans media
 *
 * Usage:
 *   npx tsx scripts/refresh-films.ts --film <idOrTmdb>   # refresh un film (id interne OU tmdb_id)
 *   npx tsx scripts/refresh-films.ts --all-empty          # refresh tous les films sans file_path_vo_transcoded
 *
 * ⚠️  --all-empty appelle Radarr (rate-limited 500ms/film) — ne pas lancer sans prévoir le trafic.
 */

import { emptyFilmIds, refreshFilm, refreshFilmByRef } from '../lib/media/refresh'

const RATE_LIMIT_MS = 500

const args = process.argv.slice(2)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function usage(): void {
    console.log(`Usage:
  npx tsx scripts/refresh-films.ts --film <idOrTmdb>
  npx tsx scripts/refresh-films.ts --all-empty`)
}

async function main(): Promise<void> {
    const filmIdx = args.indexOf('--film')
    const filmRef = filmIdx !== -1 ? args[filmIdx + 1] : undefined
    const hasAllEmpty = args.includes('--all-empty')

    if (filmIdx !== -1 && hasAllEmpty) {
        console.error('Erreur : --film et --all-empty sont mutuellement exclusifs')
        usage()
        process.exit(1)
    }

    if (filmIdx !== -1) {
        if (!filmRef) {
            console.error('Erreur : --film nécessite un argument <idOrTmdb>')
            usage()
            process.exit(1)
        }
        const result = await refreshFilmByRef(filmRef)
        console.log(`[refresh] film ${filmRef} → ${result}`)
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
