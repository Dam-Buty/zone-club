/**
 * Bench upload vers le service de transcode (à la louche).
 * Mesure la vitesse d'upload réelle (streaming multipart, le code de createJob).
 *
 * Usage:
 *   npm run bench:upload                # 300 Mo par défaut
 *   npm run bench:upload -- 500         # 500 Mo
 */

import { open, rm, mkdtemp, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createJob, deleteJob } from '../lib/media/transcode-service'

async function main(): Promise<void> {
    const sizeArg = process.argv[2]
    const mb = sizeArg ? parseInt(sizeArg, 10) : 300
    if (!Number.isFinite(mb) || mb <= 0) {
        console.error('Usage: npm run bench:upload -- <taille en Mo>')
        process.exit(1)
    }

    const dir = await mkdtemp(join(tmpdir(), 'upload-bench-'))
    const file = join(dir, 'bench.bin')
    const chunk = Buffer.alloc(4 * 1024 * 1024) // 4 Mo par écriture

    console.log(`[bench] création de ${mb} Mo de données…`)
    const fh = await open(file, 'w')
    let written = 0
    const target = mb * 1024 * 1024
    while (written < target) {
        await fh.write(chunk, 0, Math.min(chunk.length, target - written))
        written += Math.min(chunk.length, target - written)
    }
    await fh.close()

    const st = await stat(file)
    const t0 = Date.now()
    console.log(`[bench] upload de ${(st.size / 1e6).toFixed(0)} Mo vers le service…`)
    const job = await createJob(file, { targetHeight: 1080, preset: 'p4' })
    const secs = (Date.now() - t0) / 1000
    console.log(`[bench] upload terminé en ${secs.toFixed(1)}s → ${(st.size / 1e6 / secs).toFixed(1)} Mo/s (${(st.size / 1e9 / secs).toFixed(2)} Go/s)`)

    try {
        await deleteJob(job.id)
        console.log(`[bench] job ${job.id} annulé`)
    } catch (err) {
        console.warn(`[bench] job ${job.id} laissé côté service (${err instanceof Error ? err.message : String(err)})`)
    }
    await rm(dir, { recursive: true, force: true })
    console.log('[bench] temp supprimé')
}

main().catch((err) => {
    console.error('Erreur fatale:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
