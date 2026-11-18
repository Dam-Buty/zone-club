// L'approche filmée de la borne : un film de 3 s, rendu d'avance par la fabrique des images
// (tools/devanture-borne/), où l'on avance de la devanture jusqu'à l'écran de la borne.
//
// Ce crochet le télécharge une fois la devanture affichée, le lance au choix de la borne et
// prévient à l'arrivée. Une règle passe avant tout : la borne ne se fait JAMAIS attendre. Film pas
// encore téléchargé, animations réduites, lecture refusée, erreur, image qui ne vient pas : dans
// tous les cas l'appelant ouvre la borne aussitôt.
//
// Le film est un fichier du site, lu par une balise <video> muette : jamais de lecteur tiers.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** idle : rien ne joue. starting : lecture demandée, première image pas encore à l'écran. playing : le film est à l'écran. */
export type ApproachPhase = 'idle' | 'starting' | 'playing';

/** Première image du film pas affichée dans ce délai : on arrive sans lui. */
export const APPROACH_START_TIMEOUT_MS = 400;
/** Marge au-delà de la durée du film, comptée depuis sa première image affichée (leçon du zoom :
    compté depuis l'appui, un minuteur de garde tombait avant la fin). */
export const APPROACH_GUARD_MARGIN_MS = 1500;

/** Le film ne peut être passé qu'après ce délai de lecture : un double clic ne l'escamote pas. */
export const APPROACH_SKIP_AFTER_MS = 500;

export interface ApproachFilm {
  /** À poser sur la balise <video> de la scène. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Adresse locale du film une fois téléchargé en entier ; null avant. */
  src: string | null;
  phase: ApproachPhase;
  /** Lance le film. false = il ne peut pas partir (pas chargé, animations réduites, déjà parti) :
      à l'appelant d'ouvrir la borne directement. */
  start: () => boolean;
  /** Clic pendant le film : va directement à l'arrivée (sans effet dans sa première demi-seconde). */
  skip: () => void;
}

interface ApproachFilmOptions {
  /** Adresse du film ; undefined = cette devanture n'en a pas. */
  url: string | undefined;
  durationMs: number;
  /** Vrai quand la devanture est affichée : le film se télécharge alors, sans rien retarder. */
  load: boolean;
  /** Fin du film (ou film écourté, en panne, passé) : appelé une seule fois par lancement. */
  onArrive: () => void;
}

export function useApproachFilm({ url, durationMs, load, onArrive }: ApproachFilmOptions): ApproachFilm {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<ApproachPhase>('idle');
  // La phase et l'arrivée sont aussi tenues hors du rendu : les écouteurs de la vidéo et les
  // minuteurs doivent lire leur valeur du moment, pas celle du rendu qui les a posés.
  const phaseRef = useRef<ApproachPhase>('idle');
  const arrivedRef = useRef(false);
  const playingSinceRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const onArriveRef = useRef(onArrive);
  useEffect(() => { onArriveRef.current = onArrive; }, [onArrive]);

  // Téléchargement complet, en tâche de fond : le film joue ensuite depuis la mémoire, sans jamais
  // attendre le réseau. Un échec est silencieux : sans film, la borne s'ouvre directement.
  useEffect(() => {
    if (!load || !url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`film d'approche : ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      // La devanture change (mobile ↔ bureau) ou s'en va : ce film-là n'est plus jouable.
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        setSrc(null);
      }
    };
  }, [load, url]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const arrive = useCallback(() => {
    if (arrivedRef.current) return;
    arrivedRef.current = true;
    clearTimers();
    onArriveRef.current();
  }, [clearTimers]);

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src || phaseRef.current !== 'idle') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

    arrivedRef.current = false;
    phaseRef.current = 'starting';
    setPhase('starting');

    // Le film ne devient visible qu'une fois sa première image réellement présentée : jusque-là
    // c'est la devanture qui reste à l'écran, jamais un rectangle noir.
    const shown = () => {
      if (phaseRef.current !== 'starting' || arrivedRef.current) return;
      phaseRef.current = 'playing';
      playingSinceRef.current = performance.now();
      setPhase('playing');
      clearTimers();
      timersRef.current.push(window.setTimeout(arrive, durationMs + APPROACH_GUARD_MARGIN_MS));
    };
    video.addEventListener('ended', arrive, { once: true });
    video.addEventListener('error', arrive, { once: true });
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(shown);
    else video.addEventListener('playing', shown, { once: true });
    timersRef.current.push(window.setTimeout(arrive, APPROACH_START_TIMEOUT_MS));

    try {
      video.currentTime = 0;
    } catch {
      // Sans importance : le film vient d'être chargé, il est déjà au début.
    }
    video.play().catch(arrive);
    return true;
  }, [src, durationMs, arrive, clearTimers]);

  const skip = useCallback(() => {
    if (phaseRef.current === 'playing' && performance.now() - playingSinceRef.current >= APPROACH_SKIP_AFTER_MS) arrive();
  }, [arrive]);

  return { videoRef, src, phase, start, skip };
}
