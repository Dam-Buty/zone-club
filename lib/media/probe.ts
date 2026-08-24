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
          // Nécessaires pour repérer une source HDR : le Spark n'a ni Vulkan ni
          // OpenCL, donc aucun tonemapping GPU. Sans ces champs, une source HDR
          // encodée en SDR passerait inaperçue (image délavée, sans erreur).
          color_transfer: s.color_transfer,
          color_primaries: s.color_primaries,
          tags: s.tags,
        })),
        duration: Number(meta.format?.duration) || 0,
        size: Number(meta.format?.size) || 0,
      })
    })
  })
}
