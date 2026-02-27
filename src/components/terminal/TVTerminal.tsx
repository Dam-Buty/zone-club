import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatTimeRemaining } from '../../utils/formatTime';
import { AuthModal } from '../auth/AuthModal';
import { SearchModal } from '../search/SearchModal';
import { ReviewModal } from '../review/ReviewModal';
import api, { type AdminStats, type FilmRequestWithUser, type ApiFilm, type TranscodeStatus } from '../../api';
import type { Film } from '../../types';
import styles from './TVTerminal.module.css';

interface TVTerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MenuSection = 'main' | 'rentals' | 'history' | 'credits' | 'account' | 'reviews' | 'admin' | 'admin-films' | 'admin-requests' | 'admin-add-film';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Niveau suivant et progression
function getLevelProgress(totalRentals: number): { current: string; next: string | null; progress: number } {
  if (totalRentals >= 50) return { current: 'platine', next: null, progress: 100 };
  if (totalRentals >= 25) return { current: 'or', next: 'platine', progress: ((totalRentals - 25) / 25) * 100 };
  if (totalRentals >= 10) return { current: 'argent', next: 'or', progress: ((totalRentals - 10) / 15) * 100 };
  return { current: 'bronze', next: 'argent', progress: (totalRentals / 10) * 100 };
}

