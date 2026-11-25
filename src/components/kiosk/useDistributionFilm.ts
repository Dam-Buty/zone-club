// La distribution filmée de la K7 : une vidéo de 8 s, rendue d'avance par la fabrique des images
// (tools/devanture-borne/), où le robot de la borne va chercher la cassette et la sort par la fente.
//
// Ce crochet la télécharge quand le visiteur confirme sa location, la lance à la réponse du serveur et prévient à la
// fin. Même règle que le film d'approche (src/components/exterior/useApproachFilm.ts, dont il reprend les gardes) :
// la borne ne se fait JAMAIS attendre. Vidéo pas téléchargée, animations réduites, lecture refusée, erreur, image qui
// ne vient pas : l'appelant ouvre le panneau « Votre K7 est prête » aussitôt.
//
// À la différence du film d'approche, celle-ci a du son. Elle part après l'appel au serveur, donc après l'appui : un
// navigateur peut refuser la lecture sonore. Elle repart alors muette, et `muted` le dit pour que la borne le signale.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { frameAt, isUsableSuivi, type Suivi } from './kiosk-distribution-logic';

/** idle : rien ne joue. starting : lecture demandée, première image pas encore à l'écran. playing : à l'écran. */
export type DistributionPhase = 'idle' | 'starting' | 'playing';

/** Première image pas affichée dans ce délai : on passe au panneau sans la vidéo. */
export const DISTRIBUTION_START_TIMEOUT_MS = 400;
/** Marge au-delà de la durée de la vidéo, comptée depuis sa première image affichée. */
export const DISTRIBUTION_GUARD_MARGIN_MS = 1500;

export interface DistributionFilmPlayer {
  /** À poser sur la balise <video>. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Adresse locale de la vidéo une fois téléchargée en entier ; null avant. */
  src: string | null;
  phase: DistributionPhase;
  /** Vrai si le navigateur a refusé le son : la vidéo joue muette. */
  muted: boolean;
  /** Lance la vidéo. false = elle ne peut pas partir : à l'appelant d'ouvrir le panneau directement. */
  start: () => boolean;
  /** Appui ou geste retour pendant la vidéo : coupe image et son, passe au panneau. */
  skip: () => void;
}

interface DistributionFilmOptions {
  url: string;
  /** Ce qui accompagne la vidéo : le suivi de la K7 image par image et les deux planches (caches, ombres). */
  assets: { suivi: string; caches: string; ombres: string };
  durationMs: number;
  /** Vrai dès que le visiteur confirme sa location : la vidéo se télécharge alors, sans rien retarder. */
  load: boolean;
  /**
   * Une image de la vidéo vient d'être présentée (et une fois au lancement, pour l'image 0) : à la borne d'y placer la
   * tranche du film et son écran. Appelé hors du rendu React — 24 rendus de l'arbre par seconde seraient une faute.
   */
  onFrame: (index: number, suivi: Suivi) => void;
  /** Fin de la vidéo (ou vidéo passée, en panne, refusée) : appelé une seule fois par lancement. */
  onDone: () => void;
}

