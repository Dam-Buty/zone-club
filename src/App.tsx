import { useEffect, useState } from 'react';
import { useStore } from './store';
import { tmdb } from './services/tmdb';
import { useManagerTriggers } from './hooks/useManagerTriggers';
import { ExteriorView } from './components/exterior';
import { FilmDetailModal } from './components/videoclub/FilmDetailModal';
import { ManagerChat } from './components/manager/ManagerChat';
import { VHSPlayer } from './components/player/VHSPlayer';
import { InteriorScene } from './components/interior';
import mockFilmIds from './data/mock/films.json';

function App() {
  // Store state
  const {
    currentScene,
    setScene,
    currentAisle,
    selectedFilmId,
    selectFilm,
    films,
    setFilmsForAisle,
    isPlayerOpen,
    requestPointerLock,
  } = useStore();

  // Transition state
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Manager triggers hook
  useManagerTriggers();

  // Fetch ALL films for ALL aisles at startup
  useEffect(() => {
    const fetchAllFilms = async () => {
      const aisles = Object.keys(mockFilmIds) as Array<keyof typeof mockFilmIds>;

      for (const aisle of aisles) {
        // Skip if already cached
        if (films[aisle as keyof typeof films]?.length > 0) continue;

        const filmIds = mockFilmIds[aisle] as number[];
        if (!filmIds || filmIds.length === 0) continue;

        try {
          const fetchedFilms = await tmdb.getFilms(filmIds);
          setFilmsForAisle(aisle as any, fetchedFilms);
        } catch (error) {
          console.error(`Error fetching films for ${aisle}:`, error);
        }
      }
    };

    fetchAllFilms();
  }, [films, setFilmsForAisle]);

  // Get the selected film object - search across ALL aisles
  const selectedFilm = selectedFilmId
    ? Object.values(films).flat().find((f) => f.id === selectedFilmId) || null
    : null;

  // Handle film click from 3D scene
  const handleFilmClick = (filmId: number) => {
    selectFilm(filmId);
  };

  // Close modal and re-lock pointer
  const handleCloseModal = () => {
    selectFilm(null);
    requestPointerLock();
  };

  // Handle entering the store from exterior
  const handleEnterStore = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setScene('interior');
      setIsTransitioning(false);
    }, 100);
  };

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

      {/* Film Detail Modal */}
      <FilmDetailModal
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
