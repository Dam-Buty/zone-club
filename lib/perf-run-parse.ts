// Validation d'une mesure d'entrée dans la boutique envoyée par le navigateur.
//
// Fichier volontairement sans import : il est chargé tel quel par les tests (node --test,
// retrait de types natif), et il ne doit rien savoir de la base.
//
// Ce qui est accepté ici est ce qui sera stocké. Aucune donnée personnelle : pas de compte,
// pas d'adresse IP, pas d'identifiant de visiteur — des durées et du matériel. La clé
// `run_key` est tirée au hasard à chaque chargement de page et n'est conservée nulle part
// côté navigateur : elle relie les envois d'UNE entrée, pas les visites d'une personne.

export const PERF_OUTCOMES = ['ready', 'warmup_max', 'no_webgpu', 'abandoned', 'no_entry'] as const;
export type PerfOutcome = (typeof PERF_OUTCOMES)[number];

export interface PerfRun {
    /** Clé aléatoire tirée à chaque chargement de page : relie les envois d'une même entrée. */
    run_key: string;
    build: string;
    three: string | null;
    outcome: PerfOutcome;
    automated: 0 | 1;
    first_visit: 0 | 1;
    is_mobile: 0 | 1;
    // jalons, en ms depuis le début de la navigation
    exterior_ms: number | null;
    storefront_ms: number | null;
    click_ms: number | null;
    // durées, en ms
    click_to_ready_ms: number | null;
    warmup_ms: number | null;
    precompile_ms: number | null;
    long_tasks_ms: number | null;
    post_gaps_ms: number | null;
    post_worst_gap_ms: number | null;
    post_fps: number | null;
    pipelines: number | null;
    posters: number | null;
    // matériel
    ua: string | null;
    platform: string | null;
    platform_version: string | null;
    model: string | null;
    gpu_vendor: string | null;
    gpu_arch: string | null;
    gpu_device: string | null;
    gpu_desc: string | null;
    cores: number | null;
    memory_gb: number | null;
    screen_w: number | null;
    screen_h: number | null;
    dpr: number | null;
    net_type: string | null;
    net_downlink: number | null;
}

/** Taille maximale du corps accepté par la route, en octets. */
export const PERF_MAX_BODY_BYTES = 4096;

// Dix minutes : au-delà, ce n'est plus une mesure d'entrée mais un onglet oublié.
const MAX_MS = 600_000;

function str(v: unknown, max: number): string | null {
    if (typeof v !== 'string') return null;
    // Caractères de contrôle retirés : ces champs finissent dans des tableaux d'admin.
    const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return s.length === 0 ? null : s.slice(0, max);
}

function num(v: unknown, min: number, max: number): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (v < min || v > max) return null;
    return v;
}

function ms(v: unknown): number | null {
    const n = num(v, 0, MAX_MS);
    return n === null ? null : Math.round(n);
}

function int(v: unknown, min: number, max: number): number | null {
    const n = num(v, min, max);
    return n === null ? null : Math.round(n);
}

function flag(v: unknown): 0 | 1 {
    return v === 1 || v === true ? 1 : 0;
}

/** Rend la mesure nettoyée, ou null si l'entrée n'est pas une mesure exploitable. */
export function parsePerfRun(input: unknown): PerfRun | null {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
    const o = input as Record<string, unknown>;

    const outcome = PERF_OUTCOMES.find((x) => x === o.outcome);
    const build = str(o.build, 40);
    const runKey = typeof o.run_key === 'string' && /^[a-f0-9]{16,40}$/.test(o.run_key) ? o.run_key : null;
    if (!outcome || !build || !runKey) return null;

    return {
        run_key: runKey,
        build,
        three: str(o.three, 16),
        outcome,
        automated: flag(o.automated),
        first_visit: flag(o.first_visit),
        is_mobile: flag(o.is_mobile),
        exterior_ms: ms(o.exterior_ms),
        storefront_ms: ms(o.storefront_ms),
        click_ms: ms(o.click_ms),
        click_to_ready_ms: ms(o.click_to_ready_ms),
        warmup_ms: ms(o.warmup_ms),
        precompile_ms: ms(o.precompile_ms),
        long_tasks_ms: ms(o.long_tasks_ms),
        post_gaps_ms: ms(o.post_gaps_ms),
        post_worst_gap_ms: ms(o.post_worst_gap_ms),
        post_fps: num(o.post_fps, 0, 240),
        pipelines: int(o.pipelines, 0, 100_000),
        posters: int(o.posters, 0, 100_000),
        ua: str(o.ua, 256),
        platform: str(o.platform, 40),
        platform_version: str(o.platform_version, 40),
        model: str(o.model, 60),
        gpu_vendor: str(o.gpu_vendor, 60),
        gpu_arch: str(o.gpu_arch, 60),
        gpu_device: str(o.gpu_device, 80),
        gpu_desc: str(o.gpu_desc, 120),
        cores: int(o.cores, 1, 1024),
        memory_gb: num(o.memory_gb, 0, 4096),
        screen_w: int(o.screen_w, 1, 100_000),
        screen_h: int(o.screen_h, 1, 100_000),
        dpr: num(o.dpr, 0.1, 16),
        net_type: str(o.net_type, 16),
        net_downlink: num(o.net_downlink, 0, 100_000),
    };
}
