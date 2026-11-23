// Borne 24/7 — l'écran d'accueil : ce que la borne affiche tant que personne ne l'a touchée.
//
// Décision de Rusmir du 23/11/2026 : vue de la rue, la borne ne doit pas montrer la fiche d'un film déjà choisi, mais
// un écran par défaut qui donne envie de la toucher — le nom du vidéoclub (« Club LaZone », en vert, dans une police
// d'ordinateur des années 90), les nouveautés qui défilent, et une invitation à toucher l'écran.
import { useEffect, useMemo, useState } from 'react';
import type { Film } from '../../types';
import { posterSrc } from './kiosk-logic';
import { yearOf } from './kiosk-distribution-logic';
import styles from './KioskWelcome.module.css';

/** Durée d'affichage d'une nouveauté au centre. */
export const WELCOME_STEP_MS = 3200;
/** Nombre de nouveautés qui tournent. */
export const WELCOME_FILMS = 10;

/** Places autour du centre : −2 et 2 sont hors champ, elles servent à l'entrée et à la sortie. */
const SLOTS = [-2, -1, 0, 1, 2] as const;

interface KioskWelcomeProps {
  /** Les nouveautés (ou le premier rayon garni), dans l'ordre du catalogue. */
  films: Film[];
  /** Le geste retour ne quitte pas la borne : « Quitter » s'éclaire pour le rappeler. */
  hint: boolean;
  onEnter: () => void;
  onQuit: () => void;
}

export function KioskWelcome({ films, hint, onEnter, onQuit }: KioskWelcomeProps) {
  const list = useMemo(() => films.filter((film) => film.poster_path).slice(0, WELCOME_FILMS), [films]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (list.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), WELCOME_STEP_MS);
    return () => window.clearInterval(timer);
  }, [list.length]);

  const at = (offset: number) => list[(((index + offset) % list.length) + list.length) % list.length];
  const centre = list.length > 0 ? at(0) : null;
  const year = centre ? yearOf(centre.release_date) : null;

  return (
    <div className={styles.welcome} data-testid="borne-accueil">
      {/* Tout l'écran est le bouton : on touche n'importe où. « Quitter » est posé par-dessus. */}
      <button type="button" className={styles.enter} onClick={onEnter} aria-label="Toucher l'écran pour louer une K7" />

      <div className={styles.top}>
        <button type="button" className={`${styles.quit} ${hint ? styles.quitHint : ''}`} onClick={onQuit}>
          Quitter
        </button>
      </div>

      <div className={styles.term} aria-hidden="true">
        <div className={styles.name}>
          Club LaZone<i className={styles.cursor} />
        </div>
        <div className={styles.termSub}>VIDEOCLUB · LOCATION DE K7 · 24H/24</div>
      </div>

      <div className={styles.news} aria-hidden="true">
        <div className={styles.newsTitle}>Les nouveautés</div>
        <div className={styles.stage}>
          {list.length >= 5
            ? SLOTS.map((slot) => {
                const film = at(slot);
                return <img key={film.id} className={styles.poster} data-slot={slot} src={posterSrc(film, 'w342') ?? undefined} alt="" decoding="async" draggable={false} />;
              })
            : centre && <img className={styles.poster} data-slot={0} src={posterSrc(centre, 'w342') ?? undefined} alt="" decoding="async" draggable={false} />}
        </div>
        <div className={styles.caption}>
          {centre ? centre.title : ''}
          {year !== null && <small>{year}</small>}
        </div>
      </div>

      <div className={styles.cta} aria-hidden="true">
        {/* Le doigt qui touche : un point et ses deux ondes. */}
        <svg className={styles.ctaHand} viewBox="0 0 26 26">
          <circle cx="13" cy="13" r="3.4" fill="currentColor" stroke="none" />
          <circle cx="13" cy="13" r="7.4" />
          <circle cx="13" cy="13" r="11.4" opacity="0.55" />
        </svg>
        <span>
          Touchez l'écran
          <small>pour louer une K7</small>
        </span>
      </div>

    </div>
  );
}
