// Mesure de terrain de l'entrée dans la boutique.
//
// Un Mac de développement ne dit rien du téléphone d'un visiteur : sur un Pixel 9a la même
// version met plus de 20 s là où le Mac en met 5 en visite de retour. Ce module chronomètre
// donc l'entrée chez chaque visiteur et tient à jour UNE ligne par chargement de page via
// /api/perf (table client_perf_runs). Anonyme : des durées et du matériel, rien qui identifie
// quelqu'un.
//
// La ligne est envoyée par étapes, pendant que la page est vivante : devanture vue → clic →
// scène prête → 10 s plus tard. Un visiteur qui part en route laisse donc sa ligne à la
// dernière étape atteinte. Surtout ne pas remplacer ça par un envoi au départ de la page
// (pagehide) : sous le contrôle du service worker, Chrome accepte l'envoi et ne l'émet pas
// (mesuré : 0 sur 5 arrivés, contre 5 sur 5 sans service worker).
//
// Il observe l'application de l'extérieur — le DOM, le store, les messages `[WARMUP…]` du
// préchauffage — au lieu d'être appelé par elle. C'est délibéré : il doit donner les mêmes
// chiffres sur toutes les versions à comparer, sans dépendre de leur code interne.

import { useStore } from '../store';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'inconnu';
const SEEN_KEY = 'zc-perf-build';
const ENTER_BUTTON = 'button[aria-label="Entrer dans le vidéoclub"]';
// Fenêtre d'observation après « scène prête » : c'est là que se voient les gels résiduels.
const POST_READY_WINDOW_MS = 10_000;
const GAP_THRESHOLD_MS = 50;

type Outcome = 'ready' | 'warmup_max' | 'no_webgpu' | 'abandoned' | 'no_entry';

interface NavigatorExtras {
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
    getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }>;
  };
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number };
  gpu?: { requestAdapter: () => Promise<{ info?: { vendor?: string; architecture?: string; device?: string; description?: string } } | null> };
}

function enabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV === 'production') return true;
  // En développement, uniquement sur demande explicite (?perf=1) : sinon chaque rechargement
  // à chaud ajouterait une ligne à la base locale.
  return new URLSearchParams(window.location.search).has('perf');
}

