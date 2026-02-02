import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import managerResponses from '../data/mock/manager-responses.json';
import type { AisleType } from '../types';

// Timing des triggers
const CASSETTE_HOVER_TRIGGER_MS = 30000; // 30 secondes sur une cassette
const MODAL_OPEN_TRIGGER_MS = 45000;     // 45 secondes avec modale ouverte
const HESITATION_WINDOW_MS = 60000;      // Fenêtre pour détecter l'hésitation
const HESITATION_COUNT = 3;               // Nombre de changements pour trigger

export function useManagerTriggers() {
  const {
    selectedFilmId,
    currentAisle,
    showManager,
    addChatMessage,
    managerVisible,
    targetedFilmId,
  } = useStore();

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoveredFilmRef = useRef<number | null>(null);
  const lastTargetedFilmRef = useRef<number | null>(null);
  const targetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentHoversRef = useRef<number[]>([]);
  const aisleVisitsRef = useRef<Record<string, number>>({});

  // Track aisle visits
  useEffect(() => {
    aisleVisitsRef.current[currentAisle] =
      (aisleVisitsRef.current[currentAisle] || 0) + 1;

    // Trigger on 3rd return to same aisle
    if (aisleVisitsRef.current[currentAisle] === 3 && !managerVisible) {
      const aisles = managerResponses.aisles as Record<AisleType, string>;
      const remark = aisles[currentAisle];
      if (remark) {
        showManager();
        addChatMessage('manager', remark);
      }
    }
  }, [currentAisle, managerVisible, showManager, addChatMessage]);

  // Track film hover/selection
  useEffect(() => {
    // Clear existing timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (selectedFilmId === null) {
      lastHoveredFilmRef.current = null;
      return;
    }

    // Track for hesitation detection
    const now = Date.now();
    recentHoversRef.current = [
      ...recentHoversRef.current.filter(
        (timestamp) => now - timestamp < HESITATION_WINDOW_MS
      ),
      now,
    ];

    // Check hesitation trigger
    if (
      recentHoversRef.current.length >= HESITATION_COUNT &&
      !managerVisible
    ) {
      showManager();
      addChatMessage(
        'manager',
        "T'hésites, hein ? C'est normal. Dis-moi ce que tu cherches, je peux t'aiguiller."
      );
      recentHoversRef.current = [];
      return;
    }

    // Start 45s modal timer when film is selected (modal open)
    if (lastHoveredFilmRef.current !== selectedFilmId) {
      lastHoveredFilmRef.current = selectedFilmId;

      modalTimerRef.current = setTimeout(() => {
        if (!managerVisible) {
          const films = managerResponses.films as Record<
            string,
            { anecdotes: string[]; suggestion?: { filmId: number; reason: string } }
          >;
          const filmData = films[String(selectedFilmId)];
          if (filmData) {
            const anecdote =
              filmData.anecdotes[
                Math.floor(Math.random() * filmData.anecdotes.length)
              ];
            showManager();
            addChatMessage('manager', anecdote);
          } else {
            showManager();
            addChatMessage(
              'manager',
              "Celui-là... j'ai des choses à dire dessus. Tu veux en parler ?"
            );
          }
        }
      }, MODAL_OPEN_TRIGGER_MS);
    }

    return () => {
      if (modalTimerRef.current) {
        clearTimeout(modalTimerRef.current);
      }
    };
  }, [selectedFilmId, managerVisible, showManager, addChatMessage]);

  // Track cassette targeting (30s hover via crosshair)
  useEffect(() => {
    // Clear existing timer
    if (targetTimerRef.current) {
      clearTimeout(targetTimerRef.current);
      targetTimerRef.current = null;
    }

    if (targetedFilmId === null) {
      lastTargetedFilmRef.current = null;
      return;
    }

    // Start 30s hover timer when targeting a cassette
    if (lastTargetedFilmRef.current !== targetedFilmId) {
      lastTargetedFilmRef.current = targetedFilmId;

      targetTimerRef.current = setTimeout(() => {
        if (!managerVisible) {
          const films = managerResponses.films as Record<
            string,
            { anecdotes: string[]; suggestion?: { filmId: number; reason: string } }
          >;
          const filmData = films[String(targetedFilmId)];

          const messages = [
            "Tu fixes cette cassette depuis un moment... Tu veux que je t'en parle ?",
            "Ah, celui-là te fait de l'oeil ? Je peux te dire deux-trois trucs dessus.",
            "T'hésites ? C'est un bon choix, je te rassure. Tu veux des détails ?",
            "Je vois que t'es intrigué. Viens, on en discute.",
          ];

          showManager();
          if (filmData && filmData.anecdotes.length > 0) {
            addChatMessage('manager', filmData.anecdotes[Math.floor(Math.random() * filmData.anecdotes.length)]);
          } else {
            addChatMessage('manager', messages[Math.floor(Math.random() * messages.length)]);
          }
        }
      }, CASSETTE_HOVER_TRIGGER_MS);
    }

    return () => {
      if (targetTimerRef.current) {
        clearTimeout(targetTimerRef.current);
      }
    };
  }, [targetedFilmId, managerVisible, showManager, addChatMessage]);

  // Post-rental trigger function (to be called after rental)
  const triggerPostRental = (_filmId: number, isPositive: boolean) => {
    setTimeout(() => {
      const reactions = managerResponses.rentalReactions as {
        positive: string[];
        neutral: string[];
      };
      const options = isPositive ? reactions.positive : reactions.neutral;
      const reaction = options[Math.floor(Math.random() * options.length)];
      showManager();
      addChatMessage('manager', reaction);
    }, 2000);
  };

  return { triggerPostRental };
}