export function useDistributionFilm({ url, assets, durationMs, load, onFrame, onDone }: DistributionFilmOptions): DistributionFilmPlayer {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<DistributionPhase>('idle');
  const [muted, setMuted] = useState(false);
  // Tenus hors du rendu : les écouteurs de la vidéo et les minuteurs lisent la valeur du moment.
  const phaseRef = useRef<DistributionPhase>('idle');
  // L'adresse aussi : `start` est appelé depuis une confirmation ouverte AVANT la fin du téléchargement (le bouton
  // « Louer » garde le rappel du rendu où elle s'est ouverte) ; il doit lire l'adresse du moment, pas celle de ce rendu.
  const srcRef = useRef<string | null>(null);
  const doneRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  // Le suivi et les planches : sans eux la K7 de la vidéo resterait sans tranche — la vidéo ne part donc pas.
  const suiviRef = useRef<Suivi | null>(null);
  const sheetsRef = useRef(0);

  // Téléchargement complet, en tâche de fond : la vidéo joue ensuite depuis la mémoire. Un échec est silencieux.
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`vidéo de distribution : ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        srcRef.current = objectUrl;
        setSrc(objectUrl);
      })
      .catch(() => {});
    fetch(assets.suivi)
      .then((response) => {
        if (!response.ok) throw new Error(`suivi de la distribution : ${response.status}`);
        return response.json() as Promise<Suivi>;
      })
      // Un suivi vide ou incomplet n'est pas un suivi : la vidéo ne partira pas (sinon : 8 s d'écran noir).
      .then((suivi) => { if (!cancelled && isUsableSuivi(suivi)) suiviRef.current = suivi; })
      .catch(() => {});
    sheetsRef.current = 0;
    for (const sheet of [assets.caches, assets.ombres]) {
      const image = new Image();
      image.onload = () => { if (!cancelled) sheetsRef.current += 1; };
      image.src = sheet;
    }
    return () => {
      cancelled = true;
      suiviRef.current = null;
      sheetsRef.current = 0;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        srcRef.current = null;
        setSrc(null);
      }
    };
  }, [load, url, assets.suivi, assets.caches, assets.ombres]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const done = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    // Quelle que soit la fin (délai de la première image, garde, erreur), la vidéo s'arrête : sinon elle jouerait son
    // son, invisible, sous le panneau. Sans effet après `ended`.
    videoRef.current?.pause();
    // La borne reste montée : la location suivante doit pouvoir rejouer la vidéo.
    phaseRef.current = 'idle';
    setPhase('idle');
    onDoneRef.current();
  }, [clearTimers]);

  const start = useCallback(() => {
    const video = videoRef.current;
    const suivi = suiviRef.current;
    if (!video || !srcRef.current || !suivi || !suiviRef.current || sheetsRef.current < 2 || phaseRef.current !== 'idle') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

    doneRef.current = false;
    phaseRef.current = 'starting';
    setPhase('starting');
    setMuted(false);
    video.muted = false;

    // Suit l'image à l'écran tant que la vidéo joue : c'est elle qui dit quand poser la tranche et l'afficheur.
    const follow = (_now: number, frame: { mediaTime: number }) => {
      if (doneRef.current) return;
      if (phaseRef.current === 'starting') {
        phaseRef.current = 'playing';
        setPhase('playing');
        clearTimers();
        timersRef.current.push(window.setTimeout(done, durationMs + DISTRIBUTION_GUARD_MARGIN_MS));
      }
      onFrameRef.current(frameAt(frame.mediaTime, suivi), suivi);
      video.requestVideoFrameCallback(follow);
    };
    video.addEventListener('ended', done, { once: true });
    video.addEventListener('error', done, { once: true });
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(follow);
    } else {
      const tick = () => {
        if (doneRef.current) return video.removeEventListener('timeupdate', tick);
        if (phaseRef.current === 'starting') {
          phaseRef.current = 'playing';
          setPhase('playing');
          clearTimers();
          timersRef.current.push(window.setTimeout(done, durationMs + DISTRIBUTION_GUARD_MARGIN_MS));
        }
        onFrameRef.current(frameAt(video.currentTime, suivi), suivi);
      };
      video.addEventListener('timeupdate', tick);
    }
    timersRef.current.push(window.setTimeout(done, DISTRIBUTION_START_TIMEOUT_MS));
    // Tout est en place AVANT la première image : la tranche sur la K7, l'écran dans son cadre.
    try {
      onFrameRef.current(0, suivi);
    } catch {
      // Suivi mal formé : pas de vidéo. L'appelant ouvre le panneau (il reçoit false) ; rien ne reste armé.
      doneRef.current = true;
      clearTimers();
      video.removeEventListener('ended', done);
      video.removeEventListener('error', done);
      phaseRef.current = 'idle';
      setPhase('idle');
      return false;
    }

    try {
      video.currentTime = 0;
    } catch {
      // Sans importance : la vidéo vient d'être chargée, elle est déjà au début.
    }
    video.play().catch(() => {
      // Lecture sonore refusée (elle part après l'appel au serveur, plus dans l'appui) : on la rejoue muette.
      if (doneRef.current) return;
      video.muted = true;
      setMuted(true);
      video.play().catch(done);
    });
    return true;
  }, [durationMs, done, clearTimers]);

  const skip = useCallback(() => {
    if (phaseRef.current === 'idle') return;
    videoRef.current?.pause();
    done();
  }, [done]);

  return { videoRef, src, phase, muted, start, skip };
}
