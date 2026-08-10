import ffmpeg from 'fluent-ffmpeg'

// vf.mp4 = vidéo copiée de vo.mp4 + Nième piste audio VF du MKV ré-encodée AAC.
export function muxVf(voMp4: string, mkv: string, vfAudioOrdinal: number, out: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(voMp4)
            .input(mkv)
            .outputOptions([
                '-map', '0:v:0',
                '-map', `1:a:${vfAudioOrdinal}`,
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart',
            ])
            .output(out)
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
}

// Extrait une piste sous-titre texte (index absolu) vers srt puis vtt.
export function extractSub(mkv: string, subAbsoluteIndex: number, outSrt: string, outVtt: string): Promise<void> {
    const one = (out: string) => new Promise<void>((resolve, reject) => {
        ffmpeg(mkv)
            .outputOptions(['-map', `0:${subAbsoluteIndex}`])
            .output(out)
            .on('end', () => resolve())
            .on('error', reject)
            .run()
    })
    return one(outSrt).then(() => one(outVtt))
}
