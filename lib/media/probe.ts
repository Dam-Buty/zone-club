import ffmpeg from 'fluent-ffmpeg'
import type { ProbeStream } from './identify-tracks'

export function probeStreams(filePath: string): Promise<{ streams: ProbeStream[]; duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err)
      resolve({
        streams: (meta.streams as any[]).map(s => ({
          index: s.index,
          codec_type: s.codec_type,
          codec_name: s.codec_name,
          tags: s.tags,
        })),
        duration: meta.format?.duration ?? 0,
      })
    })
  })
}
