import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store'
import { tmdb, type TMDBVideo } from '../../services/tmdb'
import { AuthModal } from '../auth/AuthModal'
import { ReviewModal } from '../review/ReviewModal'
import { RENTAL_COSTS, RENTAL_DURATIONS, type Film, type RentalTier } from '../../types'
import { useIsMobile } from '../../hooks/useIsMobile'

interface VHSCaseOverlayProps {
  film: Film | null
  isOpen: boolean
  onClose: () => void
}

function getRentalTier(film: Film): RentalTier {
  const year = new Date(film.release_date).getFullYear()
  const currentYear = new Date().getFullYear()
  if (currentYear - year <= 1) return 'nouveaute'
  if (currentYear - year >= 20) return 'classique'
  return 'standard'
}

function formatDuration(ms: number): string {
  const hours = ms / (1000 * 60 * 60)
  if (hours >= 24) return `${Math.floor(hours / 24)} jours`
  return `${hours}h`
}

// Shared button style factory
function sideButtonStyle(
  borderColor: string,
  textColor: string,
  extra?: React.CSSProperties
): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(8px)',
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    color: textColor,
    fontFamily: 'Orbitron, sans-serif',
    fontSize: '0.79rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    letterSpacing: '1px',
    whiteSpace: 'nowrap',
    ...extra,
  }
}

// Mobile pill button style
function mobilePillStyle(
  borderColor: string,
  textColor: string,
  extra?: React.CSSProperties
): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 16px',
    minHeight: '48px',
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(8px)',
    border: `1px solid ${borderColor}`,
    borderRadius: '24px',
    color: textColor,
    fontFamily: 'Orbitron, sans-serif',
    fontSize: '0.7rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    ...extra,
  }
}

