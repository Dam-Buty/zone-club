import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Film } from '../../types';
import { searchFilms } from '../../utils/minitelSearch';
import { KioskPoster } from './KioskBrowse';
import { releaseYear, tabLabel } from './kiosk-logic';
import styles from './KioskView.module.css';

// Recherche par titre : la même recherche que le Minitel (insensible à la casse et aux accents,
// dix résultats au plus), recalculée à chaque frappe. Le champ est en haut de l'écran, hors de
// portée du clavier virtuel.

interface KioskSearchProps {
  /** Tout le catalogue, sans doublon. */
  films: Film[];
  onPick: (film: Film) => void;
  onBack: () => void;
}

export function KioskSearch({ films, onPick, onBack }: KioskSearchProps) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchFilms(films, query), [films, query]);
  const typed = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // « Entrée » ne recharge pas la page : elle range seulement le clavier virtuel.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    inputRef.current?.blur();
  };

  return (
    <div className={styles.kSearchPane}>
      <button type="button" className={styles.kAuthBack} onClick={onBack}>
        ◀ rayons
      </button>

      <form noValidate onSubmit={submit}>
        <label className={styles.kField} htmlFor={fieldId}>
          <span className={styles.kFieldLabel}>Titre du film</span>
          <input
            ref={inputRef}
            id={fieldId}
            className={styles.kInput}
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      </form>

      <div className={styles.kSearchResults} role="list" aria-live="polite">
        {typed === '' && <p className={styles.kSearchHint}>Tapez le début d'un titre.</p>}
        {typed !== '' && results.length === 0 && (
          <p className={styles.kSearchHint}>Aucun film ne correspond à « {typed} ».</p>
        )}
        {results.map((film) => (
          <button key={film.id} type="button" role="listitem" className={styles.kSearchRow} onClick={() => onPick(film)}>
            <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />
            <span className={styles.kSearchText}>
              <span className={styles.kSearchTitle}>{film.title}</span>
              <span className={styles.kSearchMeta}>
                {releaseYear(film)} · {tabLabel(film.aisle)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
