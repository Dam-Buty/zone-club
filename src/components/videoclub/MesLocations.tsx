import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { tmdb } from '../../services/tmdb';
import { RentalTimer } from '../ui/RentalTimer';
import type { Film } from '../../types';

export function MesLocations() {
  const { rentals, removeRental, openPlayer } = useStore();
  const [films, setFilms] = useState<Record<number, Film>>({});

  // Fetch film details for rentals
  useEffect(() => {
    const fetchFilms = async () => {
      const filmIds = rentals.map((r) => r.filmId).filter((id) => !films[id]);
      if (filmIds.length === 0) return;

      const fetchedFilms = await tmdb.getFilms(filmIds);
      const filmsMap = fetchedFilms.reduce((acc, film) => {
        acc[film.id] = film;
        return acc;
      }, {} as Record<number, Film>);

      setFilms((prev) => ({ ...prev, ...filmsMap }));
    };

    fetchFilms();
  }, [rentals, films]);

  // Check for expired rentals
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      rentals.forEach((rental) => {
        if (rental.expiresAt < now) {
          removeRental(rental.filmId);
        }
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [rentals, removeRental]);

  if (rentals.length === 0) {
    return (
      <div className="text-center p-12 text-white/50">
        <p>Aucune location en cours</p>
        <p className="text-sm mt-2">Parcours les rayons et loue des films !</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="font-display text-neon-cyan text-glow-cyan mb-6">Mes Locations</h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
        {rentals.map((rental) => {
          const film = films[rental.filmId];
          return (
            <div key={rental.filmId} className="flex flex-col gap-2">
              <div
                className="aspect-[2/3] bg-cover bg-center bg-card-bg rounded cursor-pointer relative overflow-hidden border-2 border-transparent transition-all hover:border-neon-pink hover:scale-[1.02] group"
                style={{
                  backgroundImage: film
                    ? `url(${tmdb.posterUrl(film.poster_path, 'w342')})`
                    : undefined,
                }}
                onClick={() => openPlayer(rental.filmId)}
              >
                <div className="absolute inset-0 bg-black/60 flex justify-center items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-5xl text-neon-pink text-glow-pink">▶</span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                  {film?.title || 'Chargement...'}
                </span>
                <RentalTimer expiresAt={rental.expiresAt} compact />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
