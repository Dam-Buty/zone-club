import { useEffect, useRef, useState } from 'react';
import { trailerNotice, trailerReady, trailerUrl, useTrailerPlayback, useTrailerStatus } from '../../hooks/useTrailer';

// La bande-annonce de la fiche K7 du vidéoclub : la même que celle de la borne, récupérée chez
// Allociné par le serveur et jouée par notre lecteur. Elle remplace le lecteur YouTube, qui pouvait
// diffuser des publicités (Rusmir, 25/11/2026). Montée dès l'ouverture de la fiche, cachée : elle se
// prépare et se précharge pendant qu'on lit la fiche, et démarre tout de suite au clic.

interface K7TrailerProps {
  /** Film dont la fiche est ouverte ; null : fiche fermée, rien ne se prépare. */
  tmdbId: number | null;
  title: string;
  open: boolean;
  onClose: () => void;
}

export function K7Trailer({ tmdbId, title, open, onClose }: K7TrailerProps) {
  const state = useTrailerStatus(tmdbId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState<number | null>(null);
  const brokenNow = broken === tmdbId;
  const playable = tmdbId !== null && trailerReady(state) && !brokenNow;
  useTrailerPlayback(videoRef, open && playable);
  // Chaque ouverture repart du début : on rembobine à la fermeture.
  useEffect(() => {
    if (!open && videoRef.current) videoRef.current.currentTime = 0;
  }, [open]);
  if (tmdbId === null) return null;
  const notice = trailerNotice(state, brokenNow);

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.95)',
        display: open ? 'flex' : 'none',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          aspectRatio: '16/9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid #ff2d95',
          borderRadius: '4px',
          background: '#000',
        }}
      >
        {playable && (
          <video
            key={tmdbId}
            ref={videoRef}
            src={trailerUrl(tmdbId)}
            controls
            playsInline
            preload="auto"
            aria-label={`Bande-annonce de ${title}`}
            onError={() => setBroken(tmdbId)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
        )}
        {notice && <p style={{ color: '#ff8cc6', fontFamily: 'Orbitron, sans-serif', fontSize: '0.9rem', textAlign: 'center', padding: '0 1rem' }}>{notice}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: '20px',
          padding: '12px 30px',
          background: 'transparent',
          border: '2px solid #ff2d95',
          color: '#ff2d95',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '0.9rem',
          cursor: 'pointer',
          borderRadius: '4px',
        }}
      >
        FERMER
      </button>
    </div>
  );
}
