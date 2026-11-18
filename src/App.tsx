import { Component, useEffect, useLayoutEffect, useState, useCallback, useRef, lazy, Suspense, type ReactNode } from 'react';
import { useStore } from './store';
import { preloadPosterImage } from './utils/CassetteTextureArray';
import './utils/asset-preload'; // Side-effect import: registers the HDR/KTX2/wasm prefetch (starts once the storefront is shown)
import { afterStorefront, hasWebGPU, isInteriorPreloadOpen, pauseInteriorPreload, releaseInteriorPreload, shouldMountInterior, whileStorefront } from './utils/interior-preload-gate';
import api, { apiFilmToFilm } from './api';
import type { AisleType, Film } from './types';
import './utils/perf-beacon'; // Side-effect import: mesure de terrain de l'entrée dans la boutique (POST /api/perf)

// PWA: global ref for deferred install prompt
declare global {
  interface Window {
    __pwaPrompt?: BeforeInstallPromptEvent;
  }
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
}

// Lazy-load WebGPU-dependent components so they don't crash browsers without support
const ExteriorView = lazy(() => import('./components/exterior/ExteriorView').then(m => ({ default: m.ExteriorView })));
// Le chunk de l'intérieur (three WebGPU + toute la scène) et les useGLTF.preload de ses
// modules ne partent qu'une fois la devanture affichée — voir interior-preload-gate.ts.
const _interiorImport = new Promise<typeof import('./components/interior/InteriorScene')>((resolve, reject) => {
  afterStorefront(() => {
    import('./components/interior/InteriorScene').then(resolve, reject);
  });
});
const InteriorScene = lazy(() => _interiorImport.then(m => ({ default: m.InteriorScene })));

// Heavy overlays — none render on the initial entry screen, so we keep them
// out of the entry chunk. Suspense fallback is null because every overlay
// already renders null when its own open-state is false.
const VHSCaseOverlay = lazy(() => import('./components/videoclub/VHSCaseOverlay').then(m => ({ default: m.VHSCaseOverlay })));
const AuthModal = lazy(() => import('./components/auth/AuthModal').then(m => ({ default: m.AuthModal })));
const ManagerChat = lazy(() => import('./components/manager/ManagerChat').then(m => ({ default: m.ManagerChat })));
const BoardOverlay = lazy(() => import('./components/board/BoardOverlay'));
const VHSPlayer = lazy(() => import('./components/player/VHSPlayer').then(m => ({ default: m.VHSPlayer })));
const ActiveCastIndicator = lazy(() => import('./components/player/ActiveCastIndicator').then(m => ({ default: m.ActiveCastIndicator })));
const MinitelOverlay = lazy(() => import('./components/minitel/MinitelOverlay').then(m => ({ default: m.MinitelOverlay })));
// Borne de location : du DOM pur, aucun rendu 3D. Son code est demandé dès que la devanture est
// affichée (preloadKiosk), AVANT les fichiers du vidéoclub 3D : demandé seulement à l'appui, il
// attendait derrière eux — 14,3 s d'écran noir mesurées à 20 Mbit/s le 16/11/2026.
const loadKiosk = () => import('./components/kiosk/KioskView');
const preloadKiosk = () => { void loadKiosk().catch(() => {}); };
// Un premier échec (réseau) est retenté une fois : webpack redemande un chunk resté en échec.
const KioskView = lazy(() => loadKiosk().catch(() => loadKiosk()).then(m => ({ default: m.KioskView })));

