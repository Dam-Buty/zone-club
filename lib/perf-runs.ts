// Mesures de terrain : une ligne par entrée dans la boutique, envoyée par le navigateur.
// Même logique que film_processing_runs pour le pipeline média — les questions arrivent
// après coup, et un seul Mac de développement ne dit rien des téléphones des visiteurs.

import { db } from './db';
import type { PerfRun } from './perf-run-parse';

const COLUMNS = [
    'build', 'three', 'outcome', 'automated', 'first_visit', 'is_mobile',
    'exterior_ms', 'storefront_ms', 'click_ms', 'click_to_ready_ms', 'warmup_ms', 'precompile_ms',
    'long_tasks_ms', 'post_gaps_ms', 'post_worst_gap_ms', 'post_fps', 'pipelines', 'posters',
    'ua', 'platform', 'platform_version', 'model', 'gpu_vendor', 'gpu_arch', 'gpu_device', 'gpu_desc',
    'cores', 'memory_gb', 'screen_w', 'screen_h', 'dpr', 'net_type', 'net_downlink',
] as const satisfies readonly Exclude<keyof PerfRun, 'run_key'>[];

// Le navigateur envoie la même passe plusieurs fois, à mesure qu'elle avance (devanture vue,
// clic, scène prête, puis 10 s plus tard) : la ligne est créée au premier envoi et complétée
// ensuite. Une passe arrivée à « prête » ne redescend jamais, même si un envoi antérieur
// arrive en retard.
const upsertStmt = db.prepare(
    `INSERT INTO client_perf_runs (run_key, created_at, updated_at, ${COLUMNS.join(', ')})
     VALUES (@run_key, datetime('now'), datetime('now'), ${COLUMNS.map((c) => '@' + c).join(', ')})
     ON CONFLICT(run_key) DO UPDATE SET
         updated_at = datetime('now'),
         ${COLUMNS.map((c) => `${c} = excluded.${c}`).join(',\n         ')}
     WHERE client_perf_runs.outcome NOT IN ('ready', 'warmup_max')
        OR excluded.outcome IN ('ready', 'warmup_max')`
);

export function savePerfRun(run: PerfRun): void {
    upsertStmt.run(run);
}

export interface PerfRunRow extends PerfRun {
    id: number;
    created_at: string;
    updated_at: string;
}

export interface PerfGroup {
    device: string;
    build: string;
    is_mobile: number;
    first_visit: number;
    runs: number;
    ready: number;
    click_to_ready_p50: number | null;
    click_to_ready_p75: number | null;
    warmup_p50: number | null;
    storefront_p50: number | null;
    post_gaps_p50: number | null;
    post_fps_p50: number | null;
}

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
}

function numbers(rows: PerfRunRow[], key: keyof PerfRunRow): number[] {
    return rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
}

/** Étiquette d'appareil : le modèle quand le navigateur le donne, sinon le GPU, sinon la plateforme. */
export function deviceLabel(r: Pick<PerfRun, 'model' | 'gpu_vendor' | 'gpu_arch' | 'platform'>): string {
    if (r.model) return r.model;
    const gpu = [r.gpu_vendor, r.gpu_arch].filter(Boolean).join(' ');
    if (gpu) return r.platform ? `${r.platform} · ${gpu}` : gpu;
    return r.platform ?? 'inconnu';
}

/**
 * Répartition par appareil, build, mobile/desktop et première visite/retour.
 * Les passes automatisées (navigator.webdriver) sont écartées par défaut.
 */
export function summarizePerfRuns(days: number, includeAutomated: boolean): { groups: PerfGroup[]; outcomes: Record<string, number>; total: number } {
    const rows = db.prepare(
        `SELECT * FROM client_perf_runs
         WHERE created_at >= datetime('now', ?) ${includeAutomated ? '' : 'AND automated = 0'}
         ORDER BY id DESC LIMIT 20000`
    ).all(`-${Math.max(1, Math.min(365, Math.round(days)))} days`) as PerfRunRow[];

    const outcomes: Record<string, number> = {};
    const buckets = new Map<string, PerfRunRow[]>();
    for (const r of rows) {
        outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
        const key = [deviceLabel(r), r.build, r.is_mobile, r.first_visit].join('\u0001');
        const list = buckets.get(key);
        if (list) list.push(r);
        else buckets.set(key, [r]);
    }

    const groups: PerfGroup[] = [];
    for (const [key, list] of buckets) {
        const [device, build, isMobile, firstVisit] = key.split('\u0001');
        const ready = list.filter((r) => r.outcome === 'ready' || r.outcome === 'warmup_max');
        groups.push({
            device,
            build,
            is_mobile: Number(isMobile),
            first_visit: Number(firstVisit),
            runs: list.length,
            ready: ready.length,
            click_to_ready_p50: percentile(numbers(ready, 'click_to_ready_ms'), 0.5),
            click_to_ready_p75: percentile(numbers(ready, 'click_to_ready_ms'), 0.75),
            warmup_p50: percentile(numbers(ready, 'warmup_ms'), 0.5),
            storefront_p50: percentile(numbers(list, 'storefront_ms'), 0.5),
            post_gaps_p50: percentile(numbers(ready, 'post_gaps_ms'), 0.5),
            post_fps_p50: percentile(numbers(ready, 'post_fps'), 0.5),
        });
    }
    groups.sort((a, b) => b.runs - a.runs);
    return { groups, outcomes, total: rows.length };
}

export function recentPerfRuns(limit: number): PerfRunRow[] {
    return db.prepare('SELECT * FROM client_perf_runs ORDER BY id DESC LIMIT ?')
        .all(Math.max(1, Math.min(500, Math.round(limit)))) as PerfRunRow[];
}
