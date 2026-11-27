// Le film du retour de la K7 (spec 2026-11-26-borne-retour-k7-design, § 5) : la main du visiteur pousse la K7 dans la
// fente, l'afficheur écrit « K7 REÇUE », les rouleaux l'avalent. Une vidéo de 6 s rendue par la fabrique
// (tools/devanture-borne/retour_sorties.py), la même pour tous les films : la page pose la tranche du film rendu sur la
// K7, image par image, exactement comme pour la distribution — même lecteur (useDistributionFilm), même calque
// (KioskDistributionFilm), mêmes gardes : la borne ne se fait jamais attendre, et un appui passe la vidéo.
//
// Le film n'existe qu'en variante téléphone : sur PC (écran 2:3, la borne dans la rue), le retour se fait sans film
// jusqu'à ce que la fabrique livre la sienne.
import { useCallback, useRef, useState } from 'react';
import type { FilmFiles } from '../../utils/video-source';
import type { KioskDistributionFilmHandle } from './KioskDistributionFilm';
import type { DistributionFilm, Suivi } from './kiosk-distribution-logic';
import { useDistributionFilm, type DistributionFilmPlayer } from './useDistributionFilm';
import retourData from '../../data/kiosk-retour.json';

export const RETURN_FILM: DistributionFilm = retourData.film;
export const RETURN_SHEETS = { suivi: retourData.suivi, caches: retourData.caches, ombres: retourData.ombres };
const RETURN_FILES: FilmFiles = {
  src: RETURN_FILM.src,
  width: RETURN_FILM.largeur,
  height: RETURN_FILM.hauteur,
  av1: RETURN_FILM.av1,
  framerate: 24,
  durationMs: RETURN_FILM.dureeMs,
};

interface ReturnFilmOptions {
  /** Faux sur PC : pas de film, `play` rend la main aussitôt. */
  enabled: boolean;
  /** Place l'écran de la borne et la tranche (le calque donné) pour l'image `index` : la même règle que la distribution. */
  placeFrame: (layer: KioskDistributionFilmHandle | null, index: number, suivi: Suivi) => void;
  /** Rend à l'écran de la borne sa place exacte. */
  releaseScreen: () => void;
}

export interface ReturnFilm {
  player: DistributionFilmPlayer;
  /** À poser sur le calque KioskDistributionFilm du retour. */
  layerRef: React.RefObject<KioskDistributionFilmHandle | null>;
  /** Le film dont la K7 est (ou va être) rendue : sa tranche est demandée dès la question. */
  filmId: number | null;
  playing: boolean;
  /** La question du retour s'ouvre : la vidéo se télécharge, la tranche du film aussi. */
  want: (filmId: number) => void;
  /** Le serveur a pris la K7 : joue le film ; la promesse se tient à sa fin (ou tout de suite s'il ne peut pas partir). */
  play: (filmId: number) => Promise<void>;
}

export function useReturnFilm({ enabled, placeFrame, releaseScreen }: ReturnFilmOptions): ReturnFilm {
  const layerRef = useRef<KioskDistributionFilmHandle | null>(null);
  const [wanted, setWanted] = useState(false);
  const [filmId, setFilmId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const finishRef = useRef<(() => void) | null>(null);

  const onFrame = useCallback((index: number, suivi: Suivi) => placeFrame(layerRef.current, index, suivi), [placeFrame]);
  const onDone = useCallback(() => {
    releaseScreen();
    setPlaying(false);
    const finish = finishRef.current;
    finishRef.current = null;
    finish?.();
  }, [releaseScreen]);
  const player = useDistributionFilm({ film: RETURN_FILES, assets: RETURN_SHEETS, durationMs: RETURN_FILM.dureeMs, load: wanted && enabled, onFrame, onDone });

  const want = useCallback((id: number) => {
    setFilmId(id);
    setWanted(true);
  }, []);

  const play = useCallback(
    (id: number) =>
      new Promise<void>((resolve) => {
        setFilmId(id);
        if (!enabled) return resolve();
        finishRef.current = resolve;
        if (player.start()) {
          setPlaying(true);
          return;
        }
        // Pas téléchargée, animations réduites, suivi absent : le message de fin vient aussitôt.
        finishRef.current = null;
        releaseScreen();
        resolve();
      }),
    [enabled, player, releaseScreen],
  );

  return { player, layerRef, filmId, playing, want, play };
}