// Preload heavy interior assets (HDR, PBR textures, GLBs) while user is on exterior/onboarding.
// These fire HTTP requests as soon as the interior chunk is in — by the time the user enters, assets are in browser cache.
_interiorImport.then(() => {
  // Module loaded — useGLTF.preload calls inside submodules (VHSCaseViewer, Manager3D) are now active.
  // Preload additional assets that drei hooks will request on mount.
  //
  // Des fetch() interruptibles, plus des <link rel="prefetch"> : un lien posé dans le <head> ne
  // se coupe pas, et ces téléchargements continuaient pendant la borne (mesuré le 16/11/2026).
  // whileStorefront leur passe le signal coupé à l'ouverture de la borne et les relance au
  // retour devant la devanture ; si le chunk arrive pendant la borne, ils attendent ce retour.
  const preloadUrls = [
    '/textures/env/indoor_night.hdr',
    '/textures/wall/color.jpg', '/textures/wall/normal.jpg', '/textures/wall/roughness.jpg', '/textures/wall/ao.jpg',
    '/textures/wood/color.jpg', '/textures/wood/normal.jpg', '/textures/wood/roughness.jpg',
    '/panneau-extincteur.png', '/exterior.webp',
    // KTX2 variants (loaded if USE_KTX2 is true in Aisle.tsx)
    '/textures/wall/color.ktx2', '/textures/wall/normal.ktx2', '/textures/wall/roughness.ktx2', '/textures/wall/ao.ktx2',
    '/textures/wood/color.ktx2', '/textures/wood/normal.ktx2', '/textures/wood/roughness.ktx2',
  ];
  whileStorefront((signal) => {
    for (const url of preloadUrls) {
      fetch(url, { cache: 'force-cache', priority: 'low', signal } as RequestInit).catch(() => {
        // Coupé par la borne, ou en échec : le composant qui en a besoin le redemandera.
      });
    }
  });
});

// ===== MODULE-LEVEL PREFETCH =====
// Starts API fetches immediately when JS loads (before React mounts).
// Once data arrives, preloads all poster images into the shared cache.
// By the time the user clicks "enter store", both data AND images are ready.
const AISLES: AisleType[] = ['nouveautes', 'action', 'aventure', 'horreur', 'comedie', 'drame', 'thriller', 'policier', 'sf', 'animation', 'classiques', 'bizarre', 'romance'];

type PrefetchResult = { aisle: AisleType; films: Film[] } | null;

const _prefetchPromise: Promise<PrefetchResult[]> = Promise.all(
  AISLES.map(async (aisle) => {
    try {
      const { films } = await api.films.getByAisle(aisle);
      return { aisle, films: films.map(apiFilmToFilm) };
    } catch {
      return null;
    }
  })
);

// As soon as API data arrives AND the storefront is shown, preload all poster images into
// the shared cache. preloadPosterImage() stores each Image in a Map<url, Promise<HTMLImageElement>>
// so CassetteTextureArray.loadPosterIntoLayer() gets them instantly (~0ms).
// The API calls themselves stay ungated: 13 small requests, nothing the storefront waits for.
_prefetchPromise.then((results) => {
  afterStorefront(() => {
    for (const result of results) {
      if (!result) continue;
      for (const film of result.films) {
        if (film.poster_path) {
          preloadPosterImage(`/api/poster/w185${film.poster_path}`);
        }
      }
    }
  });
});

const LOADING_TIPS = [
  'Louez de vrais films et regardez-les sur votre smartphone',
  'Castez vos films sur votre TV via Chromecast ou AirPlay',
  'Discutez cinema avec le gerant — il connait son catalogue',
  'Demandez conseil au gerant, il vous recommandera des perles',
  'Laissez des critiques sur les films pour gagner des credits',
  'Chaque critique publiee = +1 credit de location gratuit',
  'Explorez les allees pour decouvrir tous les genres',
  'Regardez le tableau d\'affichage pour laisser un mot',
  'Les nouveautes sont a l\'entree du videoclub',
]

function LoadingDots() {
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setDots(d => (d % 3) + 1), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <span style={{ display: 'inline-block', width: '1.5em', textAlign: 'left' }}>
      {'.'.repeat(dots)}
    </span>
  )
}

