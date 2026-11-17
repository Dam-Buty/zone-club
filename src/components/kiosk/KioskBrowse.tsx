import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import type { Film } from '../../types';
import {
  KIOSK_FPS,
  allFilms,
  filmsForTab,
  firstNonEmptyTab,
  formatRuntime,
  posterSrc,
  railEdges,
  releaseYear,
  steppedScroll,
  synopsisText,
  tabLabel,
  tabPages,
  TITLE_W,
  TITLE_W_WITH_INFO,
  titleScale,
  versionLabel,
  type KioskTab,
} from './kiosk-logic';
import styles from './KioskBrowse.module.css';

// Parcours des films : la colonne des rayons, la fiche du film affiché, les deux boutons et la
// bande de jaquettes. Chaque bloc est posé en coordonnées de l'écran de la borne (cqw).
//
// Sous « LOUER », seulement la bande, trois K7 à la fois (Rusmir, 17/11/2026 : « il y a clairement
// trop de choses, il faut simplifier »). Plus d'intitulé de rayon — l'onglet actif le dit déjà —
// ni de boutons de tri : la bande garde l'ordre du rayon.

const TAB_PAGES = tabPages();

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

/**
 * L'ardoise du clap : année, durée, une troisième ligne (le rayon, ou le public conseillé sur la
 * fiche détaillée), versions, la jaquette et le titre. Commune au parcours et à la fiche détaillée.
 * `titleAction` : un bouton posé à droite du titre (« Fiche film » sur le parcours).
 */
