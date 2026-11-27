// Le film du retour de la K7 (spec 2026-11-26-borne-retour-k7-design, § 5) : la main du visiteur pousse la K7 dans la
// fente, l'afficheur écrit « K7 REÇUE », les rouleaux l'avalent. Une vidéo de 6 s rendue par la fabrique
// (tools/devanture-borne/retour_sorties.py), la même pour tous les films : la page pose la tranche du film rendu sur la
// K7, image par image, exactement comme pour la distribution — même lecteur (useDistributionFilm), même calque
// (KioskDistributionFilm), mêmes gardes : la borne ne se fait jamais attendre, et un appui passe la vidéo.
//
// Deux variantes, comme la distribution : celle du téléphone (borne seule, 720 × 1290) et celle du PC (la borne dans
// la rue, 1920 × 1020 — retour_pc_sorties.py), qui part du décor de la page et y revient. Une variante absente des
// données : le retour se fait sans film sur cet appareil.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { FilmFiles } from '../../utils/video-source';
import type { KioskDistributionFilmHandle } from './KioskDistributionFilm';
import type { DistributionFilm, DistributionVariant, Suivi } from './kiosk-distribution-logic';
import { useDistributionFilm, type DistributionFilmPlayer } from './useDistributionFilm';
import retourData from '../../data/kiosk-retour.json';

/** Le film du retour et ses planches, pour un appareil (même forme que la distribution, sans décor : c'est le sien). */
export type ReturnVariant = Omit<DistributionVariant, 'decor'>;
export const MOBILE_RETURN: ReturnVariant = { film: retourData.film, suivi: retourData.suivi, caches: retourData.caches, ombres: retourData.ombres };
export const PC_RETURN: ReturnVariant | null = (retourData as unknown as { pc?: ReturnVariant }).pc ?? null;
/** Images par seconde des vidéos de retour (retour_sorties.py, retour_pc_sorties.py). */
const RETURN_FPS = 24;

interface ReturnFilmOptions {
  /** La variante de cet appareil ; `null` : pas de film, `play` rend la main aussitôt. */
  variant: ReturnVariant | null;
  /** Place l'écran de la borne et la tranche (le calque donné) pour l'image `index` : la même règle que la distribution. */
  placeFrame: (layer: KioskDistributionFilmHandle | null, index: number, suivi: Suivi) => void;
  /** Rend à l'écran de la borne sa place exacte. */
  releaseScreen: () => void;
}

export interface ReturnFilm {
  /** La vidéo et les planches à donner au calque (celles du téléphone quand l'appareil n'a pas de variante : jamais jouées). */
  film: DistributionFilm;
  sheets: { suivi: string; caches: string; ombres: string };
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

export function useReturnFilm({ variant, placeFrame, releaseScreen }: ReturnFilmOptions): ReturnFilm {
  const enabled = variant !== null;
  const { film, suivi, caches, ombres } = variant ?? MOBILE_RETURN;
  const sheets = useMemo(() => ({ suivi, caches, ombres }), [suivi, caches, ombres]);
  const files = useMemo((): FilmFiles => ({ src: film.src, width: film.largeur, height: film.hauteur, av1: film.av1, framerate: RETURN_FPS, durationMs: film.dureeMs }), [film]);
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
  const player = useDistributionFilm({ film: files, assets: sheets, durationMs: film.dureeMs, load: wanted && enabled, onFrame, onDone });

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

  return { film, sheets, player, layerRef, filmId, playing, want, play };
}