function LoadingTips() {
  // Shuffle tips once on mount (Fisher-Yates). Initialiseur paresseux de useState plutôt que
  // l'écriture d'une ref pendant le rendu : même résultat, mais le rendu reste pur.
  const [order] = useState<number[]>(() => {
    const shuffled = [...LOADING_TIPS.keys()]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  })

  const [pos, setPos] = useState(0)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const safetyRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    if (phase === 'in') {
      timerRef.current = setTimeout(() => setPhase('out'), 2500)
    } else if (phase === 'out') {
      safetyRef.current = setTimeout(() => {
        setPos(p => (p + 1) % LOADING_TIPS.length)
        setPhase('in')
      }, 600)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (safetyRef.current) clearTimeout(safetyRef.current)
    }
  }, [phase, pos])

  const handleTransitionEnd = useCallback(() => {
    if (phase === 'out') {
      if (safetyRef.current) clearTimeout(safetyRef.current)
      setPos(p => (p + 1) % LOADING_TIPS.length)
      setPhase('in')
    }
  }, [phase])

  return (
    <p
      onTransitionEnd={handleTransitionEnd}
      style={{
        color: '#999', fontFamily: "'Courier New', monospace",
        fontSize: 15, fontWeight: 'bold', lineHeight: 1.6,
        textAlign: 'center', maxWidth: 380,
        minHeight: 48,
        opacity: phase === 'in' ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
    >
      {LOADING_TIPS[order[pos]]}
    </p>
  )
}

// Film reel loader — pure CSS spinner
function FilmReelLoader() {
  return (
    <div style={{
      width: 80, height: 80,
      border: '3px solid #555',
      borderRadius: '50%',
      position: 'relative',
      animation: 'film-reel-spin 2s linear infinite',
    }}>
      {/* Center hub */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 16, height: 16,
        background: '#555', borderRadius: '50%',
      }} />
      {/* 8 sprocket holes */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: 12, height: 12,
          background: '#000', border: '2px solid #555',
          borderRadius: '50%',
          transform: `translate(-50%, -50%) rotate(${i * 45}deg) translateY(-26px)`,
        }} />
      ))}
    </div>
  );
}

function PWAInstallToast({ onInstall, onDismiss }: { onInstall: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', alignItems: 'center', gap: 12,
      background: 'rgba(0, 0, 0, 0.85)', border: '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius: 8, padding: '10px 16px',
      fontFamily: "'Courier New', monospace", fontSize: 13, color: '#ccc',
      backdropFilter: 'blur(8px)',
    }}>
      <span>Installer Zone Club</span>
      <button
        onClick={onInstall}
        style={{
          background: '#ff2d95', color: '#fff', border: 'none', borderRadius: 4,
          padding: '5px 12px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        Installer
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent', color: '#888', border: 'none',
          fontSize: 16, cursor: 'pointer', padding: '0 4px',
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ===== Borne : ouverture et panne =====
// Même fond que la borne (KioskView.module.css, .root) : le passage de l'un à l'autre ne se voit pas.
const KIOSK_BACKDROP = 'linear-gradient(180deg, #23213a 0%, #191827 40%, #14131f 100%)';
const kioskPanelStyle = {
  position: 'fixed', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center',
  background: KIOSK_BACKDROP, color: '#d6ecff',
  fontFamily: '"Big Shoulders Display", "DIN Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  fontSize: 20, fontWeight: 600,
} as const;
const kioskPanelButtonStyle = {
  padding: '12px 20px', border: '2px solid #4fc3e8', borderRadius: 8, background: '#0f6895',
  color: '#fff', font: 'inherit', fontSize: 17, cursor: 'pointer',
} as const;

/** Affiché le temps que le code de la borne arrive (connexion lente), à la place d'un écran noir. */
function KioskOpening() {
  return <div role="status" style={kioskPanelStyle}>Ouverture de la borne…</div>;
}

/**
 * Une panne de la borne (code introuvable hors connexion, erreur de rendu) ne doit pas faire
 * tomber toute l'application sur un écran noir : elle est dite, avec deux sorties.
 */
class KioskBoundary extends Component<{ onLeave: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[borne] ouverture ou rendu en échec', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={kioskPanelStyle}>
        <span>La borne n&apos;a pas pu s&apos;ouvrir.</span>
        <span style={{ fontSize: 16, fontWeight: 500 }}>Vérifiez votre connexion, puis rechargez la page.</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" style={kioskPanelButtonStyle} onClick={() => window.location.reload()}>
            Recharger la page
          </button>
          <button type="button" style={kioskPanelButtonStyle} onClick={this.props.onLeave}>
            Retour à la devanture
          </button>
        </div>
      </div>
    );
  }
}

function Reticule() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);
  if (!locked) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 6, height: 6,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.5)',
        boxShadow: '0 0 4px rgba(0, 0, 0, 0.5)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}

