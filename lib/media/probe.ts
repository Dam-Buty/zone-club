import ffmpeg from 'fluent-ffmpeg'
import type { ProbeStream } from './identify-tracks'

export function probeStreams(filePath: string): Promise<{ streams: ProbeStream[]; duration: number; size: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err)
      resolve({
        streams: (meta.streams as any[]).map(s => ({
          index: s.index,
          codec_type: s.codec_type,
          codec_name: s.codec_name,
          width: s.width,
          height: s.height,
          pix_fmt: s.pix_fmt,
          profile: s.profile,
          bit_rate: s.bit_rate,
          tags: s.tags,
        })),
        duration: Number(meta.format?.duration) || 0,
        size: Number(meta.format?.size) || 0,
      })
    })
  })
}
