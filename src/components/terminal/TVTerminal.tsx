import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { AuthModal } from '../auth/AuthModal';
import { SearchModal } from '../search/SearchModal';
import api, { type AdminStats, type FilmRequestWithUser, type ApiFilm } from '../../api';
import styles from './TVTerminal.module.css';

interface TVTerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

type MenuSection = 'main' | 'rentals' | 'history' | 'credits' | 'account' | 'reviews' | 'admin' | 'admin-films' | 'admin-requests' | 'admin-add-film';

// Formater une durée en texte lisible
function formatTimeRemaining(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expiré';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}j ${hours % 24}h restantes`;
  if (hours > 0) return `${hours}h restantes`;
  return 'Moins d\'une heure';
}

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

  const {
    isAuthenticated,
    authUser,
    localUser,
    getCredits,
    logout,
    rentals,
    rentalHistory,
    userReviews,
    films,
    openPlayer,
    closeTerminal
  } = useStore();

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
        setSelectedIndex(i => Math.max(0, i - 1));
      }
      if (e.key === 'ArrowDown') {
        setSelectedIndex(i => i + 1);
      }
      if (e.key === 'Enter' && currentSection === 'main') {
        const sections: MenuSection[] = ['rentals', 'history', 'reviews', 'credits', 'account'];
        if (selectedIndex < sections.length) {
          setCurrentSection(sections[selectedIndex]);
          setSelectedIndex(0);
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

  const handleApproveRequest = useCallback(async (requestId: number, tmdbId: number) => {
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.terminal} onClick={e => e.stopPropagation()}>
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
                          Loué le {formatDate(rental.rentedAt)} - {formatTimeRemaining(rental.expiresAt)}
                        </div>
                      </div>
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
                      onClick={() => { setCurrentSection('admin-films'); loadAdminFilms(); }}
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

              {adminLoading ? (
                <div className={styles.emptyMessage}>CHARGEMENT...</div>
              ) : adminFilms.length === 0 ? (
                <div className={styles.emptyMessage}>Aucun film dans le catalogue</div>
              ) : (
                adminFilms.map(film => (
                  <div key={film.id} className={styles.adminFilmItem}>
                    <div className={styles.adminFilmInfo}>
                      <div className={styles.adminFilmTitle}>{film.title}</div>
                      <div className={styles.adminFilmMeta}>
                        ID: {film.tmdb_id} | {film.release_year || 'N/A'}
                      </div>
                    </div>
                    <button
                      className={`${styles.adminToggleBtn} ${film.is_available ? styles.adminToggleOn : styles.adminToggleOff}`}
                      onClick={() => handleToggleFilmAvailability(film.id, film.is_available)}
                    >
                      {film.is_available ? 'DISPO' : 'MASQUÉ'}
                    </button>
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
          [ESC] {currentSection === 'main' ? 'Fermer' : 'Retour'} | [↑↓] Naviguer | [ENTER] Sélectionner
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(content, document.body)}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => setShowAuthModal(false)}
      />
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
      />
    </>
  );
}