export function KioskSlate({
  film,
  versions,
  third,
  poster,
  titleAction,
}: {
  film: Film;
  versions: { vf: boolean; vo: boolean } | null;
  third: { label: string; value: string };
  poster: ReactNode;
  titleAction?: ReactNode;
}) {
  const scale = titleScale(film.title, titleAction ? TITLE_W_WITH_INFO : TITLE_W);
  return (
    <div className={styles.kCard}>
      <div className={styles.kClap} />
      <div className={styles.kSlate}>
        <dl className={`${styles.kMeta} ${styles.kRise}`}>
          <dt>ANNÉE</dt>
          <dd>{releaseYear(film)}</dd>
          <dt>DURÉE</dt>
          <dd className={styles.kMetaSm}>{formatRuntime(film.runtime)}</dd>
          <dt>{third.label}</dt>
          <dd className={styles.kMetaSm}>{third.value}</dd>
          <dt>VERSION</dt>
          <dd className={styles.kMetaSm}>{versionLabel(versions)}</dd>
        </dl>
        {poster}
        <div className={styles.kTitleZone}>
          <span className={styles.kTitleLabel}>TITRE</span>
          <div className={styles.kTitleRow}>
            <div className={`${styles.kTitle} ${styles.kRise} ${{ lg: '', md: styles.kTitleMd, sm: styles.kTitleSm }[scale]}`}>
              <span>{film.title}</span>
            </div>
            {titleAction}
          </div>
        </div>
      </div>
    </div>
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
  /** Ouvre la fiche détaillée du film affiché (appui sur sa jaquette). */
  onOpenDetail: () => void;
  /** Rend le bouton d'action de la fiche pour le film affiché. */
  actionSlot: (film: Film) => ReactNode;
  /** Onglet à l'arrivée (retour de la recherche) ; par défaut le premier rayon garni. */
  initialTab?: KioskTab;
}

export function KioskBrowse({ selectedId, versions, credits, onSelect, onSearch, onOpenDetail, actionSlot, initialTab }: KioskBrowseProps) {
  const films = useStore((state) => state.films);
  const [tab, setTab] = useState<KioskTab>(() => initialTab ?? firstNonEmptyTab(films));
  const [page, setPage] = useState(() => Math.max(0, TAB_PAGES.findIndex((p) => p.includes(tab))));
  const railRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef(0);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const film = useMemo(() => allFilms(films).find((f) => f.id === selectedId) ?? null, [films, selectedId]);
  const list = useMemo(() => filmsForTab(films, tab, 'rayon'), [films, tab]);

  // Une flèche s'éteint à l'extrémité où elle ne mènerait plus nulle part. Écrit directement sur
  // les boutons, sans état React : ce suivi tourne à chaque image du défilement.
  const syncArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const { atStart, atEnd } = railEdges(rail.scrollLeft, rail.clientWidth, rail.scrollWidth);
    if (prevRef.current) prevRef.current.dataset.edge = String(atStart);
    if (nextRef.current) nextRef.current.dataset.edge = String(atEnd);
  }, []);

  // Changer de rayon ramène la bande à son début.
  useEffect(() => {
    if (railRef.current) railRef.current.scrollLeft = 0;
    syncArrows();
  }, [tab, list, syncArrows]);

  useEffect(() => {
    window.addEventListener('resize', syncArrows);
    return () => window.removeEventListener('resize', syncArrows);
  }, [syncArrows]);

  // À l'arrivée (retour de la recherche), la jaquette du film affiché est amenée dans la bande.
  useEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (rail && current) rail.scrollLeft = current.offsetLeft - rail.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2;
    syncArrows();
  }, [syncArrows]);

  // Une flèche fait passer aux trois K7 suivantes (la bande est large de trois jaquettes exactement),
  // en six images à 25 par seconde comme une borne de 2007 — pas en défilement fluide, qui trahit
  // l'écran d'aujourd'hui. Le calage sur les jaquettes est suspendu le temps du mouvement : sinon
  // chaque image intermédiaire serait ramenée sur la jaquette la plus proche.
  const scrollRail = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    window.clearInterval(turnRef.current);
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    const from = rail.scrollLeft;
    const to = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, from + direction * (rail.clientWidth + gap)));
    if (to === from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rail.scrollLeft = to;
      return;
    }
    const steps = steppedScroll(from, to, 240);
    let i = 0;
    rail.style.scrollSnapType = 'none';
    const frame = () => {
      rail.scrollLeft = steps[i++];
      if (i < steps.length) return;
      window.clearInterval(turnRef.current);
      rail.style.scrollSnapType = '';
    };
    frame();
    turnRef.current = window.setInterval(frame, 1000 / KIOSK_FPS);
  };
  useEffect(() => () => window.clearInterval(turnRef.current), []);

  if (!film) return null;

  return (
    <>
      {/* Rayons : six par page, le septième bouton (« Suite ») passe à la page suivante */}
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

      {/* Fiche du film : le clap, avec le titre au bas de l'ardoise comme sur la référence. La fiche
          détaillée s'ouvre par le bouton « (i) Fiche film », à côté du titre — un bandeau sur la
          jaquette ne se lisait pas comme un bouton (Rusmir, 17/11/2026) —, et aussi par la jaquette. */}
      <KioskSlate
        key={`ardoise-${film.id}`}
        film={film}
        versions={versions}
        third={{ label: 'RAYON', value: tabLabel(film.aisle) }}
        poster={
          <button type="button" className={`${styles.kPoster} ${styles.kRise}`} aria-label={`Fiche détaillée de ${film.title}`} onClick={onOpenDetail}>
            <KioskPoster key={film.id} film={film} size="w342" className={styles.kPosterFill} eager />
          </button>
        }
        titleAction={
          <button type="button" className={styles.kInfoBtn} aria-label="Fiche du film" onClick={onOpenDetail}>
            <span className={styles.kInfoMark} aria-hidden="true">
              i
            </span>
            Fiche
          </button>
        }
      />

      {/* L'essentiel du film : synopsis, puis générique (réalisation, interprètes) */}
      <div className={styles.kUnder} key={`en-bref-${film.id}`}>
        <p className={`${styles.kSyn} ${styles.kRise}`}>
          <b>En bref :</b> {synopsisText(film.overview)}
        </p>
        {credits && (
          <p className={`${styles.kCredits} ${styles.kRise}`}>
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

      {/* Bande de jaquettes du rayon : trois K7 à la fois */}
      <div className={styles.kStrip} role="group" aria-label={`Films du rayon ${tabLabel(tab)}`}>
        <button
          ref={prevRef}
          type="button"
          className={`${styles.kArrow} ${styles.kArrowL}`}
          aria-label="Films précédents"
          onClick={() => scrollRail(-1)}
        >
          <span className={styles.kArrowShape} aria-hidden="true" />
        </button>
        <div className={styles.kRail} ref={railRef} onScroll={syncArrows}>
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
          ref={nextRef}
          type="button"
          className={`${styles.kArrow} ${styles.kArrowR}`}
          aria-label="Films suivants"
          onClick={() => scrollRail(1)}
        >
          <span className={styles.kArrowShape} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
