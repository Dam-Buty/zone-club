import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { tmdb } from '../../services/tmdb';
import { Modal } from '../ui/Modal';
import { AuthModal } from '../auth/AuthModal';
import { ReviewModal } from '../review/ReviewModal';
import { RENTAL_COSTS, RENTAL_DURATIONS, type Film, type RentalTier } from '../../types';

interface FilmDetailModalProps {
  film: Film | null;
  isOpen: boolean;
  onClose: () => void;
}

function getRentalTier(film: Film): RentalTier {
  const year = new Date(film.release_date).getFullYear();
  const currentYear = new Date().getFullYear();

  if (currentYear - year <= 1) return 'nouveaute';
  if (currentYear - year >= 20) return 'classique';
  return 'standard';
}

function formatDuration(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours >= 24) return `${Math.floor(hours / 24)} jours`;
  return `${hours}h`;
}

export function FilmDetailModal({ film, isOpen, onClose }: FilmDetailModalProps) {
  const {
    isAuthenticated,
    authUser,
    getCredits,
    deductCredits,
    addRental,
    getRental,
    rentFilm,
    showManager,
    addChatMessage
  } = useStore();
  const [isRenting, setIsRenting] = useState(false);
  const [rentSuccess, setRentSuccess] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [loadingTrailer, setLoadingTrailer] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Utiliser les credits depuis le store
  const credits = getCredits();

  // Reset states when modal closes or film changes
  useEffect(() => {
    if (!isOpen) {
      setShowTrailer(false);
      setTrailerKey(null);
      setRentSuccess(false);
      setIsRenting(false);
      setShowAuthModal(false);
      setShowReviewModal(false);
    }
  }, [isOpen]);

  // Fetch trailer when requested
  const handleWatchTrailer = async () => {
    if (!film || loadingTrailer) return;

    setLoadingTrailer(true);
    try {
      const videos = await tmdb.getVideos(film.id);
      const trailer = videos.find(
        (v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official
      ) || videos.find(
        (v) => v.site === 'YouTube' && v.type === 'Trailer'
      ) || videos.find(
        (v) => v.site === 'YouTube' && v.type === 'Teaser'
      ) || videos.find(
        (v) => v.site === 'YouTube'
      );

      if (trailer) {
        setTrailerKey(trailer.key);
        setShowTrailer(true);
      } else {
        alert('Aucune bande-annonce disponible pour ce film.');
      }
    } catch (error) {
      console.error('Failed to fetch trailer:', error);
      alert('Impossible de charger la bande-annonce.');
    } finally {
      setLoadingTrailer(false);
    }
  };

  // Ask manager for advice about the film
  const handleAskManager = () => {
    if (!film) return;

    const questions = [
      `Dis-moi, qu'est-ce que tu penses de "${film.title}" ?`,
      `T'aurais une anecdote sur "${film.title}" ?`,
      `"${film.title}", c'est bien ? Tu me le conseilles ?`,
      `Parle-moi de "${film.title}", il vaut le coup ?`,
    ];
    const question = questions[Math.floor(Math.random() * questions.length)];

    onClose();
    showManager();
    addChatMessage('user', question);
  };

  if (!film) return null;

  const tier = getRentalTier(film);
  const cost = RENTAL_COSTS[tier];
  const duration = RENTAL_DURATIONS[tier];
  const isRented = !!getRental(film.id);
  const canAfford = credits >= cost;

  const handleRent = async () => {
    // Si pas authentifie, ouvrir le modal d'auth
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!canAfford || isRented || isRenting) return;

    setIsRenting(true);

    // Si authentifie, utiliser l'API backend
    if (isAuthenticated) {
      const rental = await rentFilm(film.id);
      if (rental) {
        setRentSuccess(true);
        setTimeout(() => {
          setRentSuccess(false);
          setIsRenting(false);
          onClose();
        }, 1500);
      } else {
        setIsRenting(false);
      }
    } else {
      // Mode local (fallback)
      await new Promise(resolve => setTimeout(resolve, 300));
      const success = deductCredits(cost);
      if (success) {
        addRental({
          filmId: film.id,
          rentedAt: Date.now(),
          expiresAt: Date.now() + duration,
          videoUrl: `/videos/${film.id}.mp4`,
        });
        setRentSuccess(true);
        setTimeout(() => {
          setRentSuccess(false);
          setIsRenting(false);
          onClose();
        }, 1500);
      } else {
        setIsRenting(false);
      }
    }
  };

  // Callback apres authentification reussie
  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    // Relancer la location apres auth
    handleRent();
  };

  const tierLabel = {
    nouveaute: 'NOUVEAUTÉ',
    standard: 'STANDARD',
    classique: 'CLASSIQUE',
  }[tier];

  const tierColor = {
    nouveaute: '#ff2d95',
    standard: '#00fff7',
    classique: '#ffd700',
  }[tier];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {/* Scanlines overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 1px, transparent 2px)',
          pointerEvents: 'none',
          zIndex: 1,
          borderRadius: '8px',
        }}
      />

      {/* Success overlay */}
      {rentSuccess && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
            borderRadius: '8px',
          }}
        >
          <div
            style={{
              fontSize: '5rem',
              color: '#00ff00',
              textShadow: '0 0 30px #00ff00, 0 0 60px #00ff00',
              animation: 'pulse 0.5s ease-in-out',
            }}
          >
            ✓
          </div>
          <div
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '2rem',
              color: '#00fff7',
              textShadow: '0 0 20px #00fff7',
              marginTop: '1rem',
              letterSpacing: '8px',
            }}
          >
            LOUÉ
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Disponible pendant {formatDuration(duration)}
          </div>
        </div>
      )}

      {/* Trailer overlay */}
      {showTrailer && trailerKey && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.98)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '800px', aspectRatio: '16/9' }}>
            <iframe
              src={tmdb.getYouTubeEmbedUrl(trailerKey)}
              title="Bande-annonce"
              style={{ width: '100%', height: '100%', border: '2px solid #ff2d95', borderRadius: '4px' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <button
            onClick={() => setShowTrailer(false)}
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
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 45, 149, 0.2)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 45, 149, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            FERMER
          </button>
        </div>
      )}

      {/* Backdrop with gradient */}
      {film.backdrop_path && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${tmdb.backdropUrl(film.backdrop_path)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.15,
            zIndex: -1,
            borderRadius: '8px',
            filter: 'blur(2px)',
          }}
        />
      )}

      {/* Main content */}
      <div style={{ display: 'flex', gap: '30px', maxWidth: '900px', position: 'relative', zIndex: 2 }}>
        {/* Left column - Poster */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              position: 'relative',
              border: '3px solid #ff2d95',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 0 30px rgba(255, 45, 149, 0.4), inset 0 0 30px rgba(255, 45, 149, 0.1)',
            }}
          >
            <img
              src={tmdb.posterUrl(film.poster_path)}
              alt={film.title}
              style={{ width: '240px', height: 'auto', display: 'block' }}
            />
            {/* Tier badge */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                padding: '4px 12px',
                background: 'rgba(0, 0, 0, 0.85)',
                border: `2px solid ${tierColor}`,
                borderRadius: '4px',
                color: tierColor,
                fontFamily: 'Orbitron, sans-serif',
                fontSize: '0.7rem',
                letterSpacing: '2px',
                textShadow: `0 0 10px ${tierColor}`,
              }}
            >
              {tierLabel}
            </div>
          </div>

          {/* Rating */}
          <div
            style={{
              marginTop: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              background: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
            }}
          >
            <span style={{ color: '#ffd700', fontSize: '1.5rem', textShadow: '0 0 10px #ffd700' }}>★</span>
            <span style={{ color: '#ffd700', fontFamily: 'Orbitron, sans-serif', fontSize: '1.3rem' }}>
              {film.vote_average.toFixed(1)}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>/10</span>
          </div>
        </div>

        {/* Right column - Info */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Title */}
          <h2
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '1.8rem',
              color: '#00fff7',
              textShadow: '0 0 20px rgba(0, 255, 247, 0.5)',
              margin: 0,
              marginBottom: '10px',
              lineHeight: 1.2,
            }}
          >
            {film.title}
          </h2>

          {/* Meta info */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '15px', flexWrap: 'wrap' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>
              {new Date(film.release_date).getFullYear()}
            </span>
            {film.runtime && (
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>
                {film.runtime} min
              </span>
            )}
          </div>

          {/* Genres */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
            {film.genres.map((g) => (
              <span
                key={g.id}
                style={{
                  padding: '5px 12px',
                  background: 'rgba(138, 43, 226, 0.2)',
                  border: '1px solid rgba(138, 43, 226, 0.5)',
                  borderRadius: '20px',
                  color: '#da70d6',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {g.name}
              </span>
            ))}
          </div>

          {/* Synopsis */}
          <div style={{ marginBottom: '20px', flex: 1 }}>
            <div
              style={{
                color: '#ff2d95',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '3px',
                marginBottom: '8px',
                fontFamily: 'Orbitron, sans-serif',
              }}
            >
              Synopsis
            </div>
            <p
              style={{
                color: 'rgba(255, 255, 255, 0.9)',
                lineHeight: 1.6,
                fontSize: '0.9rem',
                margin: 0,
                maxHeight: '100px',
                overflowY: 'auto',
                paddingRight: '10px',
              }}
            >
              {film.overview || 'Aucun synopsis disponible.'}
            </p>
          </div>

          {/* Action buttons row */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={handleWatchTrailer}
              disabled={loadingTrailer}
              style={{
                flex: 1,
                padding: '12px 20px',
                background: 'linear-gradient(135deg, rgba(255, 0, 0, 0.3) 0%, rgba(180, 0, 0, 0.3) 100%)',
                border: '2px solid #ff4444',
                borderRadius: '6px',
                color: '#ffffff',
                fontFamily: 'Orbitron, sans-serif',
                fontSize: '0.85rem',
                cursor: loadingTrailer ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                opacity: loadingTrailer ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loadingTrailer) {
                  e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 68, 68, 0.6)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{ fontSize: '1rem' }}>▶</span>
              {loadingTrailer ? 'CHARGEMENT...' : 'BANDE-ANNONCE'}
            </button>

            <button
              onClick={handleAskManager}
              style={{
                flex: 1,
                padding: '12px 20px',
                background: 'linear-gradient(135deg, rgba(0, 255, 247, 0.15) 0%, rgba(0, 200, 200, 0.15) 100%)',
                border: '2px solid #00fff7',
                borderRadius: '6px',
                color: '#00fff7',
                fontFamily: 'Orbitron, sans-serif',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 255, 247, 0.5)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{ fontSize: '1rem' }}>?</span>
              DEMANDER AU GERANT
            </button>

            {/* Review button - only shown if rented */}
            {isRented && (
              <button
                onClick={() => setShowReviewModal(true)}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.15) 0%, rgba(200, 150, 0, 0.15) 100%)',
                  border: '2px solid #ffd700',
                  borderRadius: '6px',
                  color: '#ffd700',
                  fontFamily: 'Orbitron, sans-serif',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 215, 0, 0.5)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span style={{ fontSize: '1rem' }}>★</span>
                CRITIQUER
              </button>
            )}
          </div>

          {/* Rental section */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px',
              background: 'linear-gradient(90deg, rgba(255, 45, 149, 0.1) 0%, rgba(138, 43, 226, 0.1) 100%)',
              border: '1px solid rgba(255, 45, 149, 0.3)',
              borderRadius: '8px',
              marginTop: 'auto',
            }}
          >
            {/* Price info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontSize: '2rem',
                    color: '#ffd700',
                    textShadow: '0 0 15px rgba(255, 215, 0, 0.5)',
                  }}
                >
                  {cost}
                </span>
                <span style={{ color: 'rgba(255, 215, 0, 0.7)', fontSize: '1rem' }}>
                  crédit{cost > 1 ? 's' : ''}
                </span>
              </div>
              <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem' }}>
                Location {formatDuration(duration)}
              </span>
            </div>

            {/* Rent button */}
            {isRented ? (
              <div
                style={{
                  padding: '15px 40px',
                  background: 'rgba(0, 255, 0, 0.1)',
                  border: '2px solid #00ff00',
                  borderRadius: '8px',
                  color: '#00ff00',
                  fontFamily: 'Orbitron, sans-serif',
                  fontSize: '1rem',
                  letterSpacing: '2px',
                  textShadow: '0 0 10px #00ff00',
                }}
              >
                ✓ DÉJÀ LOUÉ
              </div>
            ) : (
              <button
                onClick={handleRent}
                disabled={isAuthenticated && (!canAfford || isRenting)}
                style={{
                  padding: '15px 50px',
                  background: !isAuthenticated
                    ? 'linear-gradient(135deg, #00ff00 0%, #00aa00 100%)'
                    : canAfford
                      ? 'linear-gradient(135deg, #ff2d95 0%, #8a2be2 100%)'
                      : 'rgba(100, 100, 100, 0.3)',
                  border: !isAuthenticated || canAfford ? 'none' : '2px solid rgba(100, 100, 100, 0.5)',
                  borderRadius: '8px',
                  color: !isAuthenticated || canAfford ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
                  fontFamily: 'Orbitron, sans-serif',
                  fontSize: '1.1rem',
                  letterSpacing: '3px',
                  cursor: (!isAuthenticated || (canAfford && !isRenting)) ? 'pointer' : 'not-allowed',
                  transition: 'all 0.3s',
                  boxShadow: !isAuthenticated
                    ? '0 0 30px rgba(0, 255, 0, 0.4)'
                    : canAfford
                      ? '0 0 30px rgba(255, 45, 149, 0.4)'
                      : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isAuthenticated || (canAfford && !isRenting)) {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = !isAuthenticated
                      ? '0 0 50px rgba(0, 255, 0, 0.7)'
                      : '0 0 50px rgba(255, 45, 149, 0.7)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = !isAuthenticated
                    ? '0 0 30px rgba(0, 255, 0, 0.4)'
                    : canAfford
                      ? '0 0 30px rgba(255, 45, 149, 0.4)'
                      : 'none';
                }}
              >
                {!isAuthenticated
                  ? 'SE CONNECTER POUR LOUER'
                  : isRenting
                    ? 'LOCATION...'
                    : canAfford
                      ? 'LOUER'
                      : 'CREDITS INSUFFISANTS'}
              </button>
            )}
          </div>

          {/* Credits info */}
          <div
            style={{
              marginTop: '10px',
              textAlign: 'right',
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: '0.8rem',
            }}
          >
            {isAuthenticated ? (
              <>
                <span style={{ color: '#00ff00' }}>{authUser?.username}</span> -{' '}
              </>
            ) : null}
            Votre solde : <span style={{ color: '#ffd700' }}>{credits}</span> credit{credits > 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* Review Modal */}
      <ReviewModal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        film={film}
      />
    </Modal>
  );
}
