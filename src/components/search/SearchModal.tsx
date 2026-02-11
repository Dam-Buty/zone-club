import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { tmdb, type TMDBSearchResult } from '../../services/tmdb';
import { useStore } from '../../store';
import api from '../../api';
import styles from './SearchModal.module.css';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { isAuthenticated } = useStore();

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await tmdb.search(query);
        setResults(response.results.slice(0, 10));
      } catch (err) {
        setError('Erreur lors de la recherche');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  // Load user's existing requests
  useEffect(() => {
    if (isOpen && isAuthenticated) {
      api.filmRequests.getAll().then((requests) => {
        setRequestedIds(new Set(requests.map((r) => r.tmdb_id)));
      }).catch(console.error);
    }
  }, [isOpen, isAuthenticated]);

  const handleRequest = useCallback(async (film: TMDBSearchResult) => {
    if (!isAuthenticated) {
      setError('Vous devez etre connecte pour demander un film');
      return;
    }

    setRequesting(film.id);
    setError(null);
    setSuccess(null);

    try {
      await api.filmRequests.create({
        tmdb_id: film.id,
        title: film.title,
        poster_url: film.poster_path ? tmdb.posterUrl(film.poster_path, 'w342') : null,
      });
      setRequestedIds((prev) => new Set([...prev, film.id]));
      setSuccess(`"${film.title}" a ete demande !`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la demande');
    } finally {
      setRequesting(null);
    }
  }, [isAuthenticated]);

  const handleClose = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
    setSuccess(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const content = (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          RECHERCHER UN FILM
          <span className={styles.cursor} />
        </div>

        <div className={styles.searchBox}>
          <input
            type="text"
            className={styles.input}
            placeholder="Entrez le titre du film..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loading && <div className={styles.loader}>RECHERCHE...</div>}
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <div className={styles.results}>
          {results.length === 0 && query && !loading && (
            <div className={styles.empty}>Aucun resultat trouve</div>
          )}

          {results.map((film) => (
            <div key={film.id} className={styles.resultItem}>
              <div className={styles.poster}>
                {film.poster_path ? (
                  <img
                    src={tmdb.posterUrl(film.poster_path, 'w342')}
                    alt={film.title}
                  />
                ) : (
                  <div className={styles.noPoster}>?</div>
                )}
              </div>
              <div className={styles.info}>
                <div className={styles.title}>{film.title}</div>
                <div className={styles.meta}>
                  {film.release_date ? new Date(film.release_date).getFullYear() : 'N/A'}
                  {film.vote_average > 0 && (
                    <span className={styles.rating}>
                      <span className={styles.star}>★</span> {film.vote_average.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className={styles.overview}>
                  {film.overview?.substring(0, 150) || 'Aucun synopsis disponible'}
                  {film.overview && film.overview.length > 150 && '...'}
                </div>
              </div>
              <div className={styles.actions}>
                {requestedIds.has(film.id) ? (
                  <span className={styles.requested}>DEMANDE</span>
                ) : (
                  <button
                    className={styles.requestButton}
                    onClick={() => handleRequest(film)}
                    disabled={requesting === film.id}
                  >
                    {requesting === film.id ? '...' : 'DEMANDER'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          [ESC] Fermer | Recherche via TMDB
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
