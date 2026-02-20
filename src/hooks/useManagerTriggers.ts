import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { AisleType } from '../types';

const CASSETTE_HOVER_TRIGGER_MS = 30000;
const HESITATION_WINDOW_MS = 60000;
const HESITATION_COUNT = 3;

export function useManagerTriggers() {
  const selectedFilmId = useStore(state => state.selectedFilmId);
  const currentAisle = useStore(state => state.currentAisle);
  const managerVisible = useStore(state => state.managerVisible);
  const showManager = useStore(state => state.showManager);
  const pushEvent = useStore(state => state.pushEvent);

  const recentHoversRef = useRef<number[]>([]);
  const aisleVisitsRef = useRef<Record<string, number>>({});

  // Track aisle visits
  useEffect(() => {
    aisleVisitsRef.current[currentAisle] =
      (aisleVisitsRef.current[currentAisle] || 0) + 1;

    // Trigger on 3rd return to same aisle
    if (aisleVisitsRef.current[currentAisle] === 3 && !managerVisible) {
      pushEvent(`Le client revient dans le rayon ${currentAisle} pour la 3eme fois. Il semble hesiter.`);
      showManager();
    }
  }, [currentAisle, managerVisible, showManager, pushEvent]);

  // Track film hover/selection for hesitation detection
  useEffect(() => {
    if (selectedFilmId === null) return;

    const now = Date.now();
    recentHoversRef.current = [
      ...recentHoversRef.current.filter(
        (timestamp) => now - timestamp < HESITATION_WINDOW_MS
      ),
      now,
    ];

    if (
      recentHoversRef.current.length >= HESITATION_COUNT &&
      !managerVisible
    ) {
      pushEvent(`Le client hesite entre plusieurs cassettes. Il en a pris ${recentHoversRef.current.length} en main recemment.`);
      showManager();
      recentHoversRef.current = [];
    }
  }, [selectedFilmId, managerVisible, showManager, pushEvent]);

  // Track cassette targeting (30s hover via crosshair)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastTargeted: number | null = null;

    const unsubscribe = useStore.subscribe((state) => {
      const targetedFilmId = state.targetedFilmId;

      if (targetedFilmId === lastTargeted) return;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      lastTargeted = targetedFilmId;

      if (targetedFilmId === null) return;

      timer = setTimeout(() => {
        const currentState = useStore.getState();
        if (!currentState.managerVisible) {
          currentState.pushEvent(`Le client fixe une cassette (film id:${targetedFilmId}) depuis 30 secondes.`);
          currentState.showManager();
        }
      }, CASSETTE_HOVER_TRIGGER_MS);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
