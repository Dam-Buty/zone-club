import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../../store";
import { tmdb, type TMDBVideo } from "../../services/tmdb";
import { AuthModal } from "../auth/AuthModal";
import { ReviewModal } from "../review/ReviewModal";
import {
  RENTAL_COSTS,
  RENTAL_DURATIONS,
  type Film,
  type RentalTier,
} from "../../types";
import { useIsMobile } from "../../hooks/useIsMobile";

interface VHSCaseOverlayProps {
  film: Film | null;
  isOpen: boolean;
  onClose: () => void;
}

function getRentalTier(film: Film): RentalTier {
  const year = new Date(film.release_date).getFullYear();
  const currentYear = new Date().getFullYear();
  if (currentYear - year <= 1) return "nouveaute";
  if (currentYear - year >= 20) return "classique";
  return "standard";
}

function formatDuration(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours >= 24) return `${Math.floor(hours / 24)} jours`;
  return `${hours}h`;
}

function formatCountdown(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "EXPIR\u00c9";
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Shared button style factory
function sideButtonStyle(
  borderColor: string,
  textColor: string,
  extra?: React.CSSProperties,
): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "12px 20px",
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(8px)",
    border: `1px solid ${borderColor}`,
    borderRadius: "6px",
    color: textColor,
    fontFamily: "Orbitron, sans-serif",
    fontSize: "0.79rem",
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "1px",
    whiteSpace: "nowrap",
    ...extra,
  };
}

// Mobile pill button style
function mobilePillStyle(
  borderColor: string,
  textColor: string,
  extra?: React.CSSProperties,
): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "10px 14px",
    minHeight: "44px",
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(8px)",
    border: `1px solid ${borderColor}`,
    borderRadius: "8px",
    color: textColor,
    fontFamily: "Orbitron, sans-serif",
    fontSize: "0.65rem",
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "0.5px",
    whiteSpace: "nowrap",
    flex: "1 1 auto",
    ...extra,
  };
}

