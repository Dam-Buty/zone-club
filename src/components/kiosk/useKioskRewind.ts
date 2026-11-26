// Le rembobinage fait à la main dans « Mon compte » (spec 2026-11-26-borne-retour-k7-design, § 6.2) : un son, une
// minuterie d'une minute qui ne bloque rien, puis le crédit. Fermer la borne ou rendre le film avant l'échéance = pas de crédit.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';
import { useStore } from '../../store';
import { REWIND_MS, REWIND_SOUNDS } from './kiosk-account-logic';
import type { KioskNoticeSpec } from './KioskNotice';

function play(src: string | null): HTMLAudioElement | null {
  if (!src) return null;
  const audio = new Audio(src);
  void audio.play().catch(() => {});
  return audio;
}

function stop(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function useKioskRewind({ onNotice }: { onNotice: (notice: KioskNoticeSpec | null) => void }) {
  const fetchMe = useStore((state) => state.fetchMe);
  const userId = useStore((state) => state.authUser?.id);
  const [rewindingId, setRewindingId] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const robot = useRef<HTMLAudioElement | null>(null);
  const activeId = useRef<number | null>(null);
  // Jeton d'annulation : chaque arrêt (retour du film, déconnexion, fermeture) le change, et toute suite d'un
  // rembobinage plus ancien (claimRewind, fetchMe) s'abstient.
  const run = useRef(0);
  const notify = useRef(onNotice);
  notify.current = onNotice;

  const clear = useCallback(() => {
    run.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    stop(audio.current);
    audio.current = null;
    activeId.current = null;
  }, []);

  const cancel = useCallback(
    (filmId: number) => {
      if (activeId.current !== filmId) return;
      clear();
      setRewindingId(null);
    },
    [clear],
  );

  const start = useCallback(
    (filmId: number) => {
      if (activeId.current !== null) return;
      activeId.current = filmId;
      setRewindingId(filmId);
      const token = ++run.current;
      audio.current = play(REWIND_SOUNDS.rewind);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void (async () => {
          let ok = true;
          try {
            await api.rentals.claimRewind(filmId);
          } catch {
            ok = false;
          }
          if (run.current !== token) return;
          stop(audio.current);
          audio.current = null;
          if (ok) {
            // Le bouton reste occupé jusqu'à ce que le magasin sache que le film est rembobiné.
            await fetchMe();
            if (run.current !== token) return;
          }
          activeId.current = null;
          setRewindingId(null);
          if (!ok) {
            notify.current({
              title: "Le rembobinage n'a pas abouti",
              body: 'Réessayez dans un instant.',
              primary: { label: 'Fermer', onPress: () => notify.current(null) },
            });
            return;
          }
          stop(robot.current);
          robot.current = play(REWIND_SOUNDS.robot);
        })();
      }, REWIND_MS);
    },
    [fetchMe],
  );

  // Le visiteur change ou se déconnecte : son rembobinage ne se réclame pas au nom du suivant.
  useEffect(() => {
    return () => {
      if (activeId.current === null) return;
      clear();
      setRewindingId(null);
    };
  }, [userId, clear]);

  // Fermer la borne : son et minuterie coupés, aucun crédit.
  useEffect(
    () => () => {
      clear();
      stop(robot.current);
    },
    [clear],
  );

  return { rewindingId, start, cancel };
}
