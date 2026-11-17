import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import type { Film } from '../../types';
import {
  allFilms,
  filmsForTab,
  firstNonEmptyTab,
  formatRuntime,
  posterSrc,
  releaseYear,
  synopsisText,
  tabLabel,
  tabPages,
  titleScale,
  versionLabel,
  type KioskSort,
  type KioskTab,
} from './kiosk-logic';
import styles from './KioskBrowse.module.css';

// Parcours des films : la colonne des rayons, la fiche du film affiché, les deux boutons et la
// bande de jaquettes. Chaque bloc est posé en coordonnées de l'écran de la borne (cqw).

const TAB_PAGES = tabPages();

const SORTS: ReadonlyArray<{ id: KioskSort; label: string }> = [
  { id: 'rayon', label: 'sélection' },
  { id: 'alpha', label: 'de A à Z' },
  { id: 'date', label: 'par date' },
];

/** Une jaquette, ou une vignette du même format portant le titre si elle manque ou ne charge pas. */
export function KioskPoster({
  film,
  size,
  className,
  eager = false,
}: {
  film: Pick<Film, 'poster_path' | 'title'>;
  size: 'w185' | 'w342';
  className: string;
  eager?: boolean;
}) {
  const src = posterSrc(film, size);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className={`${className} ${styles.kPosterFallback}`}>{film.title}</span>;
  }
  return (
    <img
      className={className}
      src={src}
      alt={film.title}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

interface KioskBrowseProps {
  /** Le film affiché sur la fiche. */
  selectedId: number | null;
  /** Versions jouables du film affiché ; `null` tant qu'on ne les connaît pas. */
  versions: { vf: boolean; vo: boolean } | null;
  /** Générique court du film affiché (creditsLine) ; `null` tant qu'on ne le connaît pas. */
  credits: { by: string | null; cast: string | null } | null;
  onSelect: (film: Film) => void;
  onSearch: () => void;
  /** Rend le bouton d'action de la fiche pour le film affiché. */
  actionSlot: (film: Film) => ReactNode;
  /** Onglet à l'arrivée (retour de la recherche) ; par défaut le premier rayon garni. */
  initialTab?: KioskTab;
}

export function KioskBrowse({ selectedId, versions, credits, onSelect, onSearch, actionSlot, initialTab }: KioskBrowseProps) {
  const films = useStore((state) => state.films);
  const [tab, setTab] = useState<KioskTab>(() => initialTab ?? firstNonEmptyTab(films));
  const [sort, setSort] = useState<KioskSort>('rayon');
  const [page, setPage] = useState(() => Math.max(0, TAB_PAGES.findIndex((p) => p.includes(tab))));
  const railRef = useRef<HTMLDivElement>(null);

  const film = useMemo(() => allFilms(films).find((f) => f.id === selectedId) ?? null, [films, selectedId]);
  const list = useMemo(() => filmsForTab(films, tab, sort), [films, tab, sort]);

  // Changer de rayon ou de tri ramène la bande à son début.
  useEffect(() => {
    if (railRef.current) railRef.current.scrollLeft = 0;
  }, [tab, sort]);

  // À l'arrivée (retour de la recherche), la jaquette du film affiché est amenée dans la bande.
  useEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (rail && current) rail.scrollLeft = current.offsetLeft - rail.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2;
  }, []);

  const scrollRail = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' });
  };

  if (!film) return null;

  return (
    <>
      {/* Rayons : sept par page, le huitième bouton passe à l'autre page */}
      <div className={styles.kSide}>
        {(TAB_PAGES[page] ?? TAB_PAGES[0]).map((id) => (
          <button
            key={id}
            type="button"
            className={`${styles.kTab} ${id === tab ? styles.kTabOn : ''}`}
            aria-pressed={id === tab}
            onClick={() => setTab(id)}
          >
            {tabLabel(id)}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.kTab} ${styles.kTabMore}`}
          aria-label="Afficher les autres rayons"
          onClick={() => setPage((p) => (p + 1) % TAB_PAGES.length)}
        >
          Suite
        </button>
      </div>

      {/* Fiche du film : le clap, avec le titre au bas de l'ardoise comme sur la référence */}
      <div className={styles.kCard}>
        <div className={styles.kClap} />
        <div className={styles.kSlate}>
          <dl className={styles.kMeta}>
            <dt>ANNÉE</dt>
            <dd>{releaseYear(film)}</dd>
            <dt>DURÉE</dt>
            <dd className={styles.kMetaSm}>{formatRuntime(film.runtime)}</dd>
            <dt>RAYON</dt>
            <dd className={styles.kMetaSm}>{tabLabel(film.aisle)}</dd>
            <dt>VERSION</dt>
            <dd className={styles.kMetaSm}>{versionLabel(versions)}</dd>
          </dl>
          <KioskPoster key={film.id} film={film} size="w342" className={styles.kPoster} eager />
          <div className={styles.kTitleZone}>
            <span className={styles.kTitleLabel}>TITRE</span>
            <div className={`${styles.kTitle} ${{ lg: '', md: styles.kTitleMd, sm: styles.kTitleSm }[titleScale(film.title)]}`}>
              <span>{film.title}</span>
            </div>
          </div>
        </div>
      </div>

      {/* L'essentiel du film : synopsis, puis générique (réalisation, interprètes) */}
      <div className={styles.kUnder}>
        <p className={styles.kSyn}>
          <b>En bref :</b> {synopsisText(film.overview)}
        </p>
        {credits && (
          <p className={styles.kCredits}>
            {credits.by && (
              <span className={styles.kCreditPart}>
                <b>De</b> {credits.by}
              </span>
            )}
            {credits.cast && (
              <span className={styles.kCreditPart}>
                <b>Avec</b> {credits.cast}
              </span>
            )}
          </p>
        )}
      </div>

      <button type="button" className={`${styles.kBtn} ${styles.kSearch}`} onClick={onSearch}>
        <svg className={styles.kSearchMark} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10" cy="10" r="6.5" />
          <path d="M15 15l6.5 6.5" />
        </svg>
        <span className={styles.kBtnLabel}>Recherche</span>
      </button>
      {actionSlot(film)}

      {/* Bande de jaquettes du rayon */}
      <div className={styles.kStripH}>
        <b>{tabLabel(tab)}</b>
        <div className={styles.kChips}>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.kChip} ${s.id === sort ? styles.kChipOn : ''}`}
              aria-pressed={s.id === sort}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.kStrip}>
        <button
          type="button"
          className={`${styles.kArrow} ${styles.kArrowL}`}
          aria-label="Films précédents"
          onClick={() => scrollRail(-1)}
        />
        <div className={styles.kRail} ref={railRef}>
          {list.length === 0 && <p className={styles.kRailEmpty}>Aucun film dans ce rayon.</p>}
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.kRailItem} ${item.id === film.id ? styles.kRailItemOn : ''}`}
              aria-label={item.title}
              aria-pressed={item.id === film.id}
              onClick={() => onSelect(item)}
            >
              <KioskPoster film={item} size="w185" className={styles.kRailPoster} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.kArrow} ${styles.kArrowR}`}
          aria-label="Films suivants"
          onClick={() => scrollRail(1)}
        />
      </div>
    </>
  );
}
