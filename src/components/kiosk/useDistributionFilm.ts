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
  /** Instant de l'image à l'écran, en millisecondes de vidéo. */
  timeMs: number;
  /** Lance la vidéo. false = elle ne peut pas partir : à l'appelant d'ouvrir le panneau directement. */
  start: () => boolean;
  /** Appui ou geste retour pendant la vidéo : coupe image et son, passe au panneau. */
  skip: () => void;
}

interface DistributionFilmOptions {
  url: string;
  durationMs: number;
  /** Vrai dès que le visiteur confirme sa location : la vidéo se télécharge alors, sans rien retarder. */
  load: boolean;
  /** Fin de la vidéo (ou vidéo passée, en panne, refusée) : appelé une seule fois par lancement. */
  onDone: () => void;
}

export function useDistributionFilm({ url, durationMs, load, onDone }: DistributionFilmOptions): DistributionFilmPlayer {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<DistributionPhase>('idle');
  const [muted, setMuted] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  // Tenus hors du rendu : les écouteurs de la vidéo et les minuteurs lisent la valeur du moment.
  const phaseRef = useRef<DistributionPhase>('idle');
  // L'adresse aussi : `start` est appelé depuis une confirmation ouverte AVANT la fin du téléchargement (le bouton
  // « Louer » garde le rappel du rendu où elle s'est ouverte) ; il doit lire l'adresse du moment, pas celle de ce rendu.
  const srcRef = useRef<string | null>(null);
  const doneRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

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
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        srcRef.current = null;
        setSrc(null);
      }
    };
  }, [load, url]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const done = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    // La borne reste montée : la location suivante doit pouvoir rejouer la vidéo.
    phaseRef.current = 'idle';
    setPhase('idle');
    onDoneRef.current();
  }, [clearTimers]);

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video || !srcRef.current || phaseRef.current !== 'idle') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

    doneRef.current = false;
    phaseRef.current = 'starting';
    setPhase('starting');
    setTimeMs(0);
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
      setTimeMs(frame.mediaTime * 1000);
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
        setTimeMs(video.currentTime * 1000);
      };
      video.addEventListener('timeupdate', tick);
    }
    timersRef.current.push(window.setTimeout(done, DISTRIBUTION_START_TIMEOUT_MS));

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

  return { videoRef, src, phase, muted, timeMs, start, skip };
}
