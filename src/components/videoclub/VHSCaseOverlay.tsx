import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDrag } from "@use-gesture/react";
import { useStore } from "../../store";
import { tmdb, type TMDBVideo } from "../../services/tmdb";
import api, { type FilmWithRentalStatus } from "../../api";
import { AuthModal } from "../auth/AuthModal";
import { ReviewModal } from "../review/ReviewModal";
import {
  RENTAL_COSTS,
  RENTAL_DURATIONS,
  type Film,
  type RentalTier,
  type CreditPerson,
  type DetailedCredits,
  type PersonDetail,
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
  if (remaining <= 0) return "EXPIRÉ";
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
    padding: "14px 24px",
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(8px)",
    border: `1px solid ${borderColor}`,
    borderRadius: "6px",
    color: textColor,
    fontFamily: "Orbitron, sans-serif",
    fontSize: "1.05rem",
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

// Tutorial annotation label (shown next to buttons during tutorial K7 demo)
const tutorialAnnotation: React.CSSProperties = {
  fontSize: "0.6rem",
  color: "#00e5ff",
  fontFamily: "Orbitron, sans-serif",
  textAlign: "center",
  letterSpacing: "1.5px",
  padding: "0 8px",
  textShadow: "0 0 8px rgba(0,229,255,0.4)",
  opacity: 0.9,
  textTransform: "uppercase",
};

// Shared styles for credit labels/values (used as fallback when detailed credits not loaded)
const creditLabelStyle: React.CSSProperties = {
  fontFamily: "Orbitron, sans-serif",
  fontSize: "1.02rem",
  color: "rgba(255,255,255,0.55)",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
};

const creditValueStyle: React.CSSProperties = {
  fontSize: "1.13rem",
  color: "rgba(255,255,255,0.7)",
  marginTop: "4px",
  lineHeight: 1.4,
};

// Clickable credit section
function CreditSection({ label, persons, showCharacter, onSelect }: {
  label: string;
  persons: CreditPerson[];
  showCharacter?: boolean;
  onSelect: (p: CreditPerson) => void;
}) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={creditLabelStyle}>{label}</div>
      <div style={{ marginTop: "4px", lineHeight: 1.6 }}>
        {persons.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <span style={{ color: "rgba(255,255,255,0.25)" }}>{showCharacter ? " · " : ", "}</span>}
            <span
              onClick={() => onSelect(p)}
              style={{
                fontSize: "1.13rem",
                color: "#00d4cc",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#00fff7")}
              onMouseLeave={e => (e.currentTarget.style.color = "#00d4cc")}
            >
              {p.name}
            </span>
            {showCharacter && p.character && (
              <span style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.5)", marginLeft: "4px" }}>
                ({p.character})
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// Person detail modal
function PersonModal({ person, detail, loading, onClose }: {
  person: CreditPerson;
  detail: PersonDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const photoUrl = person.profile_path
    ? `https://image.tmdb.org/t/p/w342${person.profile_path}`
    : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        zIndex: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "700px",
          width: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "rgba(8,8,18,0.98)",
          border: "1px solid rgba(0,255,247,0.25)",
          borderRadius: "12px",
          padding: "32px",
          position: "relative",
          boxShadow: "0 0 40px rgba(0,255,247,0.08)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "14px",
            right: "16px",
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: "1.3rem",
            cursor: "pointer",
            fontFamily: "Orbitron, sans-serif",
            padding: "4px 8px",
          }}
        >
          X
        </button>

        {/* Header: photo + name */}
        <div style={{ display: "flex", gap: "22px", marginBottom: "20px" }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={person.name}
              style={{
                width: "120px",
                height: "180px",
                objectFit: "cover",
                borderRadius: "8px",
                flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            />
          ) : (
            <div style={{
              width: "120px",
              height: "180px",
              borderRadius: "8px",
              flexShrink: 0,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "2.5rem",
              color: "rgba(255,255,255,0.15)",
            }}>
              ?
            </div>
          )}
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{
              fontFamily: "Orbitron, sans-serif",
              fontSize: "1.2rem",
              color: "#00fff7",
              textShadow: "0 0 10px rgba(0,255,247,0.4)",
              lineHeight: 1.3,
              marginBottom: "10px",
            }}>
              {person.name}
            </div>
            {loading ? (
              <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.3)" }}>Chargement...</div>
            ) : detail && (
              <>
                {detail.birthday && (
                  <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", marginBottom: "4px" }}>
                    Né{detail.deathday ? "" : "(e)"} le {detail.birthday}
                    {detail.deathday && <span> — déc. {detail.deathday}</span>}
                  </div>
                )}
                {detail.place_of_birth && (
                  <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>
                    {detail.place_of_birth}
                  </div>
                )}
                {detail.known_for_department && (
                  <div style={{ fontSize: "0.72rem", color: "rgba(0,212,204,0.6)", fontFamily: "Orbitron, sans-serif", letterSpacing: "1px", textTransform: "uppercase", marginTop: "4px" }}>
                    {detail.known_for_department}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Biography */}
        {!loading && detail?.biography && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "0 0 16px" }} />
            <div style={{
              fontFamily: "Orbitron, sans-serif",
              fontSize: "0.7rem",
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginBottom: "10px",
            }}>
              Biographie
            </div>
            <div style={{
              fontFamily: "sans-serif",
              fontSize: "0.88rem",
              color: "rgba(255,255,255,0.72)",
              lineHeight: 1.7,
              whiteSpace: "pre-line",
            }}>
              {detail.biography}
            </div>
          </>
        )}

        {!loading && detail && !detail.biography && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "0 0 16px" }} />
            <div style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
              Aucune biographie disponible.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function VHSCaseOverlay({ film, isOpen, onClose }: VHSCaseOverlayProps) {
  const isMobile = useIsMobile();
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const films = useStore((state) => state.films);
  const selectFilm = useStore((state) => state.selectFilm);
  const setVHSNavDirection = useStore((state) => state.setVHSNavDirection);
  const getCredits = useStore((state) => state.getCredits);
  const getRental = useStore((state) => state.getRental);
  const storeRentFilm = useStore((state) => state.rentFilm);
  const storeReturnFilm = useStore((state) => state.returnFilm);
  const storeRequestReturn = useStore((state) => state.requestReturn);
  const storeSetViewingMode = useStore((state) => state.setViewingMode);
  const storeExtendRental = useStore((state) => state.extendRental);
  const fetchMe = useStore((state) => state.fetchMe);
  const openPlayer = useStore((state) => state.openPlayer);
  const showManager = useStore((state) => state.showManager);
  const pushEvent = useStore((state) => state.pushEvent);
  const hasSeenSwipeHint = useStore((state) => state.hasSeenVHSSwipeHint);
  const setHasSeenSwipeHint = useStore((state) => state.setHasSeenVHSSwipeHint);
  const tutorialStep = useStore((state) => state.tutorialStep);
  const isTutorialActive = tutorialStep !== null;

  const [isRenting, setIsRenting] = useState(false);
  const [rentSuccess, setRentSuccess] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [loadingTrailer, setLoadingTrailer] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [settingMode, setSettingMode] = useState(false);
  const [showCouchPopup, setShowCouchPopup] = useState(false);
  const [returning, setReturning] = useState(false);
  const [requestingReturn, setRequestingReturn] = useState(false);
  const [returnRequested, setReturnRequested] = useState(false);
  const [filmRentalStatus, setFilmRentalStatus] = useState<FilmWithRentalStatus['rental_status'] | null>(null);
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const [earlyReturnBonus, setEarlyReturnBonus] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extensionSuccess, setExtensionSuccess] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);

  // Navigation bounce state (desktop)
  const [bounceLeft, setBounceLeft] = useState(false);
  const [bounceRight, setBounceRight] = useState(false);

  // Tutorial step 3: cycling highlight on buttons
  const TUTORIAL_HIGHLIGHT_TARGETS = ['credits', 'louer', 'trailer', 'gerant'] as const;
  type TutorialHighlightTarget = typeof TUTORIAL_HIGHLIGHT_TARGETS[number];
  const [tutorialHighlight, setTutorialHighlight] = useState<TutorialHighlightTarget>('credits');

  // Mobile tutorial expand indicator auto-hide
  const [showMobileTutorialExpand, setShowMobileTutorialExpand] = useState(true);

  // Prev/next film navigation (circular within same aisle)
  const { prevFilm, nextFilm } = useMemo(() => {
    if (!film) return { prevFilm: null, nextFilm: null };
    for (const aisleFilms of Object.values(films)) {
      const idx = aisleFilms.findIndex(f => f.id === film.id);
      if (idx !== -1) {
        return {
          prevFilm: aisleFilms[(idx - 1 + aisleFilms.length) % aisleFilms.length],
          nextFilm: aisleFilms[(idx + 1) % aisleFilms.length],
        };
      }
    }
    return { prevFilm: null, nextFilm: null };
  }, [film, films]);

  // Mobile swipe navigation via @use-gesture/react
  const bind = useDrag(
    ({ active, movement: [mx], velocity: [vx], axis, tap }) => {
      if (tap) {
        useStore.getState().requestVHSFlip();
        return;
      }
      if (axis !== 'x') return;

      const store = useStore.getState();
      if (active) {
        store.setVhsSwipeState(true, mx);
      } else {
        const shouldNavigate = Math.abs(mx) > 80 || Math.abs(vx) > 0.5;
        if (shouldNavigate) {
          // Inverted: swipe right (mx > 0) = next film, swipe left (mx < 0) = prev film
          if (mx > 0 && nextFilm) {
            store.setVHSNavDirection('left');
            selectFilm(nextFilm.id);
          } else if (mx < 0 && prevFilm) {
            store.setVHSNavDirection('right');
            selectFilm(prevFilm.id);
          }
        }
        store.setVhsSwipeState(false, 0);
      }
    },
    {
      axis: 'lock',
      threshold: 10,
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  // Bottom sheet vertical drag to expand/collapse (tracked)
  // dragExtra = extra px of height added during drag (positive = taller sheet)
  const [dragExtra, setDragExtra] = useState(0);
  const bindSheet = useDrag(
    ({ active, movement: [, my], velocity: [, vy], tap }) => {
      if (tap) return;
      if (active) {
        // -my: dragging up → positive (add height), dragging down → negative (reduce height)
        const extra = -my;
        const maxExtra = window.innerHeight * 0.41;
        const clamped = Math.max(mobileExpanded ? -maxExtra : 0, Math.min(extra, mobileExpanded ? 0 : maxExtra));
        setDragExtra(clamped);
      } else {
        const shouldToggle = Math.abs(my) > 60 || Math.abs(vy) > 0.3;
        if (shouldToggle) {
          if (my < 0 && !mobileExpanded) setMobileExpanded(true);
          else if (my > 0 && mobileExpanded) setMobileExpanded(false);
        }
        setDragExtra(0);
      }
    },
    {
      axis: 'y',
      threshold: 10,
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  // Drag progress ratio (0 = collapsed, 1 = expanded)
  // When collapsed and dragging up: dragExtra goes 0 → maxExtra → progress 0→1
  // When expanded and dragging down: dragExtra goes 0 → -maxExtra → progress 1→0
  const maxDragPx = typeof window !== 'undefined' ? window.innerHeight * 0.41 : 300;
  const dragProgress = mobileExpanded
    ? Math.max(0, Math.min(1, 1 + dragExtra / maxDragPx))
    : Math.max(0, Math.min(1, dragExtra / maxDragPx));
  // Effective expanded state: fully expanded OR dragging past threshold
  const showEnrichedContent = mobileExpanded || dragExtra > 0;

  // Certification + TMDB reviews + budget
  const [certification, setCertification] = useState("");
  const [tmdbReviews, setTmdbReviews] = useState<{ author: string; content: string }[]>([]);
  const [budget, setBudget] = useState<number>(0);
  const [revenue, setRevenue] = useState<number>(0);

  // Detailed credits + person modal
  const [detailedCredits, setDetailedCredits] = useState<DetailedCredits | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<CreditPerson | null>(null);
  const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
  const [loadingPerson, setLoadingPerson] = useState(false);

  // Live countdown timer
  const [countdown, setCountdown] = useState("");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const couchPopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Fetch detailed rental status (with stock info) when overlay opens
  useEffect(() => {
    if (!isOpen || !film?.tmdb_id) {
      setFilmRentalStatus(null);
      return;
    }
    api.films.getById(film.tmdb_id).then(data => {
      setFilmRentalStatus(data.rental_status);
    }).catch(() => {});
  }, [isOpen, film?.tmdb_id]);

  // Fetch detailed credits, certification, and TMDB reviews when overlay opens
  useEffect(() => {
    if (!isOpen || !film?.tmdb_id) {
      setDetailedCredits(null);
      setCertification("");
      setTmdbReviews([]);
      setBudget(0);
      setRevenue(0);
      return;
    }
    const id = film.tmdb_id;
    tmdb.getDetailedCredits(id).then(setDetailedCredits).catch(e => console.warn('Credits fetch failed:', e));
    tmdb.getCertification(id).then(c => { console.log(`[VHS] Certification for tmdb_id=${id}:`, JSON.stringify(c)); setCertification(c); }).catch(e => console.warn('Certification fetch failed:', e));
    tmdb.getReviews(id).then(setTmdbReviews).catch(e => console.warn('Reviews fetch failed:', e));
    tmdb.getFilm(id).then(d => { setBudget((d as any).budget || 0); setRevenue((d as any).revenue || 0); }).catch(() => {});
  }, [isOpen, film?.tmdb_id]);

  // Fetch person detail when a person is selected
  useEffect(() => {
    if (!selectedPerson) {
      setPersonDetail(null);
      return;
    }
    setLoadingPerson(true);
    tmdb.getPerson(selectedPerson.id).then(d => {
      setPersonDetail(d);
      setLoadingPerson(false);
    }).catch(() => setLoadingPerson(false));
  }, [selectedPerson]);

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
      setShowCouchPopup(false);
      setReturning(false);
      setRequestingReturn(false);
      setReturnRequested(false);
      setShowReturnConfirm(false);
      setEarlyReturnBonus(false);
      setExtending(false);
      setExtensionSuccess(false);
      setMobileExpanded(false);
      setSelectedPerson(null);
      setPersonDetail(null);
      setDetailedCredits(null);
      setCertification("");
      setTmdbReviews([]);
      setBudget(0);
      setRevenue(0);
      if (couchPopupTimeoutRef.current) {
        clearTimeout(couchPopupTimeoutRef.current);
        couchPopupTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (couchPopupTimeoutRef.current) {
        clearTimeout(couchPopupTimeoutRef.current);
      }
    };
  }, []);

  const showCouchMeetingPopup = useCallback(() => {
    setShowCouchPopup(true);
    if (couchPopupTimeoutRef.current) clearTimeout(couchPopupTimeoutRef.current);
    couchPopupTimeoutRef.current = setTimeout(() => {
      setShowCouchPopup(false);
      couchPopupTimeoutRef.current = null;
    }, 2600);
  }, []);

  // Swipe hint — show once on first mobile VHS open
  useEffect(() => {
    if (!isOpen || !isMobile || hasSeenSwipeHint) {
      setShowSwipeHint(false);
      return;
    }
    const showTimer = setTimeout(() => setShowSwipeHint(true), 800);
    const hideTimer = setTimeout(() => {
      setShowSwipeHint(false);
      setHasSeenSwipeHint(true);
    }, 4800);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [isOpen, isMobile, hasSeenSwipeHint, setHasSeenSwipeHint]);

  // Tutorial step 3: cycle highlight through button targets every 2s
  useEffect(() => {
    if (tutorialStep !== 3) {
      setTutorialHighlight('credits');
      return;
    }
    const interval = setInterval(() => {
      setTutorialHighlight(prev => {
        const idx = TUTORIAL_HIGHLIGHT_TARGETS.indexOf(prev);
        return TUTORIAL_HIGHLIGHT_TARGETS[(idx + 1) % TUTORIAL_HIGHLIGHT_TARGETS.length];
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [tutorialStep]);

  // Mobile tutorial expand indicator: auto-hide after 3s or when expanded
  useEffect(() => {
    if (!isTutorialActive || !isMobile) return;
    setShowMobileTutorialExpand(true);
    const timer = setTimeout(() => setShowMobileTutorialExpand(false), 3000);
    return () => clearTimeout(timer);
  }, [isTutorialActive, isMobile]);

  useEffect(() => {
    if (mobileExpanded) setShowMobileTutorialExpand(false);
  }, [mobileExpanded]);

  // ESC key to close overlay
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        if (selectedPerson) {
          setSelectedPerson(null);
        } else if (showReturnConfirm) {
          setShowReturnConfirm(false);
        } else if (showTrailer) {
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
  }, [isOpen, onClose, showTrailer, showAuthModal, showReviewModal, selectedPerson, showReturnConfirm]);

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
    pushEvent(`Le client demande l'avis du manager sur "${film.title}" (id:${film.id}, tmdb:${film.tmdb_id}).`);
    onClose();
    showManager();
  }, [film, onClose, showManager, pushEvent]);

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
      // Show success briefly, then auto-set viewing mode to sur_place
      setTimeout(async () => {
        setRentSuccess(false);
        setIsRenting(false);
        // Auto-set viewing mode without user choice
        setSettingMode(true);
        const updatedRental = await storeSetViewingMode(film.id, 'sur_place');
        setSettingMode(false);
        if (updatedRental) {
          showCouchMeetingPopup();
        }
      }, 1500);
    } else {
      setIsRenting(false);
    }
  }, [film, isAuthenticated, credits, isRenting, getRental, storeRentFilm, storeSetViewingMode, showCouchMeetingPopup]);

  const handleSetViewingMode = useCallback(async () => {
    if (!film || settingMode) return;

    setSettingMode(true);
    const updatedRental = await storeSetViewingMode(film.id, 'sur_place');
    setSettingMode(false);
    if (!updatedRental) return;

    // Don't open player directly; invite user to sit on the couch first.
    showCouchMeetingPopup();
  }, [film, settingMode, storeSetViewingMode, showCouchMeetingPopup]);

  const handleSitDown = useCallback(() => {
    if (!film) return;
    onClose();
    openPlayer(film.id);
  }, [film, onClose, openPlayer]);

  const handleReturnClick = useCallback(() => {
    setShowReturnConfirm(true);
  }, []);

  const handleReturnConfirm = useCallback(async () => {
    if (!film || returning) return;
    setReturning(true);
    setShowReturnConfirm(false);
    const result = await storeReturnFilm(film.id);
    setReturning(false);
    if (result) {
      if (result.earlyReturnCredit) {
        setEarlyReturnBonus(true);
        setTimeout(() => {
          setEarlyReturnBonus(false);
          onClose();
        }, 2200);
      } else {
        onClose();
      }
    }
  }, [film, returning, storeReturnFilm, onClose]);

  const handleRequestReturn = useCallback(async () => {
    if (!film || requestingReturn || returnRequested) return;
    setRequestingReturn(true);
    const success = await storeRequestReturn(film.id);
    setRequestingReturn(false);
    if (success) {
      setReturnRequested(true);
    }
  }, [film, requestingReturn, returnRequested, storeRequestReturn]);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
    handleRent();
  }, [handleRent]);

  const handleExtend = useCallback(async () => {
    if (!film || extending) return;
    setExtending(true);
    const result = await storeExtendRental(film.id);
    setExtending(false);
    if (result) {
      setExtensionSuccess(true);
      await fetchMe();
      setTimeout(() => setExtensionSuccess(false), 2500);
    }
  }, [film, extending, storeExtendRental, fetchMe]);

  if (!isOpen || !film) return null;

  const tier = getRentalTier(film);
  const cost = RENTAL_COSTS[tier];
  const duration = RENTAL_DURATIONS[tier];
  const canAfford = credits >= cost;

  // Early return eligibility: within 24h of rental start
  const isWithinEarlyReturn = rental
    ? (Date.now() - rental.rentedAt) <= 24 * 60 * 60 * 1000
    : false;

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

  // Rewind status tag (desktop)
  function renderDesktopRewindStatus() {
    if (!isRented || !rental) return null;
    if (rental.rewindClaimed) {
      return (
        <div style={{
          padding: "8px 14px",
          background: "rgba(76,175,80,0.12)",
          border: "1px solid rgba(76,175,80,0.4)",
          borderRadius: "4px",
          color: "#4caf50",
          fontFamily: "Orbitron, sans-serif",
          fontSize: "0.82rem",
          letterSpacing: "0.5px",
          textAlign: "center",
        }}>
          ✓ REMBOBINE (+1 cr.)
        </div>
      );
    }
    if (rental.watchProgress >= 80) {
      return (
        <div style={{
          padding: "8px 14px",
          background: "rgba(255,152,0,0.1)",
          border: "1px solid rgba(255,152,0,0.35)",
          borderRadius: "4px",
          color: "#ff9800",
          fontFamily: "Orbitron, sans-serif",
          fontSize: "0.78rem",
          letterSpacing: "0.5px",
          textAlign: "center",
          lineHeight: 1.4,
        }}>
          NON REMBOBINE — Regardez le film pour rembobiner (+1 cr.)
        </div>
      );
    }
    return null;
  }

  // Rewind status tag (mobile)
  function renderMobileRewindStatus() {
    if (!isRented || !rental) return null;
    if (rental.rewindClaimed) {
      return (
        <div style={mobilePillStyle("#4caf50", "#4caf50", {
          background: "rgba(76,175,80,0.12)",
          cursor: "default",
          fontSize: "0.58rem",
        })}>
          ✓ REMBOBINE (+1 cr.)
        </div>
      );
    }
    if (rental.watchProgress >= 80) {
      return (
        <div style={mobilePillStyle("#ff9800", "#ff9800", {
          background: "rgba(255,152,0,0.1)",
          cursor: "default",
          fontSize: "0.55rem",
        })}>
          NON REMBOBINE (+1 cr.)
        </div>
      );
    }
    return null;
  }

  // Extension button (desktop)
  function renderDesktopExtensionButton() {
    if (!isRented || !rental || rental.extensionUsed || credits < 1) return null;
    if (extensionSuccess) {
      return (
        <div style={{
          padding: "10px 14px",
          background: "rgba(255,215,0,0.12)",
          border: "1px solid rgba(255,215,0,0.4)",
          borderRadius: "4px",
          color: "#ffd700",
          fontFamily: "Orbitron, sans-serif",
          fontSize: "0.9rem",
          letterSpacing: "1px",
          textAlign: "center",
        }}>
          +48H ACCORDEES
        </div>
      );
    }
    return (
      <button
        onClick={handleExtend}
        disabled={extending}
        style={sideButtonStyle("#ffd700", "#ffd700", {
          width: "100%",
          justifyContent: "center",
          background: "rgba(255,215,0,0.1)",
          cursor: extending ? "wait" : "pointer",
          opacity: extending ? 0.6 : 1,
        })}
      >
        {extending ? "PROLONGATION..." : "PROLONGER +48H (1 cr.)"}
      </button>
    );
  }

  // Extension button (mobile)
  function renderMobileExtensionButton() {
    if (!isRented || !rental || rental.extensionUsed || credits < 1) return null;
    if (extensionSuccess) {
      return (
        <div style={mobilePillStyle("#ffd700", "#ffd700", {
          background: "rgba(255,215,0,0.12)",
          cursor: "default",
        })}>
          +48H
        </div>
      );
    }
    return (
      <button
        onClick={handleExtend}
        disabled={extending}
        style={mobilePillStyle("#ffd700", "#ffd700", {
          background: "rgba(255,215,0,0.1)",
          cursor: extending ? "wait" : "pointer",
          opacity: extending ? 0.6 : 1,
        })}
      >
        {extending ? "..." : "+48H (1 cr.)"}
      </button>
    );
  }

  // Shared return button for desktop (used in all rented sub-states)
  function renderDesktopReturnButton() {
    return (
      <button
        onClick={handleReturnClick}
        disabled={returning}
        style={sideButtonStyle("#ff6600", "#ff6600", {
          width: "100%",
          justifyContent: "center",
          background: "rgba(255,102,0,0.12)",
          cursor: returning ? "wait" : "pointer",
          opacity: returning ? 0.6 : 1,
        })}
      >
        {returning ? "RETOUR..." : "RETOURNER LA K7"}
      </button>
    );
  }

  // Desktop rental buttons
  function renderDesktopRentalSection() {
    // ---- STATE 3: User has rented this film ----
    if (isRented && rental) {
      // Status badge: "Déjà loué" + countdown
      const statusEl = (
        <div
          style={sideButtonStyle("#ffaa00", "#ffaa00", {
            width: "100%",
            background: "rgba(255,170,0,0.08)",
            cursor: "default",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "2px",
          })}
        >
          <span style={{ fontSize: "0.98rem", opacity: 0.7 }}>Déjà loué — expire dans</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{countdown}</span>
        </div>
      );

      // Early return hint
      const earlyHint = isWithinEarlyReturn ? (
        <div style={{ fontSize: "1.02rem", color: "#00ff88", fontFamily: "Orbitron, sans-serif", textAlign: "center", letterSpacing: "0.5px" }}>
          Retour sous 24h = +1 crédit bonus
        </div>
      ) : null;

      // No viewing mode yet — auto-setting in progress
      if (!rental.viewingMode) {
        return (
          <>
            {statusEl}
            {earlyHint}
            {renderDesktopRewindStatus()}
            {renderDesktopExtensionButton()}
            <button
              onClick={handleSetViewingMode}
              disabled={settingMode}
              style={sideButtonStyle("#00fff7", "#00fff7", {
                width: "100%",
                justifyContent: "center",
                background: "linear-gradient(135deg, rgba(0,255,247,0.2), rgba(0,170,255,0.2))",
                boxShadow: "0 0 12px rgba(0,255,247,0.25)",
              })}
            >
              {settingMode ? "PRÉPARATION..." : "▶ REGARDER"}
            </button>
            {renderDesktopReturnButton()}
          </>
        );
      }

      // Viewing mode set (sur_place) — show watch button
      return (
        <>
          {statusEl}
          {earlyHint}
          {renderDesktopRewindStatus()}
          {renderDesktopExtensionButton()}
          <button
            onClick={handleSitDown}
            style={sideButtonStyle("#00fff7", "#ffffff", {
              width: "100%",
              justifyContent: "center",
              background: "linear-gradient(135deg, rgba(0,255,247,0.3), rgba(0,200,255,0.3))",
              boxShadow: "0 0 16px rgba(0,255,247,0.35)",
              fontSize: "1.28rem",
            })}
          >
            🛋️ S'INSTALLER ET REGARDER
          </button>
          {renderDesktopReturnButton()}
        </>
      );
    }

    // ---- STATE 2: No copies available ----
    if (filmRentalStatus && filmRentalStatus.available_copies <= 0) {
      return (
        <>
          <div
            style={sideButtonStyle("#ff3333", "#ff3333", {
              width: "100%",
              justifyContent: "center",
              cursor: "default",
              background: "rgba(255,51,51,0.1)",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
            })}
          >
            <span>AUCUNE K7 DISPONIBLE</span>
            {filmRentalStatus.earliest_return && (
              <span style={{ fontSize: "1.02rem", color: "#ffaa00", fontVariantNumeric: "tabular-nums" }}>
                Retour dans {formatCountdown(new Date(filmRentalStatus.earliest_return + 'Z').getTime())}
              </span>
            )}
          </div>
          <button
            onClick={handleRequestReturn}
            disabled={requestingReturn || returnRequested}
            style={sideButtonStyle("#00fff7", "#00fff7", {
              width: "100%",
              justifyContent: "center",
              background: "rgba(0,255,247,0.12)",
              boxShadow: "0 0 12px rgba(0,255,247,0.2)",
              cursor: returnRequested ? "default" : "pointer",
              opacity: returnRequested ? 0.6 : 1,
            })}
          >
            {returnRequested ? "NOTIFICATION ENVOYÉE ✓" : requestingReturn ? "ENVOI..." : "NOTIFIER UN LOCATAIRE"}
          </button>
        </>
      );
    }

    // ---- STATE 1: Copies available ----
    return (
      <>
        <div style={{ fontSize: "1.08rem", color: "#00ff88", fontFamily: "Orbitron, sans-serif", textAlign: "center", letterSpacing: "0.5px" }}>
          K7 DISPONIBLE
        </div>
        <button
          onClick={handleRent}
          disabled={isAuthenticated && (!canAfford || isRenting)}
          style={sideButtonStyle(rentBorderColor, rentTextColor, {
            width: "100%",
            justifyContent: "center",
            background: rentBg,
            cursor: rentCursor,
            boxShadow: rentShadow,
          })}
        >
          {rentLabel}
        </button>
      </>
    );
  }

  // Mobile rental buttons
  function renderMobileRentalSection() {
    // ---- STATE 3: User has rented ----
    if (isRented && rental) {
      const timerEl = (
        <div
          style={mobilePillStyle("#ffaa00", "#ffaa00", {
            background: "rgba(255,170,0,0.08)",
            cursor: "default",
          })}
        >
          ⏱ {countdown}
        </div>
      );

      const returnBtn = (
        <button
          onClick={handleReturnClick}
          disabled={returning}
          style={mobilePillStyle("#ff6600", "#ff6600", {
            background: "rgba(255,102,0,0.12)",
            cursor: returning ? "wait" : "pointer",
            opacity: returning ? 0.6 : 1,
          })}
        >
          {returning ? "RETOUR..." : "RETOURNER"}
        </button>
      );

      if (!rental.viewingMode) {
        return (
          <>
            {timerEl}
            {renderMobileRewindStatus()}
            {renderMobileExtensionButton()}
            <button
              onClick={handleSetViewingMode}
              disabled={settingMode}
              style={mobilePillStyle("#00fff7", "#00fff7", {
                background: "rgba(0,255,247,0.12)",
                boxShadow: "0 0 8px rgba(0,255,247,0.2)",
              })}
            >
              {settingMode ? "PRÉPARATION..." : "▶ REGARDER"}
            </button>
            {returnBtn}
          </>
        );
      }

      return (
        <>
          {timerEl}
          {renderMobileRewindStatus()}
          {renderMobileExtensionButton()}
          <button
            onClick={handleSitDown}
            style={mobilePillStyle("#00fff7", "#ffffff", {
              background: "rgba(0,255,247,0.2)",
              boxShadow: "0 0 10px rgba(0,255,247,0.3)",
            })}
          >
            🛋️ S'INSTALLER
          </button>
          {returnBtn}
        </>
      );
    }

    // ---- STATE 2: No copies available ----
    if (filmRentalStatus && filmRentalStatus.available_copies <= 0) {
      return (
        <>
          <div style={mobilePillStyle("#ff3333", "#ff3333", { cursor: "default", background: "rgba(255,51,51,0.1)" })}>
            AUCUNE K7
          </div>
          <button
            onClick={handleRequestReturn}
            disabled={requestingReturn || returnRequested}
            style={mobilePillStyle("#00fff7", "#00fff7", {
              background: "rgba(0,255,247,0.12)",
              opacity: returnRequested ? 0.6 : 1,
            })}
          >
            {returnRequested ? "ENVOYÉ ✓" : "NOTIFIER"}
          </button>
        </>
      );
    }

    // ---- STATE 1: Available ----
    return (
      <button
        onClick={handleRent}
        disabled={isAuthenticated && (!canAfford || isRenting)}
        style={mobilePillStyle(rentBorderColor, rentTextColor, {
          background: rentBg,
          cursor: rentCursor,
          boxShadow: rentShadow,
          fontSize: "0.75rem",
        })}
      >
        {!isAuthenticated ? "CONNEXION" : isRenting ? "LOCATION..." : canAfford ? (
          <>LOUER <span style={{ fontWeight: 700, color: "#00ff88" }}>{cost} cr.</span> — Solde: <span style={{ color: "#ffd700", fontWeight: 700 }}>{credits}</span></>
        ) : (
          <>PAS ASSEZ — Solde: <span style={{ color: "#ffd700", fontWeight: 700 }}>{credits}</span></>
        )}
      </button>
    );
  }

  return (
    <div style={{ pointerEvents: isTutorialActive ? 'none' : 'auto' }}>
      {/* Tutorial keyframes — shared for mobile + desktop */}
      {isTutorialActive && (
        <style>{`
          @keyframes tutorialGlow {
            0%, 100% { box-shadow: 0 0 0 2px rgba(0,229,255,0.0); }
            50% { box-shadow: 0 0 20px 4px rgba(0,229,255,0.6), 0 0 0 2px rgba(0,229,255,0.8); }
          }
          @keyframes tutorialNavPulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 12px rgba(255,215,0,0.15); }
            50% { transform: translate(-50%, -50%) scale(1.15); box-shadow: 0 0 24px rgba(255,215,0,0.6); }
          }
        `}</style>
      )}
      {/* Person detail modal */}
      {selectedPerson && (
        <PersonModal
          person={selectedPerson}
          detail={personDetail}
          loading={loadingPerson}
          onClose={() => setSelectedPerson(null)}
        />
      )}

      {/* Return confirmation modal */}
      {showReturnConfirm && (
        <div
          onClick={() => setShowReturnConfirm(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 210,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: isMobile ? "14px" : "18px",
              padding: isMobile ? "22px 18px" : "28px 36px",
              background: "rgba(10,10,20,0.95)",
              border: "1px solid rgba(255,102,0,0.4)",
              borderRadius: "12px",
              boxShadow: "0 0 30px rgba(255,102,0,0.15)",
              maxWidth: "360px",
              width: "90%",
            }}
          >
            <div style={{
              fontFamily: "Orbitron, sans-serif",
              fontSize: isMobile ? "0.82rem" : "0.95rem",
              color: "#ff6600",
              letterSpacing: "2px",
              textTransform: "uppercase",
              textShadow: "0 0 12px rgba(255,102,0,0.4)",
              textAlign: "center",
            }}>
              RETOURNER LA K7 ?
            </div>
            {isWithinEarlyReturn && (
              <div style={{
                fontSize: "0.75rem",
                color: "#00ff88",
                fontFamily: "Orbitron, sans-serif",
                textAlign: "center",
                lineHeight: 1.4,
              }}>
                Retour sous 24h : +1 crédit bonus
              </div>
            )}
            <div style={{ display: "flex", gap: isMobile ? "10px" : "14px", width: "100%" }}>
              <button
                onClick={handleReturnConfirm}
                disabled={returning}
                style={{
                  flex: 1,
                  padding: isMobile ? "12px 16px" : "14px 24px",
                  background: "linear-gradient(135deg, rgba(255,102,0,0.3), rgba(200,60,0,0.3))",
                  border: "1px solid #ff6600",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: isMobile ? "0.78rem" : "0.85rem",
                  cursor: returning ? "wait" : "pointer",
                  letterSpacing: "1px",
                  boxShadow: "0 0 12px rgba(255,102,0,0.2)",
                  transition: "all 0.2s",
                  opacity: returning ? 0.6 : 1,
                }}
              >
                {returning ? "RETOUR..." : "CONFIRMER"}
              </button>
              <button
                onClick={() => setShowReturnConfirm(false)}
                style={{
                  flex: 1,
                  padding: isMobile ? "12px 16px" : "14px 24px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  color: "rgba(255,255,255,0.5)",
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: isMobile ? "0.78rem" : "0.85rem",
                  cursor: "pointer",
                  letterSpacing: "1px",
                }}
              >
                ANNULER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Early return bonus overlay */}
      {earlyReturnBonus && (
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
              fontSize: isMobile ? "3rem" : "4rem",
              color: "#00ff88",
              textShadow: "0 0 30px #00ff88, 0 0 60px #00ff88",
            }}
          >
            +1
          </div>
          <div
            style={{
              fontFamily: "Orbitron, sans-serif",
              fontSize: isMobile ? "1.1rem" : "1.4rem",
              color: "#00fff7",
              textShadow: "0 0 20px #00fff7",
              marginTop: "0.8rem",
              letterSpacing: "4px",
              textAlign: "center",
            }}
          >
            BONUS RETOUR ANTICIPÉ
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.5)",
              marginTop: "0.4rem",
              fontSize: "0.85rem",
              fontFamily: "Orbitron, sans-serif",
            }}
          >
            +1 crédit
          </div>
        </div>
      )}

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
            ✓
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
            LOUÉ
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

      {/* Sur-place guidance popup */}
      {showCouchPopup && (
        <div
          style={{
            position: "fixed",
            top: isMobile ? "72px" : "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 240,
            padding: isMobile ? "10px 14px" : "12px 18px",
            borderRadius: "8px",
            border: "1px solid #00fff7",
            background: "rgba(0, 20, 28, 0.92)",
            color: "#00fff7",
            fontFamily: "Orbitron, sans-serif",
            fontSize: isMobile ? "0.72rem" : "0.82rem",
            letterSpacing: "0.8px",
            textAlign: "center",
            boxShadow: "0 0 18px rgba(0,255,247,0.28)",
            pointerEvents: "none",
            textTransform: "uppercase",
          }}
        >
          RDV sur le canapé pour regarder votre film
        </div>
      )}

      {/* ===== MOBILE LAYOUT ===== */}
      {isMobile ? (
        <>
          {/* Reposer button — floating top-right (hidden during tutorial step 2: K7-only view) */}
          {tutorialStep !== 2 && (
            <button
              data-vhs-overlay
              onClick={onClose}
              style={{
                position: "fixed",
                top: "16px",
                right: "16px",
                padding: "10px 16px",
                borderRadius: "12px",
                border: "2px solid #ff2d44",
                background: "rgba(180,20,40,0.35)",
                backdropFilter: "blur(8px)",
                color: "#ff4444",
                fontFamily: "Orbitron, sans-serif",
                fontSize: "0.68rem",
                letterSpacing: "1px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                zIndex: 101,
                boxShadow: "0 0 14px rgba(255,45,68,0.4)",
              }}
            >
              ↩ REPOSER
            </button>
          )}

          {/* Swipe navigation zone — @use-gesture drag detection (full screen during tutorial step 2) */}
          <div
            {...bind()}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: tutorialStep === 2 ? 0
                : dragExtra !== 0
                  ? `calc(${mobileExpanded ? 85 : 40}vh + ${dragExtra}px)`
                  : mobileExpanded ? "85vh" : "40vh",
              zIndex: 99,
              touchAction: "pan-y",
            }}
          />

          {/* Swipe hint — chevrons on each side of the VHS case, first time only */}
          {showSwipeHint && (
            <>
              <style>{`
                @keyframes swipeHintFadeIn {
                  from { opacity: 0; }
                  to { opacity: 1; }
                }
                @keyframes swipeChevronLeft {
                  0%, 100% { transform: translateX(0) translateY(-50%); opacity: 0.4; }
                  50% { transform: translateX(-10px) translateY(-50%); opacity: 1; }
                }
                @keyframes swipeChevronRight {
                  0%, 100% { transform: translateX(0) translateY(-50%); opacity: 0.4; }
                  50% { transform: translateX(10px) translateY(-50%); opacity: 1; }
                }
              `}</style>
              {/* Left chevron */}
              <div
                style={{
                  position: "fixed",
                  top: "28%",
                  left: "6%",
                  zIndex: 100,
                  pointerEvents: "none",
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: "2.2rem",
                  color: "rgba(255,215,0,0.85)",
                  textShadow: "0 0 14px rgba(255,215,0,0.5), 0 0 28px rgba(255,215,0,0.2)",
                  animation: "swipeHintFadeIn 0.5s ease-out, swipeChevronLeft 1.2s ease-in-out infinite",
                }}
              >
                ‹
              </div>
              {/* Right chevron */}
              <div
                style={{
                  position: "fixed",
                  top: "28%",
                  right: "6%",
                  zIndex: 100,
                  pointerEvents: "none",
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: "2.2rem",
                  color: "rgba(255,215,0,0.85)",
                  textShadow: "0 0 14px rgba(255,215,0,0.5), 0 0 28px rgba(255,215,0,0.2)",
                  animation: "swipeHintFadeIn 0.5s ease-out, swipeChevronRight 1.2s ease-in-out infinite",
                }}
              >
                ›
              </div>
            </>
          )}

          {/* Dimming overlay — only when expanded (hidden during tutorial step 2) */}
          {mobileExpanded && tutorialStep !== 2 && (
            <div style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: "25vh",
              background: "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)",
              pointerEvents: "none",
              zIndex: 99,
              transition: "opacity 0.3s",
            }} />
          )}

          {/* Retractable Bottom Sheet (hidden during tutorial step 2: K7-only view) */}
          {tutorialStep === 2 ? null :
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              maxHeight: dragExtra !== 0
                ? `calc(${mobileExpanded ? 85 : 40}vh + ${dragExtra}px)`
                : mobileExpanded ? "85vh" : "40vh",
              zIndex: 100,
              background: "rgba(8,8,18,0.96)",
              borderTop: "1px solid rgba(0,255,247,0.2)",
              borderRadius: "16px 16px 0 0",
              display: "flex",
              flexDirection: "column",
              transition: dragExtra !== 0 ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
              overflow: "hidden",
              paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            }}
          >
            {/* Tutorial mobile expand indicator */}
            {isTutorialActive && !mobileExpanded && showMobileTutorialExpand && (
              <>
                <style>{`
                  @keyframes tutorialExpandBounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                  }
                `}</style>
                <div style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '6px 0 0',
                  pointerEvents: 'none',
                }}>
                  <div style={{
                    animation: 'tutorialExpandBounce 1s ease-in-out infinite',
                    fontSize: '1.2rem',
                    color: '#00e5ff',
                    textShadow: '0 0 10px rgba(0,229,255,0.5)',
                  }}>▲</div>
                  <div style={{
                    fontFamily: "'Orbitron', monospace",
                    fontSize: '0.5rem',
                    color: 'rgba(0,229,255,0.7)',
                    letterSpacing: 1.5,
                    marginTop: 2,
                  }}>GLISSEZ VERS LE HAUT</div>
                </div>
              </>
            )}

            {/* Drag handle */}
            <div
              {...bindSheet()}
              style={{
                flexShrink: 0,
                display: "flex",
                justifyContent: "center",
                padding: "8px 0 4px",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              <div style={{
                width: "36px",
                height: "4px",
                borderRadius: "2px",
                background: "rgba(255,255,255,0.25)",
              }} />
            </div>

            {/* Header — title + meta (always visible) */}
            <div style={{ padding: "4px 16px 8px", flexShrink: 0 }}>
              <div style={{
                fontFamily: "Orbitron, sans-serif",
                fontSize: "1.18rem",
                color: "#00fff7",
                textShadow: "0 0 12px rgba(0,255,247,0.5)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {film.title}
              </div>
              <div style={{
                fontSize: "1.01rem",
                color: "rgba(255,255,255,0.45)",
                marginTop: "3px",
              }}>
                {film.release_date ? new Date(film.release_date).getFullYear() : ""}
                {film.runtime ? ` • ${film.runtime} min` : ""}
                {film.genres?.length ? ` • ${film.genres[0].name}` : ""}
                {certification && (
                  <span style={{
                    marginLeft: "8px",
                    padding: "2px 6px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    borderRadius: "3px",
                    fontSize: "0.79rem",
                    color: "rgba(255,255,255,0.7)",
                    fontWeight: 600,
                    verticalAlign: "middle",
                    letterSpacing: "0.5px",
                  }}>
                    {certification}
                  </span>
                )}
                <span style={{
                  marginLeft: "8px",
                  fontSize: "0.84rem",
                  color: "#ffd700",
                }}>
                  ★ {film.vote_average.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Action buttons — always visible, right after header */}
            <div style={{ padding: "4px 16px 8px", flexShrink: 0 }}>
              {/* Rental section */}
              <div style={{
                display: "flex", flexDirection: "column", gap: "6px",
                ...(tutorialStep === 3 && tutorialHighlight === 'credits' ? {
                  animation: 'tutorialGlow 1.5s ease-in-out infinite',
                  borderRadius: '8px',
                } : {}),
              }}>
                {renderMobileRentalSection()}
              </div>
              {/* Secondary buttons row */}
              <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                <button
                  onClick={handleWatchTrailer}
                  disabled={loadingTrailer}
                  style={mobilePillStyle("#ff4444", "#ff4444", {
                    opacity: loadingTrailer ? 0.6 : 1,
                    cursor: loadingTrailer ? "wait" : "pointer",
                    ...(tutorialStep === 3 && tutorialHighlight === 'louer' ? {
                      animation: 'tutorialGlow 1.5s ease-in-out infinite',
                    } : {}),
                  })}
                >
                  ▶ TRAILER
                </button>
                <button
                  onClick={() => setShowReviewModal(true)}
                  style={mobilePillStyle("#ffd700", "#ffd700", {
                    ...(tutorialStep === 3 && tutorialHighlight === 'trailer' ? {
                      animation: 'tutorialGlow 1.5s ease-in-out infinite',
                    } : {}),
                  })}
                >
                  ★ AVIS
                </button>
                <button
                  onClick={handleAskManager}
                  style={mobilePillStyle("#00fff7", "#00fff7", {
                    ...(tutorialStep === 3 && tutorialHighlight === 'gerant' ? {
                      animation: 'tutorialGlow 1.5s ease-in-out infinite',
                    } : {}),
                  })}
                >
                  ? GÉRANT
                </button>
              </div>
              {isRented && (
                <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                  <button
                    onClick={() => setShowReviewModal(true)}
                    style={mobilePillStyle("#ffd700", "#ffd700", { flex: "1 1 100%" })}
                  >
                    ★ CRITIQUER (+1 cr.)
                  </button>
                </div>
              )}
            </div>

            {/* Synopsis preview — progressively unclamped during drag */}
            {film.overview && (
              <div style={{
                padding: "6px 16px 4px",
                flexShrink: 0,
              }}>
                <div style={{
                  fontFamily: "sans-serif",
                  fontSize: "0.86rem",
                  color: `rgba(255,255,255,${0.55 + dragProgress * 0.15})`,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  ...(!mobileExpanded && dragProgress < 1 ? {
                    display: "-webkit-box" as const,
                    WebkitLineClamp: Math.max(2, Math.round(2 + dragProgress * 13)),
                    WebkitBoxOrient: "vertical" as const,
                  } : {}),
                }}>
                  {film.overview}
                </div>
              </div>
            )}

            {/* Toggle expand/collapse button */}
            <button
              onClick={() => setMobileExpanded(!mobileExpanded)}
              style={{
                flexShrink: 0,
                padding: "8px 16px",
                background: "rgba(0,255,247,0.06)",
                border: "none",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                borderBottom: mobileExpanded ? "1px solid rgba(255,255,255,0.08)" : "none",
                color: "#00fff7",
                fontFamily: "Orbitron, sans-serif",
                fontSize: "0.65rem",
                letterSpacing: "1.5px",
                cursor: "pointer",
                textAlign: "center",
                transition: "background 0.2s",
              }}
            >
              {mobileExpanded || showEnrichedContent ? "▲ MOINS" : "▼ PLUS D'INFOS"}
            </button>

            {/* Enriched content — visible when expanded or dragging */}
            {showEnrichedContent && (
              <div style={{
                flex: 1,
                overflowY: "auto",
                padding: "10px 16px",
                minHeight: 0,
                opacity: dragExtra !== 0 ? Math.max(0.3, dragProgress) : 1,
                transition: dragExtra !== 0 ? "none" : "opacity 0.3s",
              }}>

                {/* TMDB Reviews */}
                {tmdbReviews.length > 0 && (
                  <div style={{ marginBottom: "12px" }}>
                    <div style={creditLabelStyle}>Critiques</div>
                    {tmdbReviews.map((r, i) => (
                      <div key={i} style={{
                        marginTop: "6px",
                        padding: "6px 8px",
                        background: "rgba(255,255,255,0.03)",
                        borderLeft: "2px solid rgba(255,215,0,0.3)",
                        borderRadius: "0 4px 4px 0",
                      }}>
                        <div style={{
                          fontFamily: "sans-serif",
                          fontSize: "0.72rem",
                          color: "rgba(255,255,255,0.6)",
                          lineHeight: 1.5,
                          fontStyle: "italic",
                        }}>
                          &ldquo;{r.content}&rdquo;
                        </div>
                        <div style={{
                          fontSize: "0.65rem",
                          color: "rgba(255,215,0,0.5)",
                          marginTop: "3px",
                          textAlign: "right",
                        }}>
                          — {r.author}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Detailed credits sections */}
                {detailedCredits ? (
                  <>
                    {detailedCredits.directors.length > 0 && (
                      <CreditSection label="Réalisation" persons={detailedCredits.directors} onSelect={setSelectedPerson} />
                    )}
                    {detailedCredits.actors.length > 0 && (
                      <CreditSection label="Casting" persons={detailedCredits.actors} showCharacter onSelect={setSelectedPerson} />
                    )}
                    {detailedCredits.writers.length > 0 && (
                      <CreditSection label="Scénario" persons={detailedCredits.writers} onSelect={setSelectedPerson} />
                    )}
                    {detailedCredits.producers.length > 0 && (
                      <CreditSection label="Production" persons={detailedCredits.producers} onSelect={setSelectedPerson} />
                    )}
                    {detailedCredits.composer && (
                      <CreditSection label="Musique" persons={[detailedCredits.composer]} onSelect={setSelectedPerson} />
                    )}
                  </>
                ) : (
                  <>
                    {film.directors && film.directors.length > 0 && (
                      <div style={{ marginBottom: "8px" }}>
                        <span style={creditLabelStyle}>Réal</span>
                        <div style={creditValueStyle}>{film.directors.join(", ")}</div>
                      </div>
                    )}
                    {film.actors && film.actors.length > 0 && (
                      <div style={{ marginBottom: "8px" }}>
                        <span style={creditLabelStyle}>Casting</span>
                        <div style={creditValueStyle}>{film.actors.slice(0, 4).join(", ")}</div>
                      </div>
                    )}
                  </>
                )}

                {/* Budget & Revenue */}
                {(budget > 0 || revenue > 0) && (
                  <div style={{ marginBottom: "10px" }}>
                    <div style={creditLabelStyle}>Budget</div>
                    <div style={{ marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      {budget > 0 && (
                        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.55)" }}>
                          Budget : <span style={{ color: "#ffd700" }}>{(budget / 1_000_000).toFixed(0)}M $</span>
                        </span>
                      )}
                      {revenue > 0 && (
                        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.55)" }}>
                          Recettes : <span style={{ color: revenue > budget ? "#00ff88" : "#ff6666" }}>{(revenue / 1_000_000).toFixed(0)}M $</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          }
        </>
      ) : (
        /* ===== DESKTOP LAYOUT ===== */
        <>
          {/* Navigation arrows — positioned close to the VHS case */}
          {prevFilm && (
            <button
              data-vhs-overlay
              onClick={() => {
                setVHSNavDirection('right');
                selectFilm(prevFilm.id);
                setBounceLeft(true);
                setTimeout(() => setBounceLeft(false), 200);
              }}
              style={{
                position: "fixed",
                left: "calc(50% - 232px - 280px)",
                top: "50%",
                transform: bounceLeft ? "translate(-50%, -50%) scale(0.82)" : "translate(-50%, -50%) scale(1)",
                transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
                width: "96px",
                height: "96px",
                borderRadius: "50%",
                background: "rgba(0, 0, 0, 0.6)",
                border: "2px solid #ffd700",
                color: "#ffd700",
                fontFamily: "Orbitron, sans-serif",
                fontSize: "2.4rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                pointerEvents: "auto",
                zIndex: 100,
                boxShadow: "0 0 12px rgba(255, 215, 0, 0.15)",
                ...(tutorialStep === 2 ? { animation: 'tutorialNavPulse 1.4s ease-in-out infinite' } : {}),
              }}
              onMouseEnter={e => { if (tutorialStep === 2) return; e.currentTarget.style.background = "#ffd700"; e.currentTarget.style.color = "#000000"; e.currentTarget.style.boxShadow = "0 0 20px rgba(255, 215, 0, 0.35)"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.05)"; }}
              onMouseLeave={e => { if (tutorialStep === 2) return; e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)"; e.currentTarget.style.color = "#ffd700"; e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 215, 0, 0.15)"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)"; }}
            >
              ‹
            </button>
          )}
          {nextFilm && (
            <button
              data-vhs-overlay
              onClick={() => {
                setVHSNavDirection('left');
                selectFilm(nextFilm.id);
                setBounceRight(true);
                setTimeout(() => setBounceRight(false), 200);
              }}
              style={{
                position: "fixed",
                left: "calc(50% - 232px + 260px)",
                top: "50%",
                transform: bounceRight ? "translate(-50%, -50%) scale(0.82)" : "translate(-50%, -50%) scale(1)",
                transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
                width: "96px",
                height: "96px",
                borderRadius: "50%",
                background: "rgba(0, 0, 0, 0.6)",
                border: "2px solid #ffd700",
                color: "#ffd700",
                fontFamily: "Orbitron, sans-serif",
                fontSize: "2.4rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                pointerEvents: "auto",
                zIndex: 100,
                boxShadow: "0 0 12px rgba(255, 215, 0, 0.15)",
                ...(tutorialStep === 2 ? { animation: 'tutorialNavPulse 1.4s ease-in-out infinite' } : {}),
              }}
              onMouseEnter={e => { if (tutorialStep === 2) return; e.currentTarget.style.background = "#ffd700"; e.currentTarget.style.color = "#000000"; e.currentTarget.style.boxShadow = "0 0 20px rgba(255, 215, 0, 0.35)"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.05)"; }}
              onMouseLeave={e => { if (tutorialStep === 2) return; e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)"; e.currentTarget.style.color = "#ffd700"; e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 215, 0, 0.15)"; e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)"; }}
            >
              ›
            </button>
          )}

          {/* RIGHT PANEL — full-height info + actions */}
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "464px",
              zIndex: 100,
              pointerEvents: "auto",
              background: "rgba(0,0,0,0.88)",
              borderLeft: "1px solid rgba(0,255,247,0.15)",
              backdropFilter: "blur(12px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Close button — top, above title */}
            <button
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "14px 24px",
                margin: "16px 20px 0",
                background: "rgba(180,20,40,0.35)",
                border: "1px solid #ff2d44",
                borderRadius: "6px",
                color: "#ff4444",
                fontFamily: "Orbitron, sans-serif",
                fontSize: "0.9rem",
                cursor: "pointer",
                letterSpacing: "1.5px",
                flexShrink: 0,
                boxShadow: "0 0 14px rgba(255,45,68,0.3)",
                transition: "all 0.2s",
              }}
            >
              ✕ REPOSER SUR L'ÉTAGÈRE
            </button>

            {/* Section haute — Titre + meta */}
            <div style={{ padding: "16px 24px 16px", flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: "Orbitron, sans-serif",
                  fontSize: "1.5rem",
                  color: "#00fff7",
                  textShadow: "0 0 12px rgba(0,255,247,0.5)",
                  lineHeight: 1.3,
                }}
              >
                {film.title}
              </div>
              <div
                style={{
                  fontSize: "1.17rem",
                  color: "rgba(255,255,255,0.65)",
                  marginTop: "6px",
                }}
              >
                {film.release_date
                  ? new Date(film.release_date).getFullYear()
                  : ""}{" "}
                {film.runtime ? `• ${film.runtime} min` : ""}
                {film.genres?.length ? ` • ${film.genres[0].name}` : ""}
                {certification && (
                  <span style={{
                    marginLeft: "8px",
                    padding: "2px 6px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.45)",
                    borderRadius: "3px",
                    fontSize: "1.08rem",
                    color: "rgba(255,255,255,0.85)",
                    fontWeight: 600,
                    verticalAlign: "middle",
                    letterSpacing: "0.5px",
                  }}>
                    {certification}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: "1.17rem",
                  color: "rgba(255,255,255,0.65)",
                  marginTop: "3px",
                }}
              >
                ★ {film.vote_average.toFixed(1)}
                <span
                  style={{ marginLeft: "12px", color: "rgba(255,255,255,0.5)" }}
                >
                  Solde: <span style={{ color: "#ffd700" }}>{credits}</span> cr
édit{credits > 1 ? "s" : ""}
                </span>
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "0 24px" }} />

            {/* Section milieu — Synopsis + Credits (scrollable) */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 24px",
                minHeight: 0,
              }}
            >
              {film.overview && (
                <div style={{ marginBottom: "14px" }}>
                  <div
                    style={{
                      fontFamily: "Orbitron, sans-serif",
                      fontSize: "1.02rem",
                      color: "rgba(255,255,255,0.55)",
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      marginBottom: "6px",
                    }}
                  >
                    Synopsis
                  </div>
                  <div
                    style={{
                      fontFamily: "sans-serif",
                      fontSize: "1.2rem",
                      color: "rgba(255,255,255,0.85)",
                      lineHeight: 1.5,
                    }}
                  >
                    {film.overview}
                  </div>
                </div>
              )}

              {/* TMDB Reviews */}
              {tmdbReviews.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={creditLabelStyle}>Critiques</div>
                  {tmdbReviews.map((r, i) => (
                    <div key={i} style={{
                      marginTop: "8px",
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.03)",
                      borderLeft: "2px solid rgba(255,215,0,0.3)",
                      borderRadius: "0 4px 4px 0",
                    }}>
                      <div style={{
                        fontFamily: "sans-serif",
                        fontSize: "1.14rem",
                        color: "rgba(255,255,255,0.8)",
                        lineHeight: 1.5,
                        fontStyle: "italic",
                      }}>
                        "{r.content}"
                      </div>
                      <div style={{
                        fontSize: "1.02rem",
                        color: "rgba(255,215,0,0.7)",
                        marginTop: "4px",
                        textAlign: "right",
                      }}>
                        — {r.author}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Detailed credits sections */}
              {detailedCredits ? (
                <>
                  {detailedCredits.directors.length > 0 && (
                    <CreditSection label="Réalisation" persons={detailedCredits.directors} onSelect={setSelectedPerson} />
                  )}
                  {detailedCredits.actors.length > 0 && (
                    <CreditSection label="Casting" persons={detailedCredits.actors} showCharacter onSelect={setSelectedPerson} />
                  )}
                  {detailedCredits.writers.length > 0 && (
                    <CreditSection label="Scénario" persons={detailedCredits.writers} onSelect={setSelectedPerson} />
                  )}
                  {detailedCredits.producers.length > 0 && (
                    <CreditSection label="Production" persons={detailedCredits.producers} onSelect={setSelectedPerson} />
                  )}
                  {detailedCredits.composer && (
                    <CreditSection label="Musique" persons={[detailedCredits.composer]} onSelect={setSelectedPerson} />
                  )}
                </>
              ) : (
                <>
                  {film.directors && film.directors.length > 0 && (
                    <div style={{ marginBottom: "8px" }}>
                      <span style={creditLabelStyle}>Réal</span>
                      <div style={creditValueStyle}>{film.directors.join(", ")}</div>
                    </div>
                  )}
                  {film.actors && film.actors.length > 0 && (
                    <div style={{ marginBottom: "8px" }}>
                      <span style={creditLabelStyle}>Casting</span>
                      <div style={creditValueStyle}>{film.actors.slice(0, 4).join(", ")}</div>
                    </div>
                  )}
                </>
              )}

              {/* Budget & Revenue */}
              {(budget > 0 || revenue > 0) && (
                <div style={{ marginBottom: "10px" }}>
                  <div style={creditLabelStyle}>Budget</div>
                  <div style={{ marginTop: "4px", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    {budget > 0 && (
                      <span style={{ fontSize: "1.13rem", color: "rgba(255,255,255,0.7)" }}>
                        Budget : <span style={{ color: "#ffd700" }}>{(budget / 1_000_000).toFixed(0)}M $</span>
                      </span>
                    )}
                    {revenue > 0 && (
                      <span style={{ fontSize: "1.13rem", color: "rgba(255,255,255,0.7)" }}>
                        Recettes : <span style={{ color: revenue > budget ? "#00ff88" : "#ff6666" }}>{(revenue / 1_000_000).toFixed(0)}M $</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "0 24px" }} />

            {/* Section basse — Action buttons */}
            <div
              style={{
                padding: "16px 24px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                flexShrink: 0,
              }}
            >
              {/* Credits display + Rental section */}
              <div style={tutorialStep === 3 && tutorialHighlight === 'credits' ? {
                animation: 'tutorialGlow 1.5s ease-in-out infinite',
                borderRadius: '6px',
              } : undefined}>
                {renderDesktopRentalSection()}
              </div>
              {(tutorialStep === 2 || (tutorialStep === 3 && tutorialHighlight === 'credits')) && (
                <div style={tutorialAnnotation}>↑ LOUEZ — 1 A 2 CREDITS</div>
              )}

              <div style={tutorialStep === 3 && tutorialHighlight === 'louer' ? {
                animation: 'tutorialGlow 1.5s ease-in-out infinite',
                borderRadius: '6px',
              } : undefined}>
                <button
                  onClick={handleWatchTrailer}
                  disabled={loadingTrailer}
                  style={sideButtonStyle("#ff4444", "#ff4444", {
                    width: "100%",
                    justifyContent: "center",
                    opacity: loadingTrailer ? 0.6 : 1,
                    cursor: loadingTrailer ? "wait" : "pointer",
                  })}
                >
                  ▶ BANDE-ANNONCE
                </button>
              </div>
              {(tutorialStep === 2 || (tutorialStep === 3 && tutorialHighlight === 'louer')) && (
                <div style={tutorialAnnotation}>↑ BANDE-ANNONCE YOUTUBE</div>
              )}

              <div style={tutorialStep === 3 && tutorialHighlight === 'trailer' ? {
                animation: 'tutorialGlow 1.5s ease-in-out infinite',
                borderRadius: '6px',
              } : undefined}>
                <button
                  onClick={() => setShowReviewModal(true)}
                  style={sideButtonStyle("#ffd700", "#ffd700", {
                    width: "100%",
                    justifyContent: "center",
                  })}
                >
                  ★ AVIS DU CLUB
                </button>
              </div>
              {(tutorialStep === 2 || (tutorialStep === 3 && tutorialHighlight === 'trailer')) && (
                <div style={tutorialAnnotation}>↑ CRITIQUES DES MEMBRES</div>
              )}

              <div style={tutorialStep === 3 && tutorialHighlight === 'gerant' ? {
                animation: 'tutorialGlow 1.5s ease-in-out infinite',
                borderRadius: '6px',
              } : undefined}>
                <button
                  onClick={handleAskManager}
                  style={sideButtonStyle("#00fff7", "#00fff7", {
                    width: "100%",
                    justifyContent: "center",
                  })}
                >
                  ? DEMANDER AU GÉRANT
                </button>
              </div>
              {(tutorialStep === 2 || (tutorialStep === 3 && tutorialHighlight === 'gerant')) && (
                <div style={tutorialAnnotation}>↑ CONSEIL PERSONNALISE</div>
              )}

              {isRented && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  style={sideButtonStyle("#ffd700", "#ffd700", {
                    width: "100%",
                    justifyContent: "center",
                  })}
                >
                  ★ CRITIQUER (+1 cr.)
                </button>
              )}

            </div>
          </div>

          {/* Controls hint — bottom-left */}
          <div
            data-vhs-overlay
            style={{
              position: "fixed",
              bottom: "12px",
              left: "16px",
              zIndex: 100,
              pointerEvents: "none",
              color: "rgba(255,255,255,0.45)",
              fontSize: "1.05rem",
              fontFamily: "sans-serif",
            }}
          >
            <strong>Clic</strong> - Retourner | <strong>Q</strong> /{" "}
            <strong>E</strong> - Tourner le boîtier |{" "}
            <strong>ESC</strong> - Reposer
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
    </div>
  );
}
