import type { TrackIdentification } from './identify-tracks'
import { isFrench } from './iso639'

// Contrôle qualité d'une release, appliqué APRÈS téléchargement.
//
// Pourquoi après : l'API Newznab de NZBFinder n'expose aucune métadonnée audio
// (vérifié — `t=details` rend les mêmes 7 attributs que la recherche, et getnfo /
// nfo / mediainfo répondent "No such function"). Le seul signal disponible avant
// téléchargement est le nom de la release, c'est-à-dire exactement l'heuristique
// « MULTI dans le titre » dont on cherche à se passer. On télécharge donc, on
// sonde le fichier, et on rejette si le compte n'y est pas.
//
// Critère maximaliste : pour un film non francophone on veut les trois usages du
// vidéoclub — le voir doublé, le voir en VO, le voir en VOSTFR. Un film français
// n'a qu'une piste qui compte.

export interface QcRequirements {
    vfAudio: boolean
    voAudio: boolean
    frSubs: boolean
}

export interface QcVerdict {
    ok: boolean
    missing: string[]
}

export function qcRequirements(): QcRequirements {
    const on = (name: string) => process.env[name] !== 'false'
    return {
        vfAudio: on('QC_REQUIRE_VF_AUDIO'),
        voAudio: on('QC_REQUIRE_VO_AUDIO'),
        frSubs: on('QC_REQUIRE_FR_SUBS'),
    }
}

export function maxQcAttempts(): number {
    const n = Number(process.env.QC_MAX_ATTEMPTS)
    return Number.isFinite(n) && n > 0 ? n : 3
}

export function checkRelease(
    tracks: TrackIdentification,
    originalLanguage: string | null,
    req: QcRequirements = qcRequirements(),
): QcVerdict {
    const missing: string[] = []
    const frenchFilm = isFrench(originalLanguage)

    if (frenchFilm) {
        // VO == VF : une seule piste audio a du sens, et des sous-titres français
        // sur un film français ne sont pas un critère de qualité de release.
        if (req.vfAudio && tracks.vfAudioOrdinal == null && tracks.voAudioOrdinal == null) {
            missing.push('piste audio française')
        }
        return { ok: missing.length === 0, missing }
    }

    if (req.vfAudio && tracks.vfAudioOrdinal == null) missing.push('piste audio VF')
    // La VO doit être une piste distincte de la VF : si identifyTracks a dû retomber
    // sur la piste française faute de mieux, il n'y a pas de vraie VO.
    if (req.voAudio && (tracks.voAudioOrdinal == null || tracks.voAudioOrdinal === tracks.vfAudioOrdinal)) {
        missing.push('piste audio VO')
    }
    // Une piste PGS/VobSub compte : l'OCR la convertit en SRT au moment de
    // l'extraction. Ne regarder que `textSubs` faisait refuser des releases qui
    // portaient bel et bien des sous-titres français — c'est la norme sur les
    // BluRay de catalogue, où le PGS est le seul format proposé.
    const hasFr = tracks.textSubs.some(s => s.lang === 'fr')
        || tracks.imageSubs.some(s => s.lang === 'fr')
    if (req.frSubs && !hasFr) missing.push('sous-titres français')

    return { ok: missing.length === 0, missing }
}
