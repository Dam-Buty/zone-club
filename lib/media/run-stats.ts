import { db } from '../db'

// Mesures de traitement, une ligne par passage de processFilm.
//
// Les logs ne suffisent pas pour ça : le driver Docker est journald, dont le
// journal est déjà à son plafond de 4 Gio et tourne en permanence (~12 jours de
// fenêtre, partagée avec tous les services de la machine). Extraire des moyennes
// après plusieurs jours de transcode supposerait en plus de parser du texte
// français dont j'ai changé la formulation quatre fois dans la même journée.
//
// Une ligne par run, interrogeable en SQL, qui survit à tout.

export interface RunTimings {
    encode_seconds?: number
    audio_seconds?: number
    subs_seconds?: number
    remux_seconds?: number
    backup_seconds?: number
}

export interface RunSource {
    source_bytes?: number
    source_seconds?: number
    source_video_codec?: string | null
    source_video_height?: number | null
    source_video_bitrate?: number | null
}

export interface RunDecision {
    video_action?: string        // 'copy' | 'encode'
    video_reason?: string
}

export interface RunOutputs {
    vo_bytes?: number | null
    vf_bytes?: number | null
    sub_langs?: string | null
}

type RunPatch = RunTimings & RunSource & RunDecision & RunOutputs & {
    outcome?: string             // 'done' | 'rejected' | 'stuck' | 'error'
    error?: string | null
    finished_at?: string
    total_seconds?: number
}

// Aucune de ces écritures ne doit pouvoir faire échouer un traitement : la
// mesure est un confort, pas une fonction. On avale donc les erreurs.
export function startRun(filmId: number): number | null {
    try {
        const r = db.prepare(
            'INSERT INTO film_processing_runs (film_id, started_at) VALUES (?, datetime(\'now\'))'
        ).run(filmId)
        return Number(r.lastInsertRowid)
    } catch (err) {
        console.warn('[run-stats] démarrage non enregistré:', err instanceof Error ? err.message : String(err))
        return null
    }
}

export function patchRun(runId: number | null, patch: RunPatch): void {
    if (runId == null) return
    const cols = Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined)
    if (cols.length === 0) return
    try {
        db.prepare(`UPDATE film_processing_runs SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
            .run(...cols.map(c => (patch as Record<string, unknown>)[c]), runId)
    } catch (err) {
        console.warn('[run-stats] mise à jour ignorée:', err instanceof Error ? err.message : String(err))
    }
}

export function finishRun(runId: number | null, outcome: string, startedAtMs: number, error?: string): void {
    patchRun(runId, {
        outcome,
        error: error ?? null,
        finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        total_seconds: (Date.now() - startedAtMs) / 1000,
    })
}

// Chronomètre une étape et renvoie sa durée avec le résultat.
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; seconds: number }> {
    const t = Date.now()
    const value = await fn()
    return { value, seconds: (Date.now() - t) / 1000 }
}
