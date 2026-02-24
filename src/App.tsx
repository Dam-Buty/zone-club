import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore } from './store';
import { VHSCaseOverlay } from './components/videoclub/VHSCaseOverlay';
import { ManagerChat } from './components/manager/ManagerChat';
import { VHSPlayer } from './components/player/VHSPlayer';
import { preloadPosterImage } from './utils/CassetteTextureArray';
import api from './api';
import type { ApiFilm } from './api';
import type { AisleType, Film } from './types';

// Lazy-load WebGPU-dependent components so they don't crash browsers without support
const ExteriorView = lazy(() => import('./components/exterior/ExteriorView').then(m => ({ default: m.ExteriorView })));
const _interiorImport = import('./components/interior/InteriorScene');
const InteriorScene = lazy(() => _interiorImport.then(m => ({ default: m.InteriorScene })));

// Eagerly preload heavy interior assets (HDR, PBR textures, GLBs) while user is on exterior/onboarding.
// These fire HTTP requests immediately — by the time the user enters, assets are in browser cache.
_interiorImport.then(() => {
  // Module loaded — useGLTF.preload calls inside submodules (VHSCaseViewer, Manager3D) are now active.
  // Preload additional assets that drei hooks will request on mount:
  const preloadUrls = [
    '/textures/env/indoor_night.hdr',
    '/textures/wall/color.jpg', '/textures/wall/normal.jpg', '/textures/wall/roughness.jpg', '/textures/wall/ao.jpg',
    '/textures/wood/color.jpg', '/textures/wood/normal.jpg', '/textures/wood/roughness.jpg',
    '/panneau-extincteur.png', '/exterior.webp',
    // KTX2 variants (loaded if USE_KTX2 is true in Aisle.tsx)
    '/textures/wall/color.ktx2', '/textures/wall/normal.ktx2', '/textures/wall/roughness.ktx2', '/textures/wall/ao.ktx2',
    '/textures/wood/color.ktx2', '/textures/wood/normal.ktx2', '/textures/wood/roughness.ktx2',
  ];
  for (const url of preloadUrls) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  }
});

// ===== MODULE-LEVEL PREFETCH =====
// Starts API fetches immediately when JS loads (before React mounts).
// Once data arrives, preloads all poster images into the shared cache.
// By the time the user clicks "enter store", both data AND images are ready.
const AISLES: AisleType[] = ['nouveautes', 'action', 'horreur', 'comedie', 'drame', 'thriller', 'policier', 'sf', 'animation', 'classiques'];

function apiFilmToFilm(f: ApiFilm): Film {
  const extractPath = (url: string | null) => {
    if (!url) return null;
    const m = url.match(/\/t\/p\/\w+(\/.+)$/);
    return m ? m[1] : null;
  };

  return {
    id: f.id,
    tmdb_id: f.tmdb_id,
    title: f.title,
    overview: f.synopsis || '',
    poster_path: extractPath(f.poster_url),
    backdrop_path: extractPath(f.backdrop_url),
    release_date: f.release_year ? `${f.release_year}-01-01` : '',
    runtime: f.runtime,
    vote_average: 0, // fetched from TMDB at runtime in fetchVHSCoverData
    genres: f.genres,
    is_available: f.is_available,
    stock: f.stock ?? 2,
    active_rentals: f.active_rentals ?? 0,
  };
}

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

// As soon as API data arrives, preload all poster images into the shared cache.
// preloadPosterImage() stores each Image in a Map<url, Promise<HTMLImageElement>>
// so CassetteTextureArray.loadPosterIntoLayer() gets them instantly (~0ms).
_prefetchPromise.then((results) => {
  for (const result of results) {
    if (!result) continue;
    for (const film of result.films) {
      if (film.poster_path) {
        preloadPosterImage(`https://image.tmdb.org/t/p/w200${film.poster_path}`);
      }
    }
  }
});

function WebGPUNotSupported() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', backgroundColor: '#0a0a0a', color: '#ff2d95',
      fontFamily: 'Orbitron, sans-serif', textAlign: 'center', padding: '2rem',
    }}>
      <h1 style={{ fontSize: '2rem', textShadow: '0 0 20px #ff2d95', marginBottom: '1rem' }}>
        WebGPU non disponible
      </h1>
      <p style={{ color: '#ccc', fontFamily: 'sans-serif', maxWidth: '500px', lineHeight: 1.6 }}>
        Ce vidéoclub utilise WebGPU pour le rendu 3D.
        Utilisez une version récente de Chrome, Edge, Firefox ou Safari avec accélération matérielle activée.
        Selon le système, WebGPU peut aussi nécessiter l’activation d’options expérimentales.
      </p>
    </div>
  );
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

function App() {
  // WebGPU support check
  if (!navigator.gpu) {
    return <WebGPUNotSupported />;
  }

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

  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Loading screen: dismiss after fade-out completes
  const [loadingDismissed, setLoadingDismissed] = useState(false);
  useEffect(() => {
    if (isSceneReady) {
      const timer = setTimeout(() => setLoadingDismissed(true), 1400); // 1.2s fade + 200ms buffer
      return () => clearTimeout(timer);
    } else {
      setLoadingDismissed(false);
    }
  }, [isSceneReady]);


  // Restore auth session from cookie on mount
  const fetchMe = useStore(state => state.fetchMe);
  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

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
    setIsTransitioning(true);
    setTimeout(() => {
      setScene('interior');
      setIsTransitioning(false);
    }, 100);
  }, [setScene]);

  // Show player if open
  if (isPlayerOpen) {
    return <VHSPlayer />;
  }

  // Exterior view
  if (currentScene === 'exterior') {
    return (
      <Suspense fallback={null}>
        <ExteriorView onEnter={handleEnterStore} />
      </Suspense>
    );
  }

  // Interior view (3D scene)
  return (
    <>
      {/* 3D R3F + WebGPU Video Club Scene */}
      <Suspense fallback={null}>
        <InteriorScene onCassetteClick={handleFilmClick} />
      </Suspense>

      {/* Loading screen overlay — film reel spinner + fade out */}
      {currentScene === 'interior' && !loadingDismissed && (
        <>
          <style>{`@keyframes film-reel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: '#000',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: isSceneReady ? 0 : 1,
            transition: 'opacity 1.2s ease',
            pointerEvents: isSceneReady ? 'none' : 'all',
          }}>
            <FilmReelLoader />
            <p style={{
              color: '#ccc', fontFamily: "'Courier New', monospace",
              marginTop: 24, fontSize: 14, letterSpacing: 2,
              textTransform: 'uppercase',
            }}>
              Vidéoclub en cours de chargement
            </p>
          </div>
        </>
      )}

      {/* VHS Case 3D overlay (bottom bar with rental/trailer/close buttons) */}
      <VHSCaseOverlay
        film={selectedFilm}
        isOpen={selectedFilmId !== null}
        onClose={handleCloseModal}
      />

      {/* Manager Chat */}
      <ManagerChat />
    </>
  );
}

export default App;