export function TVTerminal({ isOpen, onClose }: TVTerminalProps) {
  const isMobile = useIsMobile();
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [currentSection, setCurrentSection] = useState<MenuSection>('main');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Admin state
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminFilms, setAdminFilms] = useState<ApiFilm[]>([]);
  const [adminRequests, setAdminRequests] = useState<FilmRequestWithUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [addFilmInput, setAddFilmInput] = useState('');
  const [addFilmError, setAddFilmError] = useState<string | null>(null);
  const [addFilmSuccess, setAddFilmSuccess] = useState(false);
  const [secretCode, setSecretCode] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [filmSearchQuery, setFilmSearchQuery] = useState('');
  const [transcodeStatuses, setTranscodeStatuses] = useState<Map<number, TranscodeStatus>>(new Map());

  // Review modal state
  const [reviewFilm, setReviewFilm] = useState<Film | null>(null);
  const [canReviewMap, setCanReviewMap] = useState<Map<number, boolean>>(new Map());

  const isAuthenticated = useStore(state => state.isAuthenticated);
  const authUser = useStore(state => state.authUser);
  const localUser = useStore(state => state.localUser);
  const logout = useStore(state => state.logout);
  const rentals = useStore(state => state.rentals);
  const rentalHistory = useStore(state => state.rentalHistory);
  const userReviews = useStore(state => state.userReviews);
  const films = useStore(state => state.films);
  const openPlayer = useStore(state => state.openPlayer);
  const closeTerminal = useStore(state => state.closeTerminal);
  const benchmarkEnabled = useStore(state => state.benchmarkEnabled);
  const setBenchmarkEnabled = useStore(state => state.setBenchmarkEnabled);
  const isZoomedOnTV = useStore(state => state.isZoomedOnTV);
  const terminalAdminMode = useStore(state => state.terminalAdminMode);

  // Utiliser authUser si connecté, sinon localUser
  const user = isAuthenticated && authUser
    ? {
        credits: authUser.credits,
        totalRentals: rentals.length + rentalHistory.length,
        level: localUser.level, // Le niveau est calculé localement
        badges: localUser.badges,
        username: authUser.username
      }
    : localUser;

  // Récupérer les infos des films depuis le cache
  const allFilms = Object.values(films).flat();
  const getFilmTitle = (filmId: number) => {
    const film = allFilms.find(f => f.id === filmId);
    return film?.title || `Film #${filmId}`;
  };

  // Auto-unlock admin when opened via settings menu admin code
  useEffect(() => {
    if (isOpen && terminalAdminMode && isAuthenticated && authUser?.is_admin) {
      setAdminUnlocked(true)
      setCurrentSection('admin')
      loadAdminStats()
    }
  }, [isOpen, terminalAdminMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Gérer le code secret "admin"
  useEffect(() => {
    if (!isOpen || !isAuthenticated || !authUser?.is_admin) return;

    const handleSecretKey = (e: KeyboardEvent) => {
      // Only track letters for secret code
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        const newCode = (secretCode + e.key.toLowerCase()).slice(-5); // Keep last 5 chars
        setSecretCode(newCode);

        if (newCode === 'admin') {
          setAdminUnlocked(true);
          setCurrentSection('admin');
          setSecretCode('');
          // Load admin stats
          loadAdminStats();
        }
      }
    };

    document.addEventListener('keydown', handleSecretKey);
    return () => document.removeEventListener('keydown', handleSecretKey);
  }, [isOpen, isAuthenticated, authUser, secretCode]);

  // Gérer les touches clavier (navigation)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentSection === 'main') {
          onClose();
        } else if (currentSection.startsWith('admin-')) {
          setCurrentSection('admin');
          setSelectedIndex(0);
        } else if (currentSection === 'admin') {
          setCurrentSection('main');
          setAdminUnlocked(false);
          setSelectedIndex(0);
        } else {
          setCurrentSection('main');
          setSelectedIndex(0);
        }
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(0, i - 1));
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => i + 1);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentSection === 'main') {
          const sections: MenuSection[] = ['rentals', 'history', 'reviews', 'credits', 'account'];
          if (selectedIndex < sections.length) {
            setCurrentSection(sections[selectedIndex]);
            setSelectedIndex(0);
          }
        } else if (currentSection === 'admin') {
          const adminSections: MenuSection[] = ['admin-add-film', 'admin-films', 'admin-requests'];
          if (selectedIndex < adminSections.length) {
            const target = adminSections[selectedIndex];
            setCurrentSection(target);
            setSelectedIndex(0);
            if (target === 'admin-films') { setFilmSearchQuery(''); loadAdminFilms(); }
            if (target === 'admin-requests') { loadAdminRequests(); }
            if (target === 'admin-add-film') { setAddFilmInput(''); setAddFilmError(null); }
          }
        } else {
          // In sub-sections, Enter goes back
          handleBack();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, currentSection, selectedIndex]);

  // Reset au montage
  useEffect(() => {
    if (isOpen) {
      setCurrentSection('main');
      setSelectedIndex(0);
      setSecretCode('');
      setAdminUnlocked(false);
    }
  }, [isOpen]);

  // Poll transcode status when on admin-films page
  useEffect(() => {
    if (currentSection !== 'admin-films' || !adminUnlocked) return;

    let active = true;
    const poll = async () => {
      try {
        const statuses = await api.admin.getTranscodeStatus();
        if (active) {
          const map = new Map<number, TranscodeStatus>();
          for (const s of statuses) map.set(s.id, s);
          setTranscodeStatuses(map);
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [currentSection, adminUnlocked]);

  // Check review eligibility for active rentals when entering rentals section
  useEffect(() => {
    if (currentSection !== 'rentals' || !isAuthenticated || rentals.length === 0) return;
    let active = true;
    const checkAll = async () => {
      const map = new Map<number, boolean>();
      for (const rental of rentals) {
        try {
          const data = await api.reviews.getByFilm(rental.filmId);
          if (active) map.set(rental.filmId, data.canReview.allowed);
        } catch {
          if (active) map.set(rental.filmId, false);
        }
      }
      if (active) setCanReviewMap(map);
    };
    checkAll();
    return () => { active = false; };
  }, [currentSection, isAuthenticated, rentals]);

  const handleMenuClick = useCallback((section: MenuSection) => {
    setCurrentSection(section);
    setSelectedIndex(0);
  }, []);

  const handleBack = useCallback(() => {
    if (currentSection.startsWith('admin-')) {
      setCurrentSection('admin');
    } else if (currentSection === 'admin') {
      setCurrentSection('main');
      setAdminUnlocked(false);
    } else {
      setCurrentSection('main');
    }
    setSelectedIndex(0);
  }, [currentSection]);

  // Admin functions
  const loadAdminStats = useCallback(async () => {
    setAdminLoading(true);
    try {
      const stats = await api.admin.getStats();
      setAdminStats(stats);
    } catch (err) {
      console.error('Error loading admin stats:', err);
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const loadAdminFilms = useCallback(async () => {
    setAdminLoading(true);
    try {
      const films = await api.admin.getAllFilms();
      setAdminFilms(films);
    } catch (err) {
      console.error('Error loading admin films:', err);
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const loadAdminRequests = useCallback(async () => {
    setAdminLoading(true);
    try {
      const requests = await api.admin.getRequests();
      setAdminRequests(requests);
    } catch (err) {
      console.error('Error loading admin requests:', err);
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const handleToggleFilmAvailability = useCallback(async (filmId: number, currentlyAvailable: boolean) => {
    try {
      await api.admin.setFilmAvailability(filmId, !currentlyAvailable);
      setAdminFilms(prev => prev.map(f =>
        f.id === filmId ? { ...f, is_available: !currentlyAvailable } : f
      ));
    } catch (err) {
      console.error('Error toggling availability:', err);
    }
  }, []);

  const handleDownloadFilm = useCallback(async (filmId: number) => {
    try {
      const { film } = await api.admin.downloadFilm(filmId);
      setAdminFilms(prev => prev.map(f =>
        f.id === filmId ? { ...f, radarr_vo_id: film.radarr_vo_id, radarr_vf_id: film.radarr_vf_id } : f
      ));
    } catch (err) {
      console.error('Error triggering download:', err);
    }
  }, []);

  const handleSetAisle = useCallback(async (filmId: number, aisle: string | null) => {
    try {
      await api.admin.setFilmAisle(filmId, { aisle });
      setAdminFilms(prev => prev.map(f =>
        f.id === filmId ? { ...f, aisle } : f
      ));
    } catch (err) {
      console.error('Error setting aisle:', err);
    }
  }, []);

  const handleToggleNouveaute = useCallback(async (filmId: number, current: boolean) => {
    try {
      await api.admin.setFilmAisle(filmId, { is_nouveaute: !current });
      setAdminFilms(prev => prev.map(f =>
        f.id === filmId ? { ...f, is_nouveaute: !current } : f
      ));
    } catch (err) {
      console.error('Error toggling nouveaute:', err);
    }
  }, []);

  const handleApproveRequest = useCallback(async (requestId: number, _tmdbId: number) => {
    try {
      await api.admin.updateRequestStatus(requestId, 'added');
      setAdminRequests(prev => prev.map(r =>
        r.id === requestId ? { ...r, status: 'added' as const } : r
      ));
      // Reload films
      loadAdminFilms();
    } catch (err) {
      console.error('Error approving request:', err);
    }
  }, [loadAdminFilms]);

  const handleRejectRequest = useCallback(async (requestId: number) => {
    try {
      await api.admin.updateRequestStatus(requestId, 'rejected');
      setAdminRequests(prev => prev.map(r =>
        r.id === requestId ? { ...r, status: 'rejected' as const } : r
      ));
    } catch (err) {
      console.error('Error rejecting request:', err);
    }
  }, []);

  const handleAddFilm = useCallback(async () => {
    const tmdbId = parseInt(addFilmInput.trim());
    if (isNaN(tmdbId) || tmdbId <= 0) {
      setAddFilmError('Veuillez entrer un ID TMDB valide');
      return;
    }

    setAdminLoading(true);
    setAddFilmError(null);
    setAddFilmSuccess(false);

    try {
      await api.admin.addFilm(tmdbId);
      setAddFilmSuccess(true);
      setAddFilmInput('');
      // Reload stats and films
      loadAdminStats();
      loadAdminFilms();
      setTimeout(() => setAddFilmSuccess(false), 3000);
    } catch (err) {
      setAddFilmError(err instanceof Error ? err.message : 'Erreur lors de l\'ajout');
    } finally {
      setAdminLoading(false);
    }
  }, [addFilmInput, loadAdminStats, loadAdminFilms]);

  if (!isOpen) return null;

  const levelProgress = getLevelProgress(user.totalRentals);

  const levelClass = {
    bronze: styles.levelBronze,
    argent: styles.levelArgent,
    or: styles.levelOr,
    platine: styles.levelPlatine,
  }[user.level];

  const content = (
    <div
      className={styles.overlay}
      onClick={onClose}
      style={isZoomedOnTV ? { background: 'rgba(0, 0, 0, 0.3)' } : undefined}
    >
      <div
        className={styles.terminal}
        onClick={e => e.stopPropagation()}
        style={isZoomedOnTV ? { background: 'rgba(10, 10, 10, 0.75)' } : undefined}
      >
        <div className={styles.header}>
          VIDEO CLUB TERMINAL v1.0
          <span className={styles.cursor} />
        </div>

        <div className={styles.content}>
          {currentSection === 'main' && (
            <ul className={styles.menu}>
              {/* Section authentification */}
              {!isAuthenticated ? (
                <li
                  className={`${styles.menuItem} ${styles.authItem} ${selectedIndex === 0 ? styles.selected : ''}`}
                  onClick={() => setShowAuthModal(true)}
                >
                  <span className={styles.prefix}>&gt;</span>
                  S'IDENTIFIER
                </li>
              ) : (
                <li
                  className={`${styles.menuItem} ${styles.userItem}`}
                >
                  <span className={styles.prefix}>@</span>
                  {authUser?.username}
                </li>
              )}
              <li
                className={`${styles.menuItem} ${selectedIndex === (isAuthenticated ? 0 : 1) ? styles.selected : ''}`}
                onClick={() => handleMenuClick('rentals')}
              >
                <span className={styles.prefix}>&gt;</span>
                MES LOCATIONS ({rentals.length})
              </li>
              <li
                className={`${styles.menuItem} ${selectedIndex === (isAuthenticated ? 1 : 2) ? styles.selected : ''}`}
                onClick={() => handleMenuClick('history')}
              >
                <span className={styles.prefix}>&gt;</span>
                HISTORIQUE
              </li>
              <li
                className={`${styles.menuItem} ${styles.reviewsItem} ${selectedIndex === (isAuthenticated ? 2 : 3) ? styles.selected : ''}`}
                onClick={() => handleMenuClick('reviews')}
              >
                <span className={styles.prefix}>&gt;</span>
                MES CRITIQUES ({userReviews.length})
              </li>
              <li
                className={`${styles.menuItem} ${selectedIndex === (isAuthenticated ? 3 : 4) ? styles.selected : ''}`}
                onClick={() => handleMenuClick('credits')}
              >
                <span className={styles.prefix}>&gt;</span>
                MES CREDITS
              </li>
              <li
                className={`${styles.menuItem} ${selectedIndex === (isAuthenticated ? 4 : 5) ? styles.selected : ''}`}
                onClick={() => handleMenuClick('account')}
              >
                <span className={styles.prefix}>&gt;</span>
                MON COMPTE
              </li>
              {/* Rechercher un film */}
              <li
                className={`${styles.menuItem} ${styles.searchItem}`}
                onClick={() => setShowSearchModal(true)}
              >
                <span className={styles.prefix}>&gt;</span>
                RECHERCHER UN FILM
              </li>
              {isAuthenticated && (
                <li
                  className={`${styles.menuItem} ${styles.logoutItem}`}
                  onClick={async () => {
                    await logout();
                    onClose();
                  }}
                >
                  <span className={styles.prefix}>&gt;</span>
                  SE DECONNECTER
                </li>
              )}
            </ul>
          )}

          {currentSection === 'rentals' && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={styles.sectionTitle}>MES LOCATIONS ACTIVES</div>
              {rentals.length === 0 ? (
                <div className={styles.emptyMessage}>Aucune location en cours</div>
              ) : (
                rentals.map(rental => (
                  <div key={rental.filmId} className={styles.rentalItem}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className={styles.rentalTitle}>{getFilmTitle(rental.filmId)}</div>
                        <div className={styles.rentalMeta}>
                          Loué le {formatDate(rental.rentedAt)} - {formatTimeRemaining(rental.expiresAt - Date.now())}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        {canReviewMap.get(rental.filmId) && (
                          <button
                            className={styles.reviewButton}
                            onClick={() => {
                              const film = allFilms.find(f => f.id === rental.filmId);
                              if (film) setReviewFilm(film);
                            }}
                          >
                            ★ CRITIQUER
                          </button>
                        )}
                        <button
                          className={styles.playButton}
                          onClick={() => {
                            closeTerminal();
                            openPlayer(rental.filmId);
                          }}
                        >
                          ▶ LIRE
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {currentSection === 'history' && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={styles.sectionTitle}>HISTORIQUE DES LOCATIONS</div>
              {rentalHistory.length === 0 ? (
                <div className={styles.emptyMessage}>Aucun historique disponible</div>
              ) : (
                rentalHistory.slice().reverse().map((entry, idx) => (
                  <div key={idx} className={styles.rentalItem}>
                    <div className={styles.rentalTitle}>{getFilmTitle(entry.filmId)}</div>
                    <div className={styles.rentalMeta}>
                      Loué le {formatDate(entry.rentedAt)} - Rendu le {formatDate(entry.returnedAt)}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {currentSection === 'credits' && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={styles.sectionTitle}>MES CREDITS</div>
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <div className={styles.infoValueLarge}>
                  {user.credits}
                </div>
                <div style={{ opacity: 0.7, marginTop: '10px' }}>
                  crédit{user.credits > 1 ? 's' : ''} disponible{user.credits > 1 ? 's' : ''}
                </div>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Niveau membre</span>
                <span className={`${styles.levelBadge} ${levelClass}`}>
                  {user.level.toUpperCase()}
                </span>
              </div>
              {levelProgress.next && (
                <div style={{ marginTop: '15px' }}>
                  <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                    Progression vers {levelProgress.next.toUpperCase()}
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${levelProgress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {currentSection === 'account' && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={styles.sectionTitle}>MON COMPTE</div>
              {isAuthenticated && authUser && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Utilisateur</span>
                  <span className={styles.infoValue}>{authUser.username}</span>
                </div>
              )}
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Niveau</span>
                <span className={`${styles.levelBadge} ${levelClass}`}>
                  {user.level.toUpperCase()}
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Total locations</span>
                <span className={styles.infoValue}>{user.totalRentals}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Crédits</span>
                <span className={styles.infoValue}>{user.credits}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Locations actives</span>
                <span className={styles.infoValue}>{rentals.length}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Critiques publiées</span>
                <span className={styles.infoValue}>{userReviews.length}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Benchmark WebGPU</span>
                <button
                  type="button"
                  className={`${styles.benchmarkToggle} ${benchmarkEnabled ? styles.benchmarkToggleOn : styles.benchmarkToggleOff}`}
                  onClick={() => setBenchmarkEnabled(!benchmarkEnabled)}
                >
                  {benchmarkEnabled ? 'ACTIF' : 'INACTIF'}
                </button>
              </div>
              <div className={styles.benchmarkHint}>
                Active le mode benchmark pour afficher les métriques FPS/frametime en superposition temps réel.
              </div>
              {user.badges.length > 0 && (
                <>
                  <div className={styles.sectionTitle} style={{ marginTop: '20px' }}>
                    BADGES
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {user.badges.map((badge, idx) => (
                      <span key={idx} className={styles.levelBadge} style={{ background: 'rgba(0,255,0,0.1)', border: '1px solid #00ff00' }}>
                        {badge}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {!isAuthenticated && (
                <div className={styles.emptyMessage} style={{ marginTop: '20px' }}>
                  Connectez-vous pour synchroniser vos données
                </div>
              )}
            </>
          )}

          {currentSection === 'reviews' && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={styles.sectionTitle}>MES CRITIQUES</div>
              {!isAuthenticated ? (
                <div className={styles.emptyMessage}>
                  Connectez-vous pour voir vos critiques
                </div>
              ) : userReviews.length === 0 ? (
                <div className={styles.emptyMessage}>
                  Vous n'avez pas encore publié de critique.<br />
                  Louez un film et critiquez-le pour gagner +1 crédit !
                </div>
              ) : (
                userReviews.map(review => (
                  <div key={review.id} className={styles.reviewItem}>
                    <div className={styles.reviewHeader}>
                      <div className={styles.reviewFilmTitle}>{getFilmTitle(review.film_id)}</div>
                      <div className={styles.reviewRating}>
                        ★ {review.average_rating.toFixed(1)}
                      </div>
                    </div>
                    <div className={styles.reviewRatings}>
                      <span>Réal: {review.rating_direction}/5</span>
                      <span>Scén: {review.rating_screenplay}/5</span>
                      <span>Jeu: {review.rating_acting}/5</span>
                    </div>
                    <div className={styles.reviewContent}>
                      {review.content.substring(0, 150)}...
                    </div>
                    <div className={styles.reviewDate}>
                      {formatDate(new Date(review.created_at).getTime())}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {/* ============ ADMIN SECTIONS ============ */}

          {currentSection === 'admin' && adminUnlocked && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={`${styles.sectionTitle} ${styles.adminTitle}`}>
                ★ ADMIN PANEL ★
              </div>

              {adminLoading ? (
                <div className={styles.emptyMessage}>CHARGEMENT...</div>
              ) : adminStats ? (
                <>
                  {/* Stats */}
                  <div className={styles.adminStats}>
                    <div className={styles.adminStatItem}>
                      <span className={styles.adminStatValue}>{adminStats.totalUsers}</span>
                      <span className={styles.adminStatLabel}>Utilisateurs</span>
                    </div>
                    <div className={styles.adminStatItem}>
                      <span className={styles.adminStatValue}>{adminStats.availableFilms}/{adminStats.totalFilms}</span>
                      <span className={styles.adminStatLabel}>Films dispo</span>
                    </div>
                    <div className={styles.adminStatItem}>
                      <span className={styles.adminStatValue}>{adminStats.activeRentals}</span>
                      <span className={styles.adminStatLabel}>Locations actives</span>
                    </div>
                    <div className={styles.adminStatItem}>
                      <span className={styles.adminStatValue}>{adminStats.pendingRequests}</span>
                      <span className={styles.adminStatLabel}>Demandes</span>
                    </div>
                  </div>

                  {/* Admin menu */}
                  <ul className={styles.menu} style={{ marginTop: '20px' }}>
                    <li
                      className={`${styles.menuItem} ${styles.adminMenuItem}`}
                      onClick={() => { setCurrentSection('admin-add-film'); setAddFilmInput(''); setAddFilmError(null); }}
                    >
                      <span className={styles.prefix}>+</span>
                      AJOUTER UN FILM (TMDB)
                    </li>
                    <li
                      className={`${styles.menuItem} ${styles.adminMenuItem}`}
                      onClick={() => { setCurrentSection('admin-films'); setFilmSearchQuery(''); loadAdminFilms(); }}
                    >
                      <span className={styles.prefix}>&gt;</span>
                      GERER LES FILMS ({adminStats.totalFilms})
                    </li>
                    <li
                      className={`${styles.menuItem} ${styles.adminMenuItem}`}
                      onClick={() => { setCurrentSection('admin-requests'); loadAdminRequests(); }}
                    >
                      <span className={styles.prefix}>&gt;</span>
                      DEMANDES EN ATTENTE ({adminStats.pendingRequests})
                    </li>
                  </ul>
                </>
              ) : (
                <div className={styles.emptyMessage}>Erreur de chargement</div>
              )}
            </>
          )}

          {currentSection === 'admin-add-film' && adminUnlocked && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={`${styles.sectionTitle} ${styles.adminTitle}`}>
                AJOUTER UN FILM
              </div>

              <div className={styles.adminForm}>
                <label className={styles.adminLabel}>ID TMDB du film :</label>
                <input
                  type="text"
                  value={addFilmInput}
                  onChange={(e) => setAddFilmInput(e.target.value)}
                  placeholder="Ex: 550 (Fight Club)"
                  className={styles.adminInput}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddFilm()}
                />
                <div className={styles.adminHint}>
                  Trouvez l'ID sur themoviedb.org dans l'URL du film
                </div>

                {addFilmError && (
                  <div className={styles.adminError}>{addFilmError}</div>
                )}

                {addFilmSuccess && (
                  <div className={styles.adminSuccess}>✓ Film ajouté avec succès !</div>
                )}

                <button
                  className={styles.adminButton}
                  onClick={handleAddFilm}
                  disabled={adminLoading || !addFilmInput.trim()}
                >
                  {adminLoading ? 'AJOUT...' : 'AJOUTER LE FILM'}
                </button>
              </div>
            </>
          )}

          {currentSection === 'admin-films' && adminUnlocked && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={`${styles.sectionTitle} ${styles.adminTitle}`}>
                GESTION DES FILMS
              </div>

              <input
                type="text"
                value={filmSearchQuery}
                onChange={(e) => setFilmSearchQuery(e.target.value)}
                placeholder="Rechercher un film..."
                className={styles.adminInput}
                style={{ marginBottom: '10px' }}
              />

              {adminLoading ? (
                <div className={styles.emptyMessage}>CHARGEMENT...</div>
              ) : adminFilms.length === 0 ? (
                <div className={styles.emptyMessage}>Aucun film dans le catalogue</div>
              ) : (
                adminFilms
                  .filter(f => !filmSearchQuery || f.title.toLowerCase().includes(filmSearchQuery.toLowerCase()))
                  .map(film => (
                  <div key={film.id} className={styles.adminFilmItem}>
                    <div className={styles.adminFilmInfo}>
                      <div className={styles.adminFilmTitle}>{film.title}</div>
                      <div className={styles.adminFilmMeta}>
                        ID: {film.tmdb_id} | {film.release_year || 'N/A'}
                      </div>
                    </div>
                    <div className={styles.adminFilmActions}>
                      <select
                        className={styles.adminAisleSelect}
                        value={film.aisle || ''}
                        onChange={(e) => handleSetAisle(film.id, e.target.value || null)}
                      >
                        <option value="">--</option>
                        <option value="action">ACTION</option>
                        <option value="horreur">HORREUR</option>
                        <option value="comedie">COMEDIE</option>
                        <option value="drame">DRAME</option>
                        <option value="thriller">THRILLER</option>
                        <option value="policier">POLICIER</option>
                        <option value="sf">SF</option>
                        <option value="animation">ANIMATION</option>
                        <option value="classiques">CLASSIQUES</option>
                      </select>
                      <button
                        className={`${styles.adminToggleBtn} ${film.is_nouveaute ? styles.adminToggleNew : styles.adminToggleOff}`}
                        onClick={() => handleToggleNouveaute(film.id, film.is_nouveaute)}
                      >
                        NEW
                      </button>
                      {(() => {
                        const ts = transcodeStatuses.get(film.id);
                        const hasRadarr = film.radarr_vo_id || film.radarr_vf_id;
                        const status = ts?.transcode_status;

                        if (!hasRadarr) {
                          return (
                            <button className={styles.adminDlBtn} onClick={() => handleDownloadFilm(film.id)}>
                              DL
                            </button>
                          );
                        }

                        if (status === 'transcoding' || status === 'remuxing') {
                          return (
                            <span className={styles.adminTranscoding}>
                              {Math.round(ts!.transcode_progress)}%
                            </span>
                          );
                        }

                        if (status === 'error') {
                          return (
                            <span className={styles.adminError} title={ts?.transcode_error || 'Erreur'}>
                              ERR
                            </span>
                          );
                        }

                        if (status === 'pending' || status === 'probing') {
                          return <span className={styles.adminPending}>...</span>;
                        }

                        if (!ts?.file_path_vo && !ts?.file_path_vf && !status) {
                          return <span className={styles.adminDownloading}>DL...</span>;
                        }

                        return (
                          <button
                            className={`${styles.adminToggleBtn} ${film.is_available ? styles.adminToggleOn : styles.adminToggleOff}`}
                            onClick={() => handleToggleFilmAvailability(film.id, film.is_available)}
                          >
                            {film.is_available ? 'DISPO' : 'MASQUÉ'}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {currentSection === 'admin-requests' && adminUnlocked && (
            <>
              <div className={styles.backButton} onClick={handleBack}>
                &lt; RETOUR
              </div>
              <div className={`${styles.sectionTitle} ${styles.adminTitle}`}>
                DEMANDES DE FILMS
              </div>

              {adminLoading ? (
                <div className={styles.emptyMessage}>CHARGEMENT...</div>
              ) : adminRequests.length === 0 ? (
                <div className={styles.emptyMessage}>Aucune demande</div>
              ) : (
                adminRequests.map(req => (
                  <div key={req.id} className={styles.adminRequestItem}>
                    <div className={styles.adminRequestInfo}>
                      <div className={styles.adminRequestTitle}>{req.title}</div>
                      <div className={styles.adminRequestMeta}>
                        TMDB: {req.tmdb_id} | Par: @{req.username}
                      </div>
                    </div>
                    {req.status === 'pending' ? (
                      <div className={styles.adminRequestActions}>
                        <button
                          className={styles.adminApproveBtn}
                          onClick={() => handleApproveRequest(req.id, req.tmdb_id)}
                        >
                          ✓
                        </button>
                        <button
                          className={styles.adminRejectBtn}
                          onClick={() => handleRejectRequest(req.id)}
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <span className={`${styles.adminRequestStatus} ${styles[`status_${req.status}`]}`}>
                        {req.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          {isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', width: '100%', paddingBottom: '60px' }}>
              {isAuthenticated && authUser?.is_admin && !adminUnlocked && (
                <button
                  onClick={() => secretInputRef.current?.focus()}
                  style={{
                    background: 'rgba(255, 68, 68, 0.2)',
                    border: '1px solid rgba(255, 68, 68, 0.5)',
                    color: '#ff4444',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontFamily: "'Courier New', monospace",
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  ⌨ Code
                </button>
              )}
            </div>
          ) : (
            <>[ESC] {currentSection === 'main' ? 'Fermer' : 'Retour'} | [↑↓] Naviguer | [ENTER] Sélectionner</>
          )}
          {/* Hidden input for mobile admin secret code */}
          {isMobile && isAuthenticated && authUser?.is_admin && !adminUnlocked && (
            <input
              ref={secretInputRef}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              style={{
                position: 'absolute',
                opacity: 0,
                width: '1px',
                height: '1px',
                pointerEvents: 'none',
              }}
              onInput={(e) => {
                const val = (e.target as HTMLInputElement).value.toLowerCase();
                if (val.endsWith('admin')) {
                  setAdminUnlocked(true);
                  setCurrentSection('admin');
                  setSecretCode('');
                  loadAdminStats();
                  (e.target as HTMLInputElement).value = '';
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );

  const dispatchKey = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  const mobileNavButtons = isMobile ? (
    <div style={{
      position: 'fixed', bottom: '2rem', left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex', gap: '12px', alignItems: 'center',
      zIndex: 200,
    }}>
      <button
        onTouchStart={(e) => { e.preventDefault(); dispatchKey('ArrowUp'); }}
        onClick={() => dispatchKey('ArrowUp')}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(0,0,0,0.7)', border: '2px solid #00ff00',
          color: '#00ff00', fontSize: '1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >▲</button>
      <button
        onTouchStart={(e) => { e.preventDefault(); dispatchKey('Enter'); }}
        onClick={() => dispatchKey('Enter')}
        style={{
          width: 72, height: 56, borderRadius: 12,
          background: 'rgba(0,255,0,0.15)', border: '2px solid #00ff00',
          color: '#00ff00', fontSize: '0.85rem', fontFamily: "'Courier New', monospace",
          fontWeight: 'bold', letterSpacing: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >OK</button>
      <button
        onTouchStart={(e) => { e.preventDefault(); dispatchKey('ArrowDown'); }}
        onClick={() => dispatchKey('ArrowDown')}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(0,0,0,0.7)', border: '2px solid #00ff00',
          color: '#00ff00', fontSize: '1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >▼</button>
      <button
        onTouchStart={(e) => { e.preventDefault(); dispatchKey('Escape'); }}
        onClick={() => dispatchKey('Escape')}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(0,0,0,0.7)', border: '2px solid #ff4444',
          color: '#ff4444', fontSize: '0.85rem', fontFamily: "'Courier New', monospace",
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >ESC</button>
    </div>
  ) : null;

  return (
    <>
      {createPortal(<>{content}{mobileNavButtons}</>, document.body)}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => setShowAuthModal(false)}
      />
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
      />
      <ReviewModal
        isOpen={!!reviewFilm}
        onClose={() => {
          setReviewFilm(null);
          // Refresh canReview after closing (review may have been submitted)
          setCanReviewMap(new Map());
        }}
        film={reviewFilm}
      />
    </>
  );
}