function App() {
  // WebGPU support flag — captured once at first render (`navigator.gpu` is stable for a
  // session). Sans WebGPU le site reste ouvert : la devanture s'affiche, la borne loue et lit
  // les films ; seule la porte du vidéoclub 3D est fermée (elle explique pourquoi).
  const [webgpuSupported] = useState(() => hasWebGPU());

  // Individual selectors to avoid re-rendering on unrelated store changes (e.g. targetedFilm, pointerLock)
  const currentScene = useStore(state => state.currentScene);
  const setScene = useStore(state => state.setScene);
  const selectedFilmId = useStore(state => state.selectedFilmId);
  const selectFilm = useStore(state => state.selectFilm);
  const films = useStore(state => state.films);
  const setFilmsForAisle = useStore(state => state.setFilmsForAisle);
  const isPlayerOpen = useStore(state => state.isPlayerOpen);
  const requestPointerLock = useStore(state => state.requestPointerLock);
  const isSceneReady = useStore(state => state.isSceneReady);
  const showPostTutorialAuth = useStore(state => state.showPostTutorialAuth);
  const dismissPostTutorialAuth = useStore(state => state.dismissPostTutorialAuth);
  const showInstallPrompt = useStore(state => state.showInstallPrompt);
  const setShowInstallPrompt = useStore(state => state.setShowInstallPrompt);
  const dismissInstallPrompt = useStore(state => state.dismissInstallPrompt);

  // Register service worker (production only) + capture install prompt
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        // À l'installation, le service worker précharge les assets 3D : lui aussi attend la devanture.
        afterStorefront(() => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
      } else {
        // Dev mode: unregister any stale SW to prevent cached old JS bundles
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(reg => reg.unregister());
        });
      }
    }
    const handler = (e: Event) => {
      e.preventDefault();
      window.__pwaPrompt = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Loading screen: minimum 2s visible + fade-out
  const [loadingDismissed, setLoadingDismissed] = useState(false);
  const [loaderCanFade, setLoaderCanFade] = useState(false);
  const loaderMountRef = useRef(0);
  // Fondu depuis le noir quand on entre dans une scène déjà préchauffée.
  const [entryFade, setEntryFade] = useState(false);
  // Scène intérieure montée, cachée, pendant que le visiteur regarde la devanture.
  const [interiorPrewarm, setInteriorPrewarm] = useState(false);
  useEffect(() => {
    // La vanne s'ouvre quand la devanture est affichée ; on laisse encore son fondu
    // d'apparition (0,8 s) se terminer avant de demander quoi que ce soit au GPU.
    // Vaut aussi au RETOUR de la borne : la vanne s'est refermée à son ouverture, et la scène
    // 3D ne se remonte qu'une fois la devanture de nouveau à l'écran — pas dans le même rendu.
    if (currentScene !== 'exterior') return;
    let cancelled = false;
    let timer = 0;
    afterStorefront(() => {
      // La vanne est relue à l'échéance : un appui sur la borne dans ces 0,8 s l'a refermée, et la
      // devanture reste montée le temps du zoom — la scène 3D ne doit pas se monter dessous.
      if (!cancelled) timer = window.setTimeout(() => { if (isInteriorPreloadOpen()) setInteriorPrewarm(true); }, 800);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentScene]);
  useEffect(() => {
    // Pre-load the Google Cast SDK as soon as the user enters the videoclub
    // so it is ready by the time they open the player. Previously the SDK
    // only started loading when VHSPlayer mounted (lazy import), which
    // created a 1-2 s race window where clicking the Cast button silently
    // hit the !isReady branch. Idempotent + module-level promise.
    // La borne ouvre le même lecteur : même préchargement.
    if (currentScene === 'interior' || currentScene === 'kiosk') {
      import('./hooks/useGoogleCast').then(m => m.preloadCastSdk()).catch(() => {});
    }
  }, [currentScene]);
  // Filet de sécurité : entrer dans la boutique ouvre la vanne des préchargements de
  // l'intérieur, au cas où l'on arriverait ici sans être passé par la devanture (lien
  // « castEnded » d'une notification). Idempotent.
  useEffect(() => {
    if (currentScene === 'interior') releaseInteriorPreload();
  }, [currentScene]);
  // Écran de chargement. Trois cas à l'entrée dans la boutique :
  //  - scène déjà préchauffée derrière la devanture → pas d'écran du tout, un fondu depuis le noir ;
  //  - préchauffage encore en cours → l'écran s'affiche, 2 s au minimum, puis se fond ;
  //  - retour à la devanture → tout est remis à zéro.
  // useLayoutEffect : l'état doit être posé avant la première image de l'intérieur, sinon
  // l'écran de chargement clignote une image sur une scène pourtant prête.
  useLayoutEffect(() => {
    if (currentScene !== 'interior') {
      loaderMountRef.current = 0;
      setLoadingDismissed(false);
      setLoaderCanFade(false);
      return;
    }
    const justEntered = loaderMountRef.current === 0;
    if (justEntered) loaderMountRef.current = Date.now();
    if (!isSceneReady) {
      setLoadingDismissed(false);
      setLoaderCanFade(false);
      return;
    }
    if (justEntered) {
      setLoadingDismissed(true);
      setEntryFade(true);
      const t = setTimeout(() => setEntryFade(false), 700);
      return () => clearTimeout(t);
    }
    const elapsed = Date.now() - loaderMountRef.current;
    const remaining = Math.max(0, 2000 - elapsed);
    const t1 = setTimeout(() => setLoaderCanFade(true), remaining);
    const t2 = setTimeout(() => setLoadingDismissed(true), remaining + 1400); // fade + buffer
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [currentScene, isSceneReady]);


  // Restore auth session from cookie on mount + load board notes
  const fetchMe = useStore(state => state.fetchMe);
  const fetchBoardNotes = useStore(state => state.fetchBoardNotes);
  const openPlayer = useStore(state => state.openPlayer);
  useEffect(() => {
    fetchMe();
    fetchBoardNotes();
  }, [fetchMe, fetchBoardNotes]);

  // L3 warmup screen: force ExteriorView at fresh page load even if persisted
  // currentScene === 'interior'. Acts as a buffer where asset-preload.ts and
  // module-level useGLTF.preload() fetches populate the cache while user reads
  // the storefront / clicks "Entrer". SessionStorage flag distinguishes a fresh
  // page load from a tab-switch (where we want to keep the user where they were).
  useEffect(() => {
    const SESSION_KEY = 'zone-club-session-active';
    const isFreshLoad = !sessionStorage.getItem(SESSION_KEY);
    if (!isFreshLoad) return;
    sessionStorage.setItem(SESSION_KEY, '1');

    // Don't override if user is being deep-linked into interior (cast notification).
    if (new URLSearchParams(window.location.search).has('castEnded')) return;

    // Vaut pour la borne comme pour l'intérieur : un chargement frais repart de la devanture.
    if (useStore.getState().currentScene !== 'exterior') {
      setScene('exterior');
    }
  }, [setScene]);

  // Sans WebGPU, l'intérieur est inatteignable : une scène 'interior' restaurée (onglet rouvert
  // après un changement de navigateur ou de réglage) ramène à la devanture.
  useEffect(() => {
    if (!webgpuSupported && currentScene === 'interior') setScene('exterior');
  }, [webgpuSupported, currentScene, setScene]);

  // ===== Deep link: ?castEnded=filmId (from push notification) =====
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const castEndedFilmId = params.get('castEnded');
    if (!castEndedFilmId) return;

    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete('castEnded');
    window.history.replaceState({}, '', url.pathname + url.search);

    const filmId = parseInt(castEndedFilmId, 10);
    if (isNaN(filmId)) return;

    // Ensure we're in interior scene and open the player for this film.
    // Sans WebGPU, c'est la borne qui porte le lecteur.
    setScene(webgpuSupported ? 'interior' : 'kiosk');
    // Delay slightly to let scene mount
    setTimeout(() => {
      openPlayer(filmId);
    }, 500);
  }, [setScene, openPlayer, webgpuSupported]);

  // Block native browser zoom (Ctrl+scroll on desktop, pinch on mobile fallback)
  useEffect(() => {
    const blockWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const blockGesture = (e: Event) => e.preventDefault();
    document.addEventListener('wheel', blockWheel, { passive: false });
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    return () => {
      document.removeEventListener('wheel', blockWheel);
      document.removeEventListener('gesturestart', blockGesture);
      document.removeEventListener('gesturechange', blockGesture);
    };
  }, []);

  // Await the module-level prefetch and push results into the store.
  // The API fetches started at JS load time — by the time the user clicks
  // "enter store", the promise is likely already resolved (0ms wait).
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    _prefetchPromise.then((results) => {
      // All resolved — set in one synchronous block (React 18 batches these)
      for (const result of results) {
        if (!result) continue;
        setFilmsForAisle(result.aisle, result.films);
      }
    });
  }, [setFilmsForAisle]);

  // Get the selected film object - search across ALL aisles
  const selectedFilm = selectedFilmId
    ? Object.values(films).flat().find((f) => f.id === selectedFilmId) || null
    : null;

  // Memoized callbacks — stable references prevent cascading re-renders to Canvas children
  const handleFilmClick = useCallback((filmId: number) => {
    selectFilm(filmId);
  }, [selectFilm]);

  const handleCloseModal = useCallback(() => {
    selectFilm(null);
    requestPointerLock();
  }, [selectFilm, requestPointerLock]);

  const handleEnterStore = useCallback(() => {
    setTimeout(() => setScene('interior'), 100);
  }, [setScene]);

  // Dès l'appui sur la borne, plus rien du vidéoclub 3D ne consomme : les téléchargements en
  // cours sont coupés (la vanne se referme) et la scène est démontée, son GPU libéré — qu'elle
  // ait été prête ou encore en préparation. Tout repart quand la devanture est de nouveau
  // affichée ; un temps de chargement à la porte, après un passage par la borne, est accepté.
  const openKiosk = useCallback(() => {
    pauseInteriorPreload();
    setInteriorPrewarm(false);
    setScene('kiosk');
  }, [setScene]);
  // Sur mobile, la devanture zoome d'abord vers l'écran de la borne : elle prévient dès l'appui,
  // pour que le GPU et les chargements soient libérés avant l'animation, pas après. `openKiosk`
  // refait la même chose à la fin du zoom (sans effet, tout est déjà libéré) puis change de scène.
  const releaseInteriorForKiosk = useCallback(() => {
    pauseInteriorPreload();
    setInteriorPrewarm(false);
  }, []);
  const leaveKiosk = useCallback(() => setScene('exterior'), [setScene]);

  const isInterior = currentScene === 'interior';
  const isKiosk = currentScene === 'kiosk';

  // La scène intérieure est montée dès que la devanture est affichée, cachée dessous, en
  // mode préchauffage : device GPU, modèles, jaquettes et shaders se préparent pendant que le
  // visiteur regarde la vitrine. À l'entrée, c'est le MÊME élément qui devient visible (même
  // place dans l'arbre, donc pas de remontage) : le travail fait n'est pas refait.
  //
  // Pendant la borne, rien de 3D n'existe : la scène est démontée (shouldMountInterior), prête
  // ou non. Sans WebGPU, elle n'est jamais montée.
  const mountInterior = shouldMountInterior({ webgpu: webgpuSupported, scene: currentScene, prewarmOpen: interiorPrewarm });

  return (
    <>
      {/* 3D R3F + WebGPU Video Club Scene */}
      {mountInterior && (
        <Suspense fallback={null}>
          <InteriorScene onCassetteClick={handleFilmClick} prewarm={!isInterior} />
        </Suspense>
      )}

      {/* Devanture — par-dessus la scène intérieure tant qu'on n'est pas entré */}
      {currentScene === 'exterior' && (
        <Suspense fallback={null}>
          <ExteriorView
            onEnter={handleEnterStore}
            onOpenKiosk={openKiosk}
            onKioskIntent={releaseInteriorForKiosk}
            onShown={preloadKiosk}
            canEnter={webgpuSupported}
          />
        </Suspense>
      )}

      {/* Borne de location — du DOM pur, avec le même lecteur et le même suivi de Cast que le
          vidéoclub. Deux Suspense : le premier chargement du lecteur (paresseux) ne doit pas
          masquer la borne le temps que son chunk arrive. */}
      {isKiosk && (
        <KioskBoundary onLeave={leaveKiosk}>
          {/* Jamais d'écran noir : tant que le code de la borne n'est pas là, son fond l'est. */}
          <Suspense fallback={<KioskOpening />}>
            <KioskView />
          </Suspense>
          <Suspense fallback={null}>
            {isPlayerOpen && <VHSPlayer />}
            <ActiveCastIndicator />
          </Suspense>
        </KioskBoundary>
      )}

      {isInterior && (<>
      {/* Entrée dans une scène déjà préchauffée : fondu depuis le noir de la devanture */}
      {entryFade && (
        <>
          <style>{`@keyframes entry-fade-out { from { opacity: 1 } to { opacity: 0 } }`}</style>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', pointerEvents: 'none', animation: 'entry-fade-out 0.6s ease forwards' }} />
        </>
      )}

      {/* FPS center reticule — visible only when pointer locked */}
      <Reticule />

      {/* Loading screen overlay — dynamic "Chargement..." top, spinner center, tips bottom */}
      {currentScene === 'interior' && !loadingDismissed && (
        <>
          <style>{`@keyframes film-reel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          <div
            role="status"
            aria-live="polite"
            aria-label="Chargement du vidéoclub"
            style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: '#000',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'space-between',
            padding: '20vh 0 calc(12vh + 10px)',
            opacity: loaderCanFade ? 0 : 1,
            transition: 'opacity 1.2s ease',
            pointerEvents: loaderCanFade ? 'none' : 'all',
          }}>
            {/* Top: dynamic "Chargement..." */}
            <p style={{
              color: '#ccc', fontFamily: "'Courier New', monospace",
              fontSize: 16, letterSpacing: 3,
              textTransform: 'uppercase',
            }}>
              Chargement en cours<LoadingDots />
            </p>

            {/* Center: spinner */}
            <FilmReelLoader />

            {/* Bottom: rotating tips */}
            <LoadingTips />
            {/* retd logo */}
            <img
              src="/retd.png"
              alt=""
              style={{
                position: 'absolute', bottom: 32, left: '50%',
                transform: 'translateX(-50%)',
                height: 96, opacity: 0.7,
              }}
            />
          </div>
        </>
      )}

      {/* Heavy overlays grouped under a single Suspense — each is lazy-loaded
          and renders null when its open-state is false, so the fallback is
          never visible to the user. Keeps the entry chunk small. */}
      <Suspense fallback={null}>
        {/* VHS Case 3D overlay (bottom bar with rental/trailer/close buttons) */}
        <VHSCaseOverlay
          film={selectedFilm}
          isOpen={selectedFilmId !== null}
          onClose={handleCloseModal}
        />

        {/* VHS Player — overlays on top of scene (scene stays mounted to preserve WebGPU state) */}
        {isPlayerOpen && <VHSPlayer />}

        {/* Floating "Now Playing on TV" chip — appears whenever a cast is
            active but the player overlay is closed (user walks around the
            videoclub while the TV plays). Tap to reopen the player and
            land directly in the remote-control panel. */}
        <Suspense fallback={null}>
          <ActiveCastIndicator />
        </Suspense>

        {/* Minitel HTML overlay — input + buttons (3D screen rendered via CanvasTexture in MinitelDisplay) */}
        <MinitelOverlay />

        {/* Manager Chat */}
        <ManagerChat />

        {/* Board overlay (sticky notes) */}
        <BoardOverlay />

        {/* Post-tutorial registration modal */}
        <AuthModal
          isOpen={showPostTutorialAuth}
          onClose={() => {
            dismissPostTutorialAuth();
            // After onboarding + registration, suggest installing the app
            if (window.__pwaPrompt) {
              setTimeout(() => setShowInstallPrompt(true), 1000);
            }
          }}
          initialMode="register"
        />
      </Suspense>

      {/* PWA install toast — shown after onboarding completion */}
      {showInstallPrompt && (
        <PWAInstallToast
          onInstall={() => {
            window.__pwaPrompt?.prompt();
            window.__pwaPrompt = undefined;
            dismissInstallPrompt();
          }}
          onDismiss={dismissInstallPrompt}
        />
      )}
      </>)}
    </>
  );
}

export default App;
