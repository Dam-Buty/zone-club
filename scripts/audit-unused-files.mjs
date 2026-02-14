#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const strict = process.argv.includes('--strict')

const SCAN_DIRS = ['src', 'app', 'lib', 'scripts', 'tests', 'docs']
const SCAN_FILES = [
  'README.md',
  'CLAUDE.md',
  'package.json',
  'docker-compose.yml',
  'next.config.ts',
  'tsconfig.json',
]

const PUBLIC_DYNAMIC_PREFIXES = ['/studio-logos/', '/basis/']
const SCRIPT_MANUAL_KEEP = new Set([
  'scripts/generateMask.mjs',
  'scripts/generateMaskFromManual.mjs',
  'scripts/init-radarr.sh',
])

async function listFiles(dir) {
  const abs = path.join(ROOT, dir)
  try {
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const files = await Promise.all(
      entries.map(async (entry) => {
        const rel = path.posix.join(dir, entry.name)
        if (entry.isDirectory()) return listFiles(rel)
        return [rel]
      }),
    )
    return files.flat()
  } catch {
    return []
  }
}

async function readCorpus() {
  const chunks = []

  for (const file of SCAN_FILES) {
    try {
      const data = await fs.readFile(path.join(ROOT, file), 'utf8')
      chunks.push(data)
    } catch {
      // Optional file.
    }
  }

  for (const dir of SCAN_DIRS) {
    const files = await listFiles(dir)
    await Promise.all(
      files.map(async (rel) => {
        try {
          const ext = path.extname(rel)
          if (!ext || ['.png', '.jpg', '.jpeg', '.ktx2', '.glb', '.wasm', '.mp4'].includes(ext)) return
          const data = await fs.readFile(path.join(ROOT, rel), 'utf8')
          chunks.push(data)
        } catch {
          // Skip binary/unreadable files.
        }
      }),
    )
  }

  return chunks.join('\n')
}

function isPublicFileUsed(publicPath, corpus) {
  const urlPath = '/' + publicPath.replace(/^public\//, '').replaceAll('\\', '/')

  if (corpus.includes(urlPath)) return true

  for (const prefix of PUBLIC_DYNAMIC_PREFIXES) {
    if (urlPath.startsWith(prefix) && corpus.includes(prefix)) return true
  }

  const base = path.basename(publicPath)
  return corpus.includes(base)
}

function isScriptUsed(scriptPath, corpus) {
  if (SCRIPT_MANUAL_KEEP.has(scriptPath)) return true

  const normalized = scriptPath.replaceAll('\\', '/')
  const base = path.basename(scriptPath)
  return corpus.includes(normalized) || corpus.includes(base)
}

async function run() {
  const corpus = await readCorpus()
  const publicFiles = (await listFiles('public')).filter((f) => !f.endsWith('.DS_Store'))
  const scriptFiles = (await listFiles('scripts')).filter((f) => !f.endsWith('.DS_Store'))

  const unusedPublic = publicFiles.filter((f) => !isPublicFileUsed(f, corpus))
  const unusedScripts = scriptFiles.filter((f) => !isScriptUsed(f, corpus))

  if (unusedPublic.length === 0 && unusedScripts.length === 0) {
    console.log('No obvious unused assets/scripts detected.')
    return
  }

  if (unusedPublic.length > 0) {
    console.log('\nPossible unused public assets:')
    for (const file of unusedPublic) console.log(`- ${file}`)
  }

  if (unusedScripts.length > 0) {
    console.log('\nPossible unused scripts:')
    for (const file of unusedScripts) console.log(`- ${file}`)
  }

  if (strict) process.exit(1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