export function VHSCaseOverlay({ film, isOpen, onClose }: VHSCaseOverlayProps) {
  const isMobile = useIsMobile()
  const isAuthenticated = useStore(state => state.isAuthenticated)
  const getCredits = useStore(state => state.getCredits)
  const getRental = useStore(state => state.getRental)
  const rentFilm = useStore(state => state.rentFilm)
  const showManager = useStore(state => state.showManager)
  const addChatMessage = useStore(state => state.addChatMessage)

  const [isRenting, setIsRenting] = useState(false)
  const [rentSuccess, setRentSuccess] = useState(false)
  const [showTrailer, setShowTrailer] = useState(false)
  const [trailerKey, setTrailerKey] = useState<string | null>(null)
  const [loadingTrailer, setLoadingTrailer] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)

  const credits = getCredits()

  // Reset states when overlay closes
  useEffect(() => {
    if (!isOpen) {
      setShowTrailer(false)
      setTrailerKey(null)
      setRentSuccess(false)
      setIsRenting(false)
      setShowAuthModal(false)
      setShowReviewModal(false)
    }
  }, [isOpen])

  // ESC key to close overlay
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (showTrailer) {
          setShowTrailer(false)
        } else if (showAuthModal) {
          setShowAuthModal(false)
        } else if (showReviewModal) {
          setShowReviewModal(false)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, showTrailer, showAuthModal, showReviewModal])

  const handleWatchTrailer = useCallback(async () => {
    if (!film || loadingTrailer) return
    setLoadingTrailer(true)
    try {
      const videos = await tmdb.getVideos(film.id)
      const trailer = videos.find(
        (v: TMDBVideo) => v.site === 'YouTube' && v.type === 'Trailer' && v.official
      ) || videos.find(
        (v: TMDBVideo) => v.site === 'YouTube' && v.type === 'Trailer'
      ) || videos.find(
        (v: TMDBVideo) => v.site === 'YouTube' && v.type === 'Teaser'
      ) || videos.find(
        (v: TMDBVideo) => v.site === 'YouTube'
      )

      if (trailer) {
        setTrailerKey(trailer.key)
        setShowTrailer(true)
      }
    } catch (error) {
      console.error('Failed to fetch trailer:', error)
    } finally {
      setLoadingTrailer(false)
    }
  }, [film, loadingTrailer])

  const handleAskManager = useCallback(() => {
    if (!film) return
    const questions = [
      `Dis-moi, qu'est-ce que tu penses de "${film.title}" ?`,
      `T'aurais une anecdote sur "${film.title}" ?`,
      `"${film.title}", c'est bien ? Tu me le conseilles ?`,
      `Parle-moi de "${film.title}", il vaut le coup ?`,
    ]
    const question = questions[Math.floor(Math.random() * questions.length)]
    onClose()
    showManager()
    addChatMessage('user', question)
  }, [film, onClose, showManager, addChatMessage])

  const handleRent = useCallback(async () => {
    if (!film) return
    if (!isAuthenticated) {
      setShowAuthModal(true)
      return
    }

    const tier = getRentalTier(film)
    const cost = RENTAL_COSTS[tier]
    const isRented = !!getRental(film.id)
    const canAfford = credits >= cost

    if (!canAfford || isRented || isRenting) return
    setIsRenting(true)

    const rental = await rentFilm(film.id)
    if (rental) {
      setRentSuccess(true)
      setTimeout(() => {
        setRentSuccess(false)
        setIsRenting(false)
        onClose()
      }, 1500)
    } else {
      setIsRenting(false)
    }
  }, [film, isAuthenticated, credits, isRenting, getRental, rentFilm, onClose])

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false)
    handleRent()
  }, [handleRent])

  if (!isOpen || !film) return null

  const tier = getRentalTier(film)
  const cost = RENTAL_COSTS[tier]
  const duration = RENTAL_DURATIONS[tier]
  const isRented = !!getRental(film.id)
  const canAfford = credits >= cost

  // Rent button colors (shared)
  const rentBorderColor = !isAuthenticated ? '#00ff00' : canAfford ? '#ff2d95' : '#666666'
  const rentTextColor = !isAuthenticated || canAfford ? '#ffffff' : 'rgba(255,255,255,0.4)'
  const rentBg = !isAuthenticated
    ? 'linear-gradient(135deg, rgba(0,255,0,0.25), rgba(0,170,0,0.25))'
    : canAfford
      ? 'linear-gradient(135deg, rgba(255,45,149,0.25), rgba(138,43,226,0.25))'
      : 'rgba(50,50,50,0.5)'
  const rentCursor = (!isAuthenticated || (canAfford && !isRenting)) ? 'pointer' : 'not-allowed'
  const rentShadow = (!isAuthenticated || canAfford)
    ? `0 0 12px ${!isAuthenticated ? 'rgba(0,255,0,0.2)' : 'rgba(255,45,149,0.2)'}`
    : 'none'
  const rentLabel = !isAuthenticated
    ? 'CONNEXION'
    : isRenting
      ? 'LOCATION...'
      : canAfford
        ? `LOUER (${cost} cr.)`
        : 'PAS ASSEZ'

  return (
    <>
      {/* Trailer fullscreen overlay */}
      {showTrailer && trailerKey && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          padding: '20px',
        }}>
          <div style={{ width: '100%', maxWidth: '900px', aspectRatio: '16/9' }}>
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
            }}
          >
            FERMER
          </button>
        </div>
      )}

      {/* Success overlay */}
      {rentSuccess && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
        }}>
          <div style={{
            fontSize: isMobile ? '3.5rem' : '5rem',
            color: '#00ff00',
            textShadow: '0 0 30px #00ff00, 0 0 60px #00ff00',
          }}>
            {'\u2713'}
          </div>
          <div style={{
            fontFamily: 'Orbitron, sans-serif',
            fontSize: isMobile ? '1.4rem' : '2rem',
            color: '#00fff7',
            textShadow: '0 0 20px #00fff7',
            marginTop: '1rem',
            letterSpacing: '8px',
          }}>
            LOU{'\u00c9'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Disponible pendant {formatDuration(duration)}
          </div>
        </div>
      )}

      {/* ===== MOBILE LAYOUT ===== */}
      {isMobile ? (
        <>
          {/* Close button — floating top-right */}
          <button
            data-vhs-overlay
            onClick={onClose}
            style={{
              position: 'fixed',
              top: '16px',
              right: '16px',
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '2px solid #00ff88',
              background: 'rgba(0,0,0,0.7)',
              color: '#00ff88',
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 100,
              boxShadow: '0 0 12px rgba(0,255,136,0.3)',
            }}
          >
            X
          </button>

          {/* Bottom bar — horizontal scrollable buttons */}
          <div data-vhs-overlay style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            pointerEvents: 'auto',
            background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 70%, transparent 100%)',
            paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
            paddingTop: '12px',
          }}>
            {/* Film title + meta */}
            <div style={{
              textAlign: 'center',
              padding: '0 16px 10px',
            }}>
              <div style={{
                fontFamily: 'Orbitron, sans-serif',
                fontSize: '0.85rem',
                color: '#00fff7',
                textShadow: '0 0 12px rgba(0,255,247,0.5)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {film.title}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255,255,255,0.45)',
                marginTop: '2px',
              }}>
                {film.release_date ? new Date(film.release_date).getFullYear() : ''} {film.runtime ? `\u2022 ${film.runtime} min` : ''} {'\u2022'} {'\u2605'} {film.vote_average.toFixed(1)}
                <span style={{ marginLeft: '8px', color: 'rgba(255,255,255,0.3)' }}>
                  <span style={{ color: '#ffd700' }}>{credits}</span> cr.
                </span>
              </div>
            </div>

            {/* Scrollable button row */}
            <div style={{
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              padding: '0 16px',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}>
              {/* Avis */}
              <button
                onClick={() => setShowReviewModal(true)}
                style={mobilePillStyle('#ffd700', '#ffd700')}
              >
                {'\u2605'} AVIS
              </button>

              {/* Trailer */}
              <button
                onClick={handleWatchTrailer}
                disabled={loadingTrailer}
                style={mobilePillStyle('#ff4444', '#ff4444', {
                  opacity: loadingTrailer ? 0.6 : 1,
                  cursor: loadingTrailer ? 'wait' : 'pointer',
                })}
              >
                {'\u25b6'} TRAILER
              </button>

              {/* Gérant */}
              <button
                onClick={handleAskManager}
                style={mobilePillStyle('#00fff7', '#00fff7')}
              >
                ? G{'\u00c9'}RANT
              </button>

              {/* Critiquer (if rented) */}
              {isRented && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  style={mobilePillStyle('#ffd700', '#ffd700')}
                >
                  {'\u2605'} CRITIQUER
                </button>
              )}

              {/* Rent / Status */}
              {isRented ? (
                <div style={mobilePillStyle('#00ff00', '#00ff00', {
                  background: 'rgba(0,255,0,0.08)',
                  cursor: 'default',
                })}>
                  {'\u2713'} LOU{'\u00c9'}
                </div>
              ) : (
                <button
                  onClick={handleRent}
                  disabled={isAuthenticated && (!canAfford || isRenting)}
                  style={mobilePillStyle(rentBorderColor, rentTextColor, {
                    background: rentBg,
                    cursor: rentCursor,
                    boxShadow: rentShadow,
                  })}
                >
                  {rentLabel}
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* ===== DESKTOP LAYOUT (unchanged) ===== */
        <>
          {/* LEFT SIDE */}
          <div data-vhs-overlay style={{
            position: 'fixed',
            left: '11%',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            zIndex: 100,
            pointerEvents: 'auto',
          }}>
            <button
              onClick={() => setShowReviewModal(true)}
              style={sideButtonStyle('#ffd700', '#ffd700')}
            >
              {'\u2605'} LIRE LES AVIS DU VIDEOCLUB
            </button>

            <button
              onClick={handleWatchTrailer}
              disabled={loadingTrailer}
              style={sideButtonStyle('#ff4444', '#ff4444', {
                opacity: loadingTrailer ? 0.6 : 1,
                cursor: loadingTrailer ? 'wait' : 'pointer',
              })}
            >
              {'\u25b6'} BANDE-ANNONCE
            </button>

            <button
              onClick={handleAskManager}
              style={sideButtonStyle('#00fff7', '#00fff7')}
            >
              ? DEMANDER AU G{'\u00c9'}RANT
            </button>

            {isRented && (
              <button
                onClick={() => setShowReviewModal(true)}
                style={sideButtonStyle('#ffd700', '#ffd700')}
              >
                {'\u2605'} CRITIQUER
              </button>
            )}

            {isRented ? (
              <div style={sideButtonStyle('#00ff00', '#00ff00', {
                background: 'rgba(0,255,0,0.08)',
                cursor: 'default',
              })}>
                {'\u2713'} LOU{'\u00c9'}
              </div>
            ) : (
              <button
                onClick={handleRent}
                disabled={isAuthenticated && (!canAfford || isRenting)}
                style={sideButtonStyle(rentBorderColor, rentTextColor, {
                  background: rentBg,
                  cursor: rentCursor,
                  boxShadow: rentShadow,
                })}
              >
                {rentLabel}
              </button>
            )}
          </div>

          {/* RIGHT SIDE */}
          <div data-vhs-overlay style={{
            position: 'fixed',
            right: '11%',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            zIndex: 100,
            pointerEvents: 'auto',
          }}>
            <button
              onClick={onClose}
              style={sideButtonStyle('#00ff88', '#00ff88', {
                background: 'rgba(0,255,136,0.12)',
                boxShadow: '0 0 12px rgba(0,255,136,0.25)',
              })}
            >
              {'\u21a9'} REPOSER SUR L'{'\u00c9'}TAG{'\u00c8'}RE
            </button>
          </div>

          {/* BOTTOM — Film title + controls hint */}
          <div data-vhs-overlay style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            pointerEvents: 'none',
            textAlign: 'center',
            padding: '16px 24px',
            background: 'linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 100%)',
          }}>
            <div style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '1rem',
              color: '#00fff7',
              textShadow: '0 0 12px rgba(0,255,247,0.5)',
            }}>
              {film.title}
            </div>
            <div style={{
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.45)',
              marginTop: '4px',
            }}>
              {film.release_date ? new Date(film.release_date).getFullYear() : ''} {film.runtime ? `\u2022 ${film.runtime} min` : ''} {'\u2022'} {'\u2605'} {film.vote_average.toFixed(1)}
              <span style={{ marginLeft: '12px', color: 'rgba(255,255,255,0.3)' }}>
                Solde: <span style={{ color: '#ffd700' }}>{credits}</span> cr{'\u00e9'}dit{credits > 1 ? 's' : ''}
              </span>
            </div>
            <div style={{
              marginTop: '6px',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '0.7rem',
              fontFamily: 'sans-serif',
            }}>
              <strong>Clic</strong> - Retourner | <strong>Q</strong> / <strong>E</strong> - Tourner le bo{'\u00ee'}tier | <strong>ESC</strong> - Reposer
            </div>
          </div>
        </>
      )}

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
    </>
  )
}
