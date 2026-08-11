/**
 * Bench upload vers le service de transcode (à la louche).
 * Génère un vrai clip MKV valide (le service probe le fichier), l'upload
 * via le même chemin streamé que createJob, mesure la vitesse, annule le job.
 *
 * Usage:
 *   npm run bench:upload              # ~300 Mo par défaut
 *   npm run bench:upload -- 500       # ~500 Mo
 *
 * NB: ffmpeg doit être installé sur la machine.
 */

import { rm, mkdtemp, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createJob, deleteJob } from '../lib/media/transcode-service'

const execFileP = promisify(execFile)

async function main(): Promise<void> {
    const sizeArg = process.argv[2]
    const targetMB = sizeArg ? parseInt(sizeArg, 10) : 300
    if (!Number.isFinite(targetMB) || targetMB <= 0) {
        console.error('Usage: npm run bench:upload -- <taille en Mo>')
        process.exit(1)
    }

    const dir = await mkdtemp(join(tmpdir(), 'upload-bench-'))
    const file = join(dir, 'bench.mkv')

    const BITRATE_K = 60_000 // 60 Mbps (testsrc est compressible, on force pour se rapprocher de la cible)
    const durationSec = Math.max(3, Math.round((targetMB * 8) / BITRATE_K))

    console.log(`[bench] génération d'un clip MKV valide ~${targetMB} Mo (${durationSec}s @ 60 Mbps)…`)
    await execFileP('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc=duration=${durationSec}:size=1920x1080:rate=30`,
        '-f', 'lavfi', '-i', `sine=frequency=1000:duration=${durationSec}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${BITRATE_K}k`,
        '-maxrate', `${BITRATE_K}k`, '-bufsize', `${BITRATE_K * 2}k`,
        '-c:a', 'aac', '-shortest', '-y', file,
    ])

    const st = await stat(file)
    const sizeMB = st.size / 1e6
    console.log(`[bench] fichier généré: ${sizeMB.toFixed(0)} Mo`)

    const t0 = Date.now()
    console.log(`[bench] upload…`)
    const job = await createJob(file, { targetHeight: 1080, preset: 'p4' })
    const secs = (Date.now() - t0) / 1000
    console.log(`[bench] upload ${sizeMB.toFixed(0)} Mo en ${secs.toFixed(1)}s → ${(sizeMB / secs).toFixed(1)} Mo/s`)

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