function start(): void {
  const nav = navigator as Navigator & NavigatorExtras;
  const run: Record<string, string | number | null> = {
    // Tirée au hasard à chaque chargement, jamais stockée : relie les envois de cette entrée.
    run_key: Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''),
    build: BUILD,
    automated: navigator.webdriver ? 1 : 0,
    first_visit: 1,
    is_mobile: window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches ? 1 : 0,
    ua: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    memory_gb: nav.deviceMemory ?? null,
    screen_w: window.screen.width,
    screen_h: window.screen.height,
    dpr: window.devicePixelRatio,
    net_type: nav.connection?.effectiveType ?? null,
    net_downlink: nav.connection?.downlink ?? null,
  };
  try {
    run.first_visit = window.localStorage.getItem(SEEN_KEY) === BUILD ? 0 : 1;
  } catch {
    // Stockage indisponible (navigation privée stricte) : on laisse « première visite ».
  }

  let finished = false;
  let stage: Outcome = 'no_entry';
  let clickAt: number | null = null;
  let readyAt: number | null = null;
  let warmupMax = false;
  const longTasks: Array<[number, number]> = [];

  // Modèle d'appareil et version du système, quand le navigateur les expose (Chrome Android).
  nav.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion'])
    .then((v) => {
      if (v.model) run.model = v.model;
      if (v.platformVersion) run.platform_version = v.platformVersion;
    })
    .catch(() => {});

  const readGpu = () => {
    nav.gpu?.requestAdapter()
      .then((adapter) => {
        const info = adapter?.info;
        if (!info) return;
        run.gpu_vendor = info.vendor || null;
        run.gpu_arch = info.architecture || null;
        run.gpu_device = info.device || null;
        run.gpu_desc = info.description || null;
        // Le GPU est ce qu'on veut le plus savoir d'un visiteur qui abandonne : on complète
        // sa ligne dès que l'information arrive, sans attendre l'étape suivante.
        flush(stage);
      })
      .catch(() => {});
  };

  /** Envoie l'état courant de la passe. Appelé à chaque étape ; le serveur met la ligne à jour. */
  const flush = (outcome: Outcome) => {
    if (finished) return;
    stage = outcome;
    run.outcome = outcome;
    const w = window as unknown as { __THREE__?: string; __rpCount?: () => number; __posterProgress?: { total: number } };
    run.three = w.__THREE__ ?? null;
    run.pipelines = typeof w.__rpCount === 'function' ? w.__rpCount() : null;
    run.posters = w.__posterProgress?.total ?? null;
    if (clickAt !== null) {
      run.click_ms = Math.round(clickAt);
      const end = readyAt ?? performance.now();
      run.long_tasks_ms = Math.round(longTasks.filter(([t]) => t >= clickAt! && t < end).reduce((s, [, d]) => s + d, 0));
    }
    if (clickAt !== null && readyAt !== null) run.click_to_ready_ms = Math.round(readyAt - clickAt);
    try {
      if (outcome === 'ready' || outcome === 'warmup_max') window.localStorage.setItem(SEEN_KEY, BUILD);
    } catch {
      // Stockage indisponible : la visite suivante sera comptée « première », tant pis.
    }
    try {
      // Corps en texte brut : requête « simple », la route lit le texte et le parse elle-même.
      navigator.sendBeacon('/api/perf', JSON.stringify(run));
    } catch {
      // Une mesure perdue n'est pas une erreur pour le visiteur.
    }
  };

  // Le préchauffage annonce sa durée par console.warn : on lit ces messages au passage.
  const originalWarn = console.warn;
  console.warn = function (...args: unknown[]) {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('[WARMUP')) {
      const ms = Number((first.match(/(\d+)ms/) || [])[1]);
      // Seuls les messages de FIN de préchauffage donnent sa durée. Les autres `[WARMUP…]`
      // (étapes intermédiaires, comme la précompilation par petits lots derrière la devanture)
      // portent aussi un « …ms » : les prendre pour la durée totale fausserait la ligne.
      if (Number.isFinite(ms)) {
        if (first.startsWith('[WARMUP-PRECOMPILE')) run.precompile_ms = ms;
        else if (first.startsWith('[WARMUP-PIPE-STABLE') || first.startsWith('[WARMUP-MAX')) run.warmup_ms = ms;
      }
      if (first.startsWith('[WARMUP-MAX')) warmupMax = true;
    }
    return originalWarn.apply(console, args as []);
  };

  if (!nav.gpu) {
    // Pas de WebGPU : le visiteur voit l'écran d'excuses. C'est une mesure en soi.
    flush('no_webgpu');
    finished = true;
    console.warn = originalWarn;
    return;
  }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push([e.startTime, e.duration]);
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // Safari ne connaît pas « longtask ».
  }

  // Devanture : présence du bouton d'entrée, puis rideau levé quand la version en a un.
  // Première étape envoyée : « devanture vue, pas encore entré ».
  let exteriorFlushed = false;
  const exteriorTimer = window.setInterval(() => {
    const now = performance.now();
    if (run.exterior_ms === undefined && document.querySelector(ENTER_BUTTON)) {
      run.exterior_ms = Math.round(now);
    }
    const curtain = document.querySelector('[class*="curtain"]');
    if (run.storefront_ms === undefined && curtain && getComputedStyle(curtain).opacity === '0') {
      run.storefront_ms = Math.round(now);
    }
    // On attend le rideau s'il existe ; sinon (version sans rideau) 3 s après le bouton.
    const exteriorMs = typeof run.exterior_ms === 'number' ? run.exterior_ms : null;
    if (!exteriorFlushed && clickAt === null && exteriorMs !== null
        && (run.storefront_ms !== undefined || now - exteriorMs > 3000)) {
      exteriorFlushed = true;
      flush('no_entry');
    }
    if (clickAt !== null || exteriorFlushed) window.clearInterval(exteriorTimer);
  }, 100);

  document.addEventListener('click', (e) => {
    if (clickAt !== null) return;
    const target = e.target as Element | null;
    if (target?.closest?.(ENTER_BUTTON)) {
      clickAt = performance.now();
      // Deuxième étape : « a cliqué ». Reste telle quelle si la scène n'est jamais prête.
      flush('abandoned');
      readGpu();
    }
  }, true);

  const observePostReady = () => {
    const t0 = performance.now();
    let last = t0;
    let frames = 0;
    let gaps = 0;
    let worst = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      frames++;
      if (dt > GAP_THRESHOLD_MS) {
        gaps += dt;
        if (dt > worst) worst = dt;
      }
      if (now - t0 < POST_READY_WINDOW_MS) {
        requestAnimationFrame(tick);
        return;
      }
      run.post_gaps_ms = Math.round(gaps);
      run.post_worst_gap_ms = Math.round(worst);
      run.post_fps = Math.round((frames / ((now - t0) / 1000)) * 10) / 10;
      // Dernière étape : la ligne est complète, on rend console.warn.
      flush(warmupMax ? 'warmup_max' : 'ready');
      finished = true;
      console.warn = originalWarn;
    };
    requestAnimationFrame(tick);
  };

  // Entrée sans clic sur la devanture (lien d'une notification). ⚠️ « intérieur » dans le store
  // ne suffit pas : chez un visiteur déjà venu, la scène persistée est restaurée « intérieur »
  // au démarrage puis ramenée à la devanture par App. On ne retient donc cet instant que si
  // la scène y est encore un peu plus tard, et on l'oublie dès qu'elle repasse à l'extérieur.
  let interiorAt: number | null = null;
  let interiorTimer = 0;
  const unsubscribe = useStore.subscribe((state) => {
    if (state.currentScene !== 'interior') {
      interiorAt = null;
      window.clearTimeout(interiorTimer);
      return;
    }
    if (clickAt === null && interiorAt === null) {
      interiorAt = performance.now();
      interiorTimer = window.setTimeout(() => {
        if (clickAt === null && interiorAt !== null) {
          clickAt = interiorAt;
          flush('abandoned');
          readGpu();
        }
      }, 1500);
    }
    if (state.isSceneReady && readyAt === null) {
      if (clickAt === null) clickAt = interiorAt ?? performance.now();
      window.clearTimeout(interiorTimer);
      readyAt = performance.now();
      unsubscribe();
      // Troisième étape : « scène prête », envoyée tout de suite — les 10 s d'observation
      // qui suivent ne doivent pas faire perdre l'entrée de quelqu'un qui repart aussitôt.
      flush(warmupMax ? 'warmup_max' : 'ready');
      observePostReady();
    }
  });
}

if (enabled()) start();

export {};
