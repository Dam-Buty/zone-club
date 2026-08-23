import type { ProbeStream } from './identify-tracks'

// Décide si la piste vidéo doit passer par le GPU ou peut être copiée telle quelle.
//
// Mesuré sur deux films réels :
//   2001 (BluRay)    8,5 Mbit/s → 3,37 Mbit/s après nvenc cq23  : −60 %, l'encodage vaut le coup
//   Chihiro (WEB-DL) 4,98 Mbit/s → 4,93 Mbit/s                  : −1 %, 10 min de GPU pour rien
//
// NVENC est moins efficace par bit qu'un x264 lent. Sur une source déjà comprimée
// autour de 5 Mbit/s, le réencodage ne gagne rien en taille et perd une génération
// de qualité. On ne réencode donc que si ça sert : format incompatible avec un
// navigateur, définition hors cadre, ou débit assez haut pour que la compression
// paie.

const MAX_HEIGHT = Number(process.env.GPU_MAX_HEIGHT || 1080)
const MAX_WIDTH = Number(process.env.GPU_MAX_WIDTH || 1920)
// Au-dessus, on réencode même si la source est lisible : c'est de la bande passante
// de streaming, pas de la qualité perçue.
const COPY_MAX_BITRATE = Number(process.env.VIDEO_COPY_MAX_BITRATE || 6_000_000)

// Profils H.264 que tous les navigateurs décodent. High 10 / 4:2:2 / 4:4:4 sont du
// h264 valide mais qu'aucun navigateur grand public ne lit.
const WEB_PROFILES = new Set(['baseline', 'constrained baseline', 'main', 'high'])

export interface VideoPlan {
    action: 'copy' | 'encode'
    reason: string
    bitrate: number | null
}

// Débit de la piste vidéo. Matroska ne renseigne presque jamais `bit_rate` par
// stream : on retombe sur (taille totale − audio) / durée, qui suffit largement
// pour un seuil.
export function estimateVideoBitrate(streams: ProbeStream[], totalSize: number, duration: number): number | null {
    const video = streams.find(s => s.codec_type === 'video')
    const declared = Number(video?.bit_rate)
    if (Number.isFinite(declared) && declared > 0) return declared

    if (!(totalSize > 0) || !(duration > 0)) return null
    const audioBits = streams
        .filter(s => s.codec_type === 'audio')
        .reduce((sum, s) => sum + (Number(s.bit_rate) || 0), 0)
    const estimate = (totalSize * 8) / duration - audioBits
    return estimate > 0 ? estimate : null
}

export function planVideo(streams: ProbeStream[], totalSize: number, duration: number): VideoPlan {
    const video = streams.find(s => s.codec_type === 'video')
    const bitrate = estimateVideoBitrate(streams, totalSize, duration)

    if (!video) return { action: 'encode', reason: 'aucune piste vidéo identifiée', bitrate }
    if (video.codec_name !== 'h264') {
        return { action: 'encode', reason: `codec ${video.codec_name} non lisible partout`, bitrate }
    }
    if (video.pix_fmt !== 'yuv420p') {
        return { action: 'encode', reason: `pix_fmt ${video.pix_fmt} (hors 8 bits 4:2:0)`, bitrate }
    }
    if (!WEB_PROFILES.has((video.profile || '').toLowerCase())) {
        return { action: 'encode', reason: `profil H.264 "${video.profile}" non lisible partout`, bitrate }
    }
    if ((video.width ?? 0) > MAX_WIDTH || (video.height ?? 0) > MAX_HEIGHT) {
        return { action: 'encode', reason: `${video.width}×${video.height} dépasse ${MAX_WIDTH}×${MAX_HEIGHT}`, bitrate }
    }
    if (bitrate == null) {
        return { action: 'encode', reason: 'débit vidéo indéterminable', bitrate }
    }
    if (bitrate > COPY_MAX_BITRATE) {
        return {
            action: 'encode',
            reason: `${(bitrate / 1e6).toFixed(1)} Mbit/s > seuil ${(COPY_MAX_BITRATE / 1e6).toFixed(1)} Mbit/s`,
            bitrate,
        }
    }
    return {
        action: 'copy',
        reason: `déjà H.264 ${video.profile} ${video.width}×${video.height} à ${(bitrate / 1e6).toFixed(1)} Mbit/s`,
        bitrate,
    }
}
