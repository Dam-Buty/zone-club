'use client';

import { useStore } from '../../store';

// Floating "Now Playing on TV" chip — appears in the lower-third of the
// viewport whenever a cast is active on the receiver but the player overlay
// is closed (e.g. the user dismissed the player to walk around the videoclub
// while the film keeps playing on the TV). Tap → reopens the player for the
// casting film, which then auto-detects the live session and enters the
// Now Playing remote-control panel directly.
//
// Pattern lifted from Spotify / Netflix mini-bars — gives the user a
// persistent awareness that a cast is alive AND a one-tap path back to
// remote controls.
export function ActiveCastIndicator() {
  const activeCastFilmId = useStore(s => s.activeCastFilmId);
  const isPlayerOpen = useStore(s => s.isPlayerOpen);
  const openPlayer = useStore(s => s.openPlayer);
  const films = useStore(s => s.films);

  if (!activeCastFilmId || isPlayerOpen) return null;

  const film = Object.values(films).flat().find(f => f.id === activeCastFilmId);
  const title = film?.title || 'Film en cours';

  return (
    <button
      type="button"
      onClick={() => openPlayer(activeCastFilmId)}
      aria-label={`Reprendre la télécommande pour ${title}`}
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
        // Slight breathing animation so the chip reads as "live" not "stale"
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
          marginLeft: 6,
          paddingLeft: 10,
          borderLeft: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        TÉLÉCOMMANDE
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
