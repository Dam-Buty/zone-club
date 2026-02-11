import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore } from './store';
import { tmdb } from './services/tmdb';
import { useManagerTriggers } from './hooks/useManagerTriggers';
import { VHSCaseOverlay } from './components/videoclub/VHSCaseOverlay';
import { ManagerChat } from './components/manager/ManagerChat';
import { VHSPlayer } from './components/player/VHSPlayer';
import { preloadPosterImage } from './utils/CassetteTextureArray';
import mockFilmIds from './data/mock/films.json';

// Lazy-load WebGPU-dependent components so they don't crash browsers without support
const ExteriorView = lazy(() => import('./components/exterior').then(m => ({ default: m.ExteriorView })));
const InteriorScene = lazy(() => import('./components/interior').then(m => ({ default: m.InteriorScene })));

// ===== MODULE-LEVEL PREFETCH =====
// Starts TMDB fetches immediately when JS loads (before React mounts).
// Once API data arrives, preloads all poster images into the shared cache.
// By the time the user clicks "enter store", both data AND images are ready.
const _prefetchPromise = Promise.all(
  (Object.keys(mockFilmIds) as Array<keyof typeof mockFilmIds>).map(async (aisle) => {
    const filmIds = mockFilmIds[aisle] as number[];
    if (!filmIds || filmIds.length === 0) return null;
    try {
      return { aisle, films: await tmdb.getFilms(filmIds) };
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
        Utilisez Chrome, Edge ou un navigateur basé sur Chromium pour y accéder.
      </p>
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

  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Manager triggers hook
  useManagerTriggers();

  // Await the module-level prefetch and push results into the store.
  // The TMDB fetches started at JS load time — by the time the user clicks
  // "enter store", the promise is likely already resolved (0ms wait).
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    _prefetchPromise.then((results) => {
      // All resolved — set in one synchronous block (React 18 batches these)
      for (const result of results) {
        if (result) setFilmsForAisle(result.aisle as any, result.films);
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
