import { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import {
  boxStyle,
  fallbackSpineSrc,
  sheetPosition,
  spineSrc,
  wearLevel,
  type DistributionFilm,
  type Rect,
  type Suivi,
} from './kiosk-distribution-logic';
import type { DistributionFilmPlayer } from './useDistributionFilm';
import styles from './KioskDistributionFilm.module.css';

// La distribution filmée de la K7 (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 13) : la vidéo
// du robot, la même pour tous les films, et la tranche du film loué posée sur la K7 à CHAQUE image, de sa case dans la
// vitrine jusqu'à la fente. Trois calques, en composition normale : l'image de la tranche (préparée par la fabrique),
// découpée par le cache de l'image (un masque : la pince, l'autocollant, la tôle passent devant), puis l'ombre de
// l'image (un voile noir : la lumière de la scène). Aucun dessin : ni canvas, ni filtre, ni mode de fusion.
//
// Les calques sont placés par `place`, appelé par la borne à chaque image que la vidéo présente — par mutation directe
// des styles, sans rendu React. La balise <video> reste montée tant que la borne l'est ; rien ne se voit hors de la
// phase « film ». L'écran de la borne n'est pas ici : c'est le vrai, que KioskView place dans l'écran filmé.

export interface KioskDistributionFilmHandle {
  /** Place la tranche pour l'image `index` de la vidéo. */
  place: (index: number, suivi: Suivi) => void;
}

interface KioskDistributionFilmProps {
  film: DistributionFilm;
  sheets: { caches: string; ombres: string };
  player: DistributionFilmPlayer;
  /** La vidéo est à l'écran (phase « film » de la borne). */
  active: boolean;
  /** Le cadre de la vidéo, calé sur le vrai écran de la borne ; `null` hors de la phase « film ». */
  stage: Rect | null;
  /** L'écran de la borne n'a pas les proportions de l'écran filmé (PC) : un fond couvre l'écran filmé, sous le vrai. */
  letterbox: boolean;
  /** Le film dont la confirmation est ouverte ou qui vient d'être loué : sa tranche est demandée d'avance. */
  rented: { title: string; tmdbId: number | null; year: number | null } | null;
}

export const KioskDistributionFilm = forwardRef<KioskDistributionFilmHandle, KioskDistributionFilmProps>(function KioskDistributionFilm(
  { film, sheets, player, active, stage, letterbox, rented },
  ref,
) {
  const spineRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const shadeRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  // Tranche préparée introuvable pour ce film : repli (tranche neutre usée + titre écrit ici).
  const [missing, setMissing] = useState<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      place(index, suivi) {
        const spine = spineRef.current;
        const art = artRef.current;
        const shade = shadeRef.current;
        const pas = suivi.pas[index];
        if (!spine || !art || !shade || !pas) return;
        const back = backRef.current;
        if (back) {
          const screenBox = boxStyle(pas.e);
          back.style.left = screenBox.left;
          back.style.top = screenBox.top;
          back.style.width = screenBox.width;
          back.style.height = screenBox.height;
        }
        if (pas.t === null) {
          spine.style.visibility = 'hidden';
          return;
        }
        const box = boxStyle(pas.t);
        const cell = sheetPosition(index, pas.c, suivi);
        spine.style.visibility = 'visible';
        spine.style.left = box.left;
        spine.style.top = box.top;
        spine.style.width = box.width;
        spine.style.height = box.height;
        spine.style.maskSize = cell.size;
        spine.style.maskPosition = cell.position;
        spine.style.setProperty('-webkit-mask-size', cell.size);
        spine.style.setProperty('-webkit-mask-position', cell.position);
        shade.style.backgroundSize = cell.size;
        shade.style.backgroundPosition = cell.position;
        // La tranche est une image debout : couchée (à la fente), elle est tournée d'un quart de tour dans sa boîte.
        art.dataset.couchee = pas.c ? '1' : '0';
      },
    }),
    [],
  );

  const shown = active && player.phase === 'playing';
  const level = wearLevel(rented?.year);
  const prepared = rented !== null && rented.tmdbId !== null && missing !== rented.tmdbId;
  const stageStyle: CSSProperties = stage
    ? { left: stage.left, top: stage.top, width: stage.width, height: stage.height }
    : { left: 0, top: 0, width: 0, height: 0 };

  return (
    <div className={`${styles.film} ${shown ? styles.filmShown : ''}`} aria-hidden={!shown} onClick={shown ? player.skip : undefined}>
      <div className={styles.stage} style={stageStyle}>
        <video ref={player.videoRef} className={styles.video} src={player.src ?? undefined} playsInline preload="auto" width={film.largeur} height={film.hauteur} />

        {letterbox && <div ref={backRef} className={styles.screenBack} data-testid="distribution-fond-ecran" />}

        <div
          ref={spineRef}
          className={styles.spine}
          style={{ maskImage: `url(${sheets.caches})`, WebkitMaskImage: `url(${sheets.caches})`, visibility: 'hidden' }}
          data-testid="distribution-tranche"
        >
          <div ref={artRef} className={styles.spineArt} data-couchee="0">
            {/* Deux images par film, une par régime de lumière (vitrine, fente) : la feuille de style montre la bonne. */}
            {rented !== null && prepared && rented.tmdbId !== null && (
              <>
                <img className={styles.artDebout} src={spineSrc(rented.tmdbId, false)} alt={rented.title} draggable={false} onError={() => setMissing(rented.tmdbId)} />
                <img className={styles.artCouchee} src={spineSrc(rented.tmdbId, true)} alt="" draggable={false} onError={() => setMissing(rented.tmdbId)} />
              </>
            )}
            {rented !== null && !prepared && (
              <>
                <img className={styles.artDebout} src={fallbackSpineSrc(level, false)} alt="" draggable={false} />
                <img className={styles.artCouchee} src={fallbackSpineSrc(level, true)} alt="" draggable={false} />
                <span className={styles.spineTitle}>{rented.title}</span>
              </>
            )}
          </div>
          <div ref={shadeRef} className={styles.spineShade} style={{ backgroundImage: `url(${sheets.ombres})` }} />
        </div>

        {shown && player.muted && (
          <span className={styles.mutedSign} role="img" aria-label="Son coupé">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
              <path d="M16 9l5 6m0-6l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
});