export function VHSCaseOverlay({ film, isOpen, onClose }: VHSCaseOverlayProps) {
  const isMobile = useIsMobile();
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const getCredits = useStore((state) => state.getCredits);
  const getRental = useStore((state) => state.getRental);
  const storeRentFilm = useStore((state) => state.rentFilm);
  const storeSetViewingMode = useStore((state) => state.setViewingMode);
  const openPlayer = useStore((state) => state.openPlayer);
  const showManager = useStore((state) => state.showManager);
  const addChatMessage = useStore((state) => state.addChatMessage);

  const [isRenting, setIsRenting] = useState(false);
  const [rentSuccess, setRentSuccess] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [loadingTrailer, setLoadingTrailer] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [settingMode, setSettingMode] = useState(false);

  // Live countdown timer
  const [countdown, setCountdown] = useState("");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const credits = getCredits();
  const rental = film ? getRental(film.id) : undefined;
  const isRented = !!rental;

  // Update countdown every second when rented
  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (!isOpen || !rental) {
      setCountdown("");
      return;
    }
    const update = () => setCountdown(formatCountdown(rental.expiresAt));
    update();
    countdownRef.current = setInterval(update, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isOpen, rental]);

  // Reset states when overlay closes
  useEffect(() => {
    if (!isOpen) {
      setShowTrailer(false);
      setTrailerKey(null);
      setRentSuccess(false);
      setIsRenting(false);
      setShowAuthModal(false);
      setShowReviewModal(false);
      setSettingMode(false);
    }
  }, [isOpen]);

  // ESC key to close overlay
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        if (showTrailer) {
          setShowTrailer(false);
        } else if (showAuthModal) {
          setShowAuthModal(false);
        } else if (showReviewModal) {
          setShowReviewModal(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showTrailer, showAuthModal, showReviewModal]);

  const handleWatchTrailer = useCallback(async () => {
    if (!film || loadingTrailer) return;
    const tmdbFilmId = film.tmdb_id;
    if (!tmdbFilmId) return;
    setLoadingTrailer(true);
    try {
      const videos = await tmdb.getVideos(tmdbFilmId);
      const trailer =
        videos.find(
          (v: TMDBVideo) =>
            v.site === "YouTube" && v.type === "Trailer" && v.official,
        ) ||
        videos.find(
          (v: TMDBVideo) => v.site === "YouTube" && v.type === "Trailer",
        ) ||
        videos.find(
          (v: TMDBVideo) => v.site === "YouTube" && v.type === "Teaser",
        ) ||
        videos.find((v: TMDBVideo) => v.site === "YouTube");

      if (trailer) {
        setTrailerKey(trailer.key);
        setShowTrailer(true);
      }
    } catch (error) {
      console.error("Failed to fetch trailer:", error);
    } finally {
      setLoadingTrailer(false);
    }
  }, [film, loadingTrailer]);

  const handleAskManager = useCallback(() => {
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
    addChatMessage("user", question);
  }, [film, onClose, showManager, addChatMessage]);

  const handleRent = useCallback(async () => {
    if (!film) return;
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    const tier = getRentalTier(film);
    const cost = RENTAL_COSTS[tier];
    const alreadyRented = !!getRental(film.id);
    const canAfford = credits >= cost;

    if (!canAfford || alreadyRented || isRenting) return;
    setIsRenting(true);

    const result = await storeRentFilm(film.id);
    if (result) {
      setRentSuccess(true);
      // Show success briefly, then transition to viewing mode choice
      setTimeout(() => {
        setRentSuccess(false);
        setIsRenting(false);
      }, 1500);
    } else {
      setIsRenting(false);
    }
  }, [film, isAuthenticated, credits, isRenting, getRental, storeRentFilm]);

  const handleSetViewingMode = useCallback(async (mode: 'sur_place' | 'emporter') => {
    if (!film || settingMode) return;
    setSettingMode(true);
    const updatedRental = await storeSetViewingMode(film.id, mode);
    setSettingMode(false);
    if (!updatedRental) return;

    if (mode === 'sur_place') {
      // Open player immediately
      onClose();
      openPlayer(film.id);
      return;
    }

    // "À emporter" triggers the browser download automatically.
    try {
      const response = await fetch(`/api/rentals/${film.id}/download`, { credentials: 'include' });
      if (!response.ok) throw new Error('Téléchargement impossible');

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${film.title}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Erreur téléchargement à emporter:', error);
    }
  }, [film, settingMode, storeSetViewingMode, onClose, openPlayer]);

  const handleSitDown = useCallback(() => {
    if (!film) return;
    onClose();
    openPlayer(film.id);
  }, [film, onClose, openPlayer]);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
    handleRent();
  }, [handleRent]);

  if (!isOpen || !film) return null;

  const tier = getRentalTier(film);
  const cost = RENTAL_COSTS[tier];
  const duration = RENTAL_DURATIONS[tier];
  const canAfford = credits >= cost;

  // Rent button colors
  const rentBorderColor = !isAuthenticated
    ? "#00ff00"
    : canAfford
      ? "#ff2d95"
      : "#666666";
  const rentTextColor =
    !isAuthenticated || canAfford ? "#ffffff" : "rgba(255,255,255,0.4)";
  const rentBg = !isAuthenticated
    ? "linear-gradient(135deg, rgba(0,255,0,0.25), rgba(0,170,0,0.25))"
    : canAfford
      ? "linear-gradient(135deg, rgba(255,45,149,0.25), rgba(138,43,226,0.25))"
      : "rgba(50,50,50,0.5)";
  const rentCursor =
    !isAuthenticated || (canAfford && !isRenting) ? "pointer" : "not-allowed";
  const rentShadow =
    !isAuthenticated || canAfford
      ? `0 0 12px ${!isAuthenticated ? "rgba(0,255,0,0.2)" : "rgba(255,45,149,0.2)"}`
      : "none";
  const rentLabel = !isAuthenticated
    ? "CONNEXION"
    : isRenting
      ? "LOCATION..."
      : canAfford
        ? `LOUER (${cost} cr.)`
        : "PAS ASSEZ";

  // ===== Rental section rendering helpers =====

  // Desktop rental buttons
  function renderDesktopRentalSection() {
    if (isRented && rental) {
      // Countdown timer
      const timerEl = (
        <div
          style={sideButtonStyle("#ffaa00", "#ffaa00", {
            background: "rgba(255,170,0,0.08)",
            cursor: "default",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "2px",
          })}
        >
          <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>Expire dans</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{countdown}</span>
        </div>
      );

      // No viewing mode chosen yet
      if (!rental.viewingMode) {
        return (
          <>
            {timerEl}
            <button
              onClick={() => handleSetViewingMode('sur_place')}
              disabled={settingMode}
              style={sideButtonStyle("#00fff7", "#00fff7", {
                background: "linear-gradient(135deg, rgba(0,255,247,0.2), rgba(0,170,255,0.2))",
                boxShadow: "0 0 12px rgba(0,255,247,0.25)",
              })}
            >
              {"\ud83d\udcfa"} REGARDER SUR PLACE
            </button>
            <button
              onClick={() => handleSetViewingMode('emporter')}
              disabled={settingMode}
              style={sideButtonStyle("#ff9900", "#ff9900", {
                background: "linear-gradient(135deg, rgba(255,153,0,0.2), rgba(255,100,0,0.2))",
                boxShadow: "0 0 12px rgba(255,153,0,0.2)",
              })}
            >
              {"\ud83d\udcfc"} {"\u00c0"} EMPORTER
            </button>
          </>
        );
      }

      // Mode = sur_place → sit down button
      if (rental.viewingMode === 'sur_place') {
        return (
          <>
            {timerEl}
            <button
              onClick={handleSitDown}
              style={sideButtonStyle("#00fff7", "#ffffff", {
                background: "linear-gradient(135deg, rgba(0,255,247,0.3), rgba(0,200,255,0.3))",
                boxShadow: "0 0 16px rgba(0,255,247,0.35)",
                fontSize: "0.85rem",
              })}
            >
              {"\ud83d\udecb\ufe0f"} S'INSTALLER ET REGARDER
            </button>
          </>
        );
      }

      // Mode = emporter → badge
      return (
        <>
          {timerEl}
          <div
            style={sideButtonStyle("#ff9900", "#ff9900", {
              background: "rgba(255,153,0,0.08)",
              cursor: "default",
            })}
          >
            {"\ud83d\udcfc"} {"\u00c0"} EMPORTER {"\u2713"}
          </div>
        </>
      );
    }

    // Not rented — show rent button
    return (
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
    );
  }

  // Mobile rental buttons
  function renderMobileRentalSection() {
    if (isRented && rental) {
      // Countdown pill
      const timerEl = (
        <div
          style={mobilePillStyle("#ffaa00", "#ffaa00", {
            background: "rgba(255,170,0,0.08)",
            cursor: "default",
          })}
        >
          {"\u23f1"} {countdown}
        </div>
      );

      if (!rental.viewingMode) {
        return (
          <>
            {timerEl}
            <button
              onClick={() => handleSetViewingMode('sur_place')}
              disabled={settingMode}
              style={mobilePillStyle("#00fff7", "#00fff7", {
                background: "rgba(0,255,247,0.12)",
                boxShadow: "0 0 8px rgba(0,255,247,0.2)",
              })}
            >
              {"\ud83d\udcfa"} SUR PLACE
            </button>
            <button
              onClick={() => handleSetViewingMode('emporter')}
              disabled={settingMode}
              style={mobilePillStyle("#ff9900", "#ff9900", {
                background: "rgba(255,153,0,0.12)",
                boxShadow: "0 0 8px rgba(255,153,0,0.15)",
              })}
            >
              {"\ud83d\udcfc"} EMPORTER
            </button>
          </>
        );
      }

      if (rental.viewingMode === 'sur_place') {
        return (
          <>
            {timerEl}
            <button
              onClick={handleSitDown}
              style={mobilePillStyle("#00fff7", "#ffffff", {
                background: "rgba(0,255,247,0.2)",
                boxShadow: "0 0 10px rgba(0,255,247,0.3)",
              })}
            >
              {"\ud83d\udecb\ufe0f"} S'INSTALLER
            </button>
          </>
        );
      }

      return (
        <>
          {timerEl}
          <div
            style={mobilePillStyle("#ff9900", "#ff9900", {
              background: "rgba(255,153,0,0.08)",
              cursor: "default",
            })}
          >
            {"\ud83d\udcfc"} EMPORTER {"\u2713"}
          </div>
        </>
      );
    }

    // Not rented
    return (
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
    );
  }

  return (
    <>
      {/* Trailer fullscreen overlay */}
      {showTrailer && trailerKey && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: "20px",
          }}
        >
          <div
            style={{ width: "100%", maxWidth: "900px", aspectRatio: "16/9" }}
          >
            <iframe
              src={tmdb.getYouTubeEmbedUrl(trailerKey)}
              title="Bande-annonce"
              style={{
                width: "100%",
                height: "100%",
                border: "2px solid #ff2d95",
                borderRadius: "4px",
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <button
            onClick={() => setShowTrailer(false)}
            style={{
              marginTop: "20px",
              padding: "12px 30px",
              background: "transparent",
              border: "2px solid #ff2d95",
              color: "#ff2d95",
              fontFamily: "Orbitron, sans-serif",
              fontSize: "0.9rem",
              cursor: "pointer",
              borderRadius: "4px",
            }}
          >
            FERMER
          </button>
        </div>
      )}

      {/* Success overlay */}
      {rentSuccess && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
        >
          <div
            style={{
              fontSize: isMobile ? "3.5rem" : "5rem",
              color: "#00ff00",
              textShadow: "0 0 30px #00ff00, 0 0 60px #00ff00",
            }}
          >
            {"\u2713"}
          </div>
          <div
            style={{
              fontFamily: "Orbitron, sans-serif",
              fontSize: isMobile ? "1.4rem" : "2rem",
              color: "#00fff7",
              textShadow: "0 0 20px #00fff7",
              marginTop: "1rem",
              letterSpacing: "8px",
            }}
          >
            LOU{"\u00c9"}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.6)",
              marginTop: "0.5rem",
              fontSize: "0.9rem",
            }}
          >
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
              position: "fixed",
              top: "16px",
              right: "16px",
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "2px solid #ff2d44",
              background: "rgba(180,20,40,0.35)",
              color: "#ff4444",
              fontFamily: "Orbitron, sans-serif",
              fontSize: "1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 100,
              boxShadow: "0 0 14px rgba(255,45,68,0.4)",
            }}
          >
            X
          </button>

          {/* Bottom bar — flex-wrap buttons */}
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              pointerEvents: "none",
              background:
                "linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 70%, transparent 100%)",
              paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
              paddingTop: "12px",
            }}
          >
            {/* Film title + meta */}
            <div
              data-vhs-overlay
              style={{
                textAlign: "center",
                padding: "0 16px 10px",
                pointerEvents: "auto",
              }}
            >
              <div
                style={{
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: "0.85rem",
                  color: "#00fff7",
                  textShadow: "0 0 12px rgba(0,255,247,0.5)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {film.title}
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "rgba(255,255,255,0.45)",
                  marginTop: "2px",
                }}
              >
                {film.release_date
                  ? new Date(film.release_date).getFullYear()
                  : ""}{" "}
                {film.runtime ? `\u2022 ${film.runtime} min` : ""} {"\u2022"}{" "}
                {"\u2605"} {film.vote_average.toFixed(1)}
                <span
                  style={{ marginLeft: "8px", color: "rgba(255,255,255,0.3)" }}
                >
                  <span style={{ color: "#ffd700" }}>{credits}</span> cr.
                </span>
              </div>
            </div>

            {/* Button row — flex-wrap to fit screen */}
            <div
              data-vhs-overlay
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                padding: "0 16px",
                justifyContent: "center",
                pointerEvents: "auto",
              }}
            >
              {/* Avis */}
              <button
                onClick={() => setShowReviewModal(true)}
                style={mobilePillStyle("#ffd700", "#ffd700")}
              >
                {"\u2605"} AVIS
              </button>

              {/* Trailer */}
              <button
                onClick={handleWatchTrailer}
                disabled={loadingTrailer}
                style={mobilePillStyle("#ff4444", "#ff4444", {
                  opacity: loadingTrailer ? 0.6 : 1,
                  cursor: loadingTrailer ? "wait" : "pointer",
                })}
              >
                {"\u25b6"} TRAILER
              </button>

              {/* G\u00e9rant */}
              <button
                onClick={handleAskManager}
                style={mobilePillStyle("#00fff7", "#00fff7")}
              >
                ? G{"\u00c9"}RANT
              </button>

              {/* Critiquer (if rented) */}
              {isRented && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  style={mobilePillStyle("#ffd700", "#ffd700")}
                >
                  {"\u2605"} CRITIQUER
                </button>
              )}

              {/* Rental section */}
              {renderMobileRentalSection()}
            </div>
          </div>
        </>
      ) : (
        /* ===== DESKTOP LAYOUT ===== */
        <>
          {/* LEFT SIDE */}
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              left: "11%",
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              zIndex: 100,
              pointerEvents: "auto",
              background: "rgba(0, 0, 0, 0.45)",
              backdropFilter: "blur(6px)",
              padding: "14px",
              borderRadius: "10px",
            }}
          >
            <button
              onClick={() => setShowReviewModal(true)}
              style={sideButtonStyle("#ffd700", "#ffd700")}
            >
              {"\u2605"} LIRE LES AVIS DU VIDEOCLUB
            </button>

            <button
              onClick={handleWatchTrailer}
              disabled={loadingTrailer}
              style={sideButtonStyle("#ff4444", "#ff4444", {
                opacity: loadingTrailer ? 0.6 : 1,
                cursor: loadingTrailer ? "wait" : "pointer",
              })}
            >
              {"\u25b6"} BANDE-ANNONCE
            </button>

            <button
              onClick={handleAskManager}
              style={sideButtonStyle("#00fff7", "#00fff7")}
            >
              ? DEMANDER AU G{"\u00c9"}RANT
            </button>

            {isRented && (
              <button
                onClick={() => setShowReviewModal(true)}
                style={sideButtonStyle("#ffd700", "#ffd700")}
              >
                {"\u2605"} CRITIQUER
              </button>
            )}

            {/* Rental section — rent button or timer + viewing mode */}
            {renderDesktopRentalSection()}
          </div>

          {/* RIGHT SIDE */}
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              right: "11%",
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              zIndex: 100,
              pointerEvents: "auto",
              background: "rgba(0, 0, 0, 0.45)",
              backdropFilter: "blur(6px)",
              padding: "14px",
              borderRadius: "10px",
            }}
          >
            <button
              onClick={onClose}
              style={sideButtonStyle("#00ff88", "#00ff88", {
                background: "rgba(0,255,136,0.12)",
                boxShadow: "0 0 12px rgba(0,255,136,0.25)",
              })}
            >
              {"\u21a9"} REPOSER SUR L'{"\u00c9"}TAG{"\u00c8"}RE
            </button>
          </div>

          {/* BOTTOM — Film title + controls hint */}
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              pointerEvents: "none",
              textAlign: "center",
              padding: "16px 24px",
              background:
                "linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 100%)",
            }}
          >
            <div
              style={{
                fontFamily: "Orbitron, sans-serif",
                fontSize: "1rem",
                color: "#00fff7",
                textShadow: "0 0 12px rgba(0,255,247,0.5)",
              }}
            >
              {film.title}
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "rgba(255,255,255,0.45)",
                marginTop: "4px",
              }}
            >
              {film.release_date
                ? new Date(film.release_date).getFullYear()
                : ""}{" "}
              {film.runtime ? `\u2022 ${film.runtime} min` : ""} {"\u2022"}{" "}
              {"\u2605"} {film.vote_average.toFixed(1)}
              <span
                style={{ marginLeft: "12px", color: "rgba(255,255,255,0.3)" }}
              >
                Solde: <span style={{ color: "#ffd700" }}>{credits}</span> cr
                {"\u00e9"}dit{credits > 1 ? "s" : ""}
              </span>
            </div>
            <div
              style={{
                marginTop: "6px",
                color: "rgba(255,255,255,0.3)",
                fontSize: "0.7rem",
                fontFamily: "sans-serif",
              }}
            >
              <strong>Clic</strong> - Retourner | <strong>Q</strong> /{" "}
              <strong>E</strong> - Tourner le bo{"\u00ee"}tier |{" "}
              <strong>ESC</strong> - Reposer
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
  );
}
