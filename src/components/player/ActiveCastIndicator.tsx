'use client';

import { useStore } from '../../store';
import { castOwnsFilm } from '../../cast/cast-machine';
import { castChipLabel } from '../../cast/cast-labels';

// Puce flottante « Cast en cours » — apparaît en bas de l'écran quand la TV a un film à signaler (elle le joue, ne
// répond plus, ou vient de le finir) et que le lecteur est fermé : le visiteur a quitté le lecteur pour se promener
// dans le vidéoclub ou devant la borne pendant que le film continue sur la TV. L'appui rouvre le lecteur sur ce
// film, directement sur le panneau du Cast (aucune invite « Regarder sur TV ? », la TV a déjà son film).
//
// Le film à signaler vient de la MACHINE (`castOwnsFilm`), pas du champ dérivé du magasin (celui que lit encore la
// fiche de la K7) : il est nul une fois le film terminé, et la puce « Film terminé » doit rester jusqu'au rembobinage.
//
// Motif des mini-barres de Spotify / Netflix : la conscience permanente qu'un Cast est vivant, et un chemin en un
// appui vers les commandes.
//
// `variant` : où la puce est posée. `kiosk` ouvre le lecteur « depuis la borne » (le retour de la télécommande y
// ramène) ; son dessin propre à la borne vient à la tâche 7, en attendant les deux dessinent la même chose.
export function ActiveCastIndicator({ variant = 'store' }: { variant?: 'store' | 'kiosk' }) {
  const cast = useStore((s) => s.cast);
  const isPlayerOpen = useStore((s) => s.isPlayerOpen);
  const openPlayer = useStore((s) => s.openPlayer);
  const films = useStore((s) => s.films);

  const filmId = castOwnsFilm(cast);
  const label = castChipLabel(cast.phase);
  if (filmId === null || label === null || isPlayerOpen) return null;

  const film = Object.values(films).flat().find((f) => f.id === filmId);
  const title = film?.title || 'Film en cours';

  return (
    <button
      type="button"
      onClick={() => openPlayer(filmId, { from: variant === 'kiosk' ? 'kiosk' : 'store', ask: false })}
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 18px 10px 14px',
        background: 'linear-gradient(135deg, rgba(0, 30, 40, 0.92), rgba(0, 15, 25, 0.92))',
        border: '1px solid rgba(0, 255, 247, 0.55)',
        borderRadius: 999,
        boxShadow: '0 0 24px rgba(0, 255, 247, 0.35), 0 8px 24px rgba(0, 0, 0, 0.5)',
        color: '#fff',
        fontFamily: "'VT323', 'Courier New', monospace",
        fontSize: '0.95rem',
        letterSpacing: '0.08em',
        cursor: 'pointer',
        // Légère respiration : la puce se lit « vivante », pas figée.
        animation: 'activeCastChipPulse 2.4s ease-in-out infinite',
        WebkitTapHighlightColor: 'transparent',
        maxWidth: 'calc(100vw - 40px)',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#00ff88',
          boxShadow: '0 0 8px #00ff88',
          animation: 'activeCastDotBlink 1.4s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '1.1em', flexShrink: 0 }} aria-hidden="true">📺</span>
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '52vw',
        }}
      >
        {title}
      </span>
      <span
        style={{
          opacity: 0.6,
          fontSize: '0.85em',
          letterSpacing: '0.12em',
          flexShrink: 0,
          whiteSpace: 'nowrap',
          marginLeft: 6,
          paddingLeft: 10,
          borderLeft: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {label}
      </span>
      <style>{`
        @keyframes activeCastChipPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(0, 255, 247, 0.35), 0 8px 24px rgba(0, 0, 0, 0.5); }
          50%      { box-shadow: 0 0 30px rgba(0, 255, 247, 0.55), 0 8px 24px rgba(0, 0, 0, 0.5); }
        }
        @keyframes activeCastDotBlink {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>
    </button>
  );
}
