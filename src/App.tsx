import { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from './store';
import { tmdb } from './services/tmdb';
import { useManagerTriggers } from './hooks/useManagerTriggers';
import { ExteriorView } from './components/exterior';
import { VHSCaseOverlay } from './components/videoclub/VHSCaseOverlay';
import { ManagerChat } from './components/manager/ManagerChat';
import { VHSPlayer } from './components/player/VHSPlayer';
import { InteriorScene } from './components/interior';
import { preloadPosterImage } from './utils/CassetteTextureArray';
import mockFilmIds from './data/mock/films.json';

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

function App() {
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
    return <ExteriorView onEnter={handleEnterStore} />;
  }

  // Interior view (3D scene)
  return (
    <>
      {/* 3D R3F + WebGPU Video Club Scene */}
      <InteriorScene onCassetteClick={handleFilmClick} />

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
