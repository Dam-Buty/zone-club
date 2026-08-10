import { createReadStream, createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const BASE = process.env.TRANSCODE_API_URL || 'https://transcode.agi-so.fr'
const CRLF = '\r\n'

export interface TranscodeParams {
  targetHeight?: number
  targetCodec?: string
  preset?: string
  targetBitrate?: string
  cq?: number
  audioOrdinal?: number
}

export interface TranscodeJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  progress?: { percent?: number }
  error?: string
}

function authHeader(): string {
  const raw = process.env.TRANSCODE_API_AUTH || ''
  return 'Basic ' + Buffer.from(raw).toString('base64')
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function newBoundary(): string {
  return `----zoneclub-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function partHeader(boundary: string, name: string, filename?: string, contentType?: string): Uint8Array {
  let head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"`
  if (filename) head += `; filename="${filename}"`
  head += CRLF
  if (contentType) head += `Content-Type: ${contentType}${CRLF}`
  return bytes(head + CRLF)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function multipartBody(fileStream: Readable, preamble: Uint8Array, tail: Uint8Array): ReadableStream<Uint8Array> {
  const iterator = fileStream[Symbol.asyncIterator]()
  let stage: 'preamble' | 'file' | 'tail' = 'preamble'
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'preamble') {
        controller.enqueue(preamble)
        stage = 'file'
        return
      }
      if (stage === 'file') {
        const { done, value } = await iterator.next()
        if (done) {
          stage = 'tail'
          return
        }
        controller.enqueue(value)
        return
      }
      controller.enqueue(tail)
      controller.close()
    },
    cancel() {
      fileStream.destroy()
    },
  })
}

export async function createJob(filePath: string, params: TranscodeParams): Promise<TranscodeJob> {
  const { size } = await stat(filePath)
  const boundary = newBoundary()
  const preamble = partHeader(boundary, 'file', 'input.mkv', 'application/octet-stream')

  const fields: [string, string][] = [
    ['target_codec', params.targetCodec ?? 'h264_nvenc'],
    ['target_height', String(params.targetHeight ?? 1080)],
    ['preset', params.preset ?? 'p4'],
  ]
  if (params.targetBitrate) fields.push(['target_bitrate', params.targetBitrate])
  else if (params.cq != null) fields.push(['cq', String(params.cq)])
  if (params.audioOrdinal != null) fields.push(['audio_stream', String(params.audioOrdinal)])

  const tailParts: Uint8Array[] = []
  for (const [name, value] of fields) {
    tailParts.push(partHeader(boundary, name))
    tailParts.push(bytes(value))
    tailParts.push(bytes(CRLF))
  }
  tailParts.push(bytes(`--${boundary}--${CRLF}`))
  const tail = concatBytes(tailParts)

  const fileStream = createReadStream(filePath)
  const body = multipartBody(fileStream, preamble, tail)
  const contentLength = preamble.byteLength + size + tail.byteLength

  // TODO(media): valider l'upload streamé contre le vrai service quand TRANSCODE_API_AUTH
  // sera disponible (Task 17 du plan) — le multipart est construit correctement ici.
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(contentLength),
    },
    body,
    // @ts-expect-error — undici fetch (runtime Node 22) exige `duplex: 'half'` pour un body
    // ReadableStream ; la propriété est absente du type DOM RequestInit.
    duplex: 'half',
  })
  if (!res.ok) throw new Error(`transcode createJob ${res.status}: ${await res.text()}`)
  return res.json() as Promise<TranscodeJob>
}

export async function getJob(id: string): Promise<TranscodeJob> {
  const res = await fetch(`${BASE}/jobs/${id}`, { headers: { Authorization: authHeader() } })
  if (!res.ok) throw new Error(`transcode getJob ${res.status}`)
  return res.json() as Promise<TranscodeJob>
}

export async function downloadOutput(id: string, destPath: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}/output`, { headers: { Authorization: authHeader() } })
  if (res.status === 409) throw new Error('output_not_ready')
  if (!res.ok) throw new Error(`transcode download ${res.status}`)
  if (!res.body) throw new Error('transcode download: no response body')
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destPath))
}

export async function waitForJob(id: string, onProgress?: (percent: number) => void, intervalMs = 3000): Promise<void> {
  for (;;) {
    const job = await getJob(id)
    if (job.progress?.percent != null) onProgress?.(job.progress.percent)
    if (job.status === 'done') return
    if (job.status === 'failed') throw new Error(`transcode job failed: ${job.error || 'unknown'}`)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
