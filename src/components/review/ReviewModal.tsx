import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import api, { type ReviewsResponse, type ReviewWithUser } from '../../api';
import type { Film } from '../../types';
import styles from './ReviewModal.module.css';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  film: Film | null;
}

const MIN_CONTENT_LENGTH = 500;

function extractPullQuote(text: string): { quote: string; rest: string } | null {
  const match = text.match(/^(.+?[.!?])\s/);
  if (match && match[1].length >= 40 && match[1].length <= 200) {
    return { quote: match[1], rest: text.slice(match[0].length) };
  }
  return null;
}

interface ReviewReaderProps {
  review: ReviewWithUser;
  filmTitle: string;
  totalReviews: number;
  currentIndex: number;
  onNavigate: (dir: -1 | 1) => void;
  onClose: () => void;
}

// Full-page review reader — magazine editorial style
function ReviewReader({ review, filmTitle, totalReviews, currentIndex, onNavigate, onClose }: ReviewReaderProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowLeft' && currentIndex > 0) { e.preventDefault(); onNavigate(-1); }
      if (e.key === 'ArrowRight' && currentIndex < totalReviews - 1) { e.preventDefault(); onNavigate(1); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onNavigate, currentIndex, totalReviews]);

  const avgRating = review.average_rating.toFixed(1);
  const date = new Date(review.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const pullQuoteData = extractPullQuote(review.content);
  const bodyText = pullQuoteData ? pullQuoteData.rest : review.content;
  const firstLetter = bodyText.charAt(0);
  const restOfBody = bodyText.slice(1);

  const ratings = [
    { label: 'Réalisation', value: review.rating_direction },
    { label: 'Scénario', value: review.rating_screenplay },
    { label: 'Jeu d\'acteur', value: review.rating_acting },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.readerModal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.readerClose} onClick={onClose} title="Fermer (Esc)">✕</button>

        <div className={styles.readerContent}>
          <div className={styles.readerKicker}>CRITIQUE</div>
          <div className={styles.readerFilmTitle}>{filmTitle}</div>
          <div className={styles.readerByline}>par @{review.username}</div>
          <div className={styles.readerDate}>{date}</div>

          <div className={styles.readerGradientRule} />

          {/* Score + rating bars */}
          <div className={styles.readerScoreSection}>
            <div className={styles.readerScoreBlock}>
              <span className={styles.readerScoreValue}>{avgRating}</span>
              <span className={styles.readerScoreLabel}>/5</span>
            </div>
            <div className={styles.readerRatings}>
              {ratings.map((r) => (
                <div key={r.label} className={styles.readerRatingRow}>
                  <span className={styles.readerRatingLabel}>{r.label}</span>
                  <div className={styles.readerRatingBarBg}>
                    <div
                      className={styles.readerRatingBarFill}
                      style={{ width: `${(r.value / 5) * 100}%` }}
                    />
                  </div>
                  <span className={styles.readerRatingValue}>{r.value}/5</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pull quote */}
          {pullQuoteData && (
            <div className={styles.readerPullQuote}>
              &laquo;&nbsp;{pullQuoteData.quote}&nbsp;&raquo;
            </div>
          )}

          <div className={styles.readerThinRule} />

          {/* Body with drop cap */}
          <div className={styles.readerBody}>
            <span className={styles.readerDropCap}>{firstLetter}</span>
            {restOfBody}
          </div>
        </div>

        {/* Navigation */}
        <div className={styles.readerNav}>
          <button
            className={styles.readerNavBtn}
            onClick={() => onNavigate(-1)}
            disabled={currentIndex === 0}
          >
            ◄
          </button>
          <span className={styles.readerNavCounter}>{currentIndex + 1}/{totalReviews}</span>
          <button
            className={styles.readerNavBtn}
            onClick={() => onNavigate(1)}
            disabled={currentIndex === totalReviews - 1}
          >
            ►
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReviewModal({ isOpen, onClose, film }: ReviewModalProps) {
  const [content, setContent] = useState('');
  const [ratingDirection, setRatingDirection] = useState(3);
  const [ratingScreenplay, setRatingScreenplay] = useState(3);
  const [ratingActing, setRatingActing] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [readingReview, setReadingReview] = useState<ReviewWithUser | null>(null);

  const isAuthenticated = useStore(state => state.isAuthenticated);
  const authUser = useStore(state => state.authUser);
  const addCredits = useStore(state => state.addCredits);

  // Load reviews and check if user can review
  useEffect(() => {
    if (isOpen && film) {
      setLoading(true);
      api.reviews.getByFilm(film.id).then((data) => {
        setReviewsData(data);
        // Check if current user already has a review → edit mode
        if (authUser && data.reviews.length > 0) {
          const userReview = data.reviews.find((r: ReviewWithUser) => r.user_id === authUser.id);
          if (userReview) {
            setEditMode(true);
            setContent(userReview.content);
            setRatingDirection(userReview.rating_direction);
            setRatingScreenplay(userReview.rating_screenplay);
            setRatingActing(userReview.rating_acting);
          }
        }
        setLoading(false);
      }).catch((err) => {
        console.error(err);
        setLoading(false);
      });
    }
  }, [isOpen, film, authUser]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!film || !isAuthenticated) return;

    if (content.length < MIN_CONTENT_LENGTH) {
      setError(`La critique doit faire au moins ${MIN_CONTENT_LENGTH} caractères (${content.length}/${MIN_CONTENT_LENGTH})`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const reviewData = {
        content,
        rating_direction: ratingDirection,
        rating_screenplay: ratingScreenplay,
        rating_acting: ratingActing,
      };
      if (editMode) {
        await api.reviews.update(film.id, reviewData);
      } else {
        await api.reviews.create(film.id, reviewData);
        addCredits(1); // +1 credit only on creation
      }
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la publication');
    } finally {
      setSubmitting(false);
    }
  }, [film, isAuthenticated, content, ratingDirection, ratingScreenplay, ratingActing, addCredits, editMode]);

  const handleClose = useCallback(() => {
    setContent('');
    setRatingDirection(3);
    setRatingScreenplay(3);
    setRatingActing(3);
    setError(null);
    setSuccess(false);
    setReviewsData(null);
    setEditMode(false);
    setReadingReview(null);
    onClose();
  }, [onClose]);

  if (!isOpen || !film) return null;

  const canReview = editMode || (reviewsData?.canReview?.allowed ?? false);
  const canReviewReason = editMode ? undefined : reviewsData?.canReview?.reason;

  const content_ui = (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          {editMode ? 'MODIFIER' : 'CRITIQUER'}: {film.title.toUpperCase().substring(0, 30)}
          <span className={styles.cursor} />
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>CHARGEMENT...</div>
          ) : success ? (
            <div className={styles.successBox}>
              <div className={styles.checkmark}>✓</div>
              <div>{editMode ? 'CRITIQUE MODIFIEE !' : 'CRITIQUE PUBLIEE !'}</div>
              {!editMode && <div className={styles.creditBonus}>+1 CREDIT</div>}
            </div>
          ) : !isAuthenticated ? (
            <div className={styles.notAllowed}>
              Vous devez etre connecte pour critiquer un film.
            </div>
          ) : !canReview ? (
            <div className={styles.notAllowed}>
              {canReviewReason || 'Vous ne pouvez pas critiquer ce film.'}
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Ratings */}
              <div className={styles.ratings}>
                <div className={styles.ratingRow}>
                  <span className={styles.ratingLabel} id="rating-direction">REALISATION</span>
                  <div className={styles.stars} role="radiogroup" aria-labelledby="rating-direction">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingDirection ? styles.active : ''}`}
                        onClick={() => setRatingDirection(n)}
                        aria-label={`${n} sur 5`}
                        aria-pressed={n === ratingDirection}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.ratingRow}>
                  <span className={styles.ratingLabel} id="rating-screenplay">SCENARIO</span>
                  <div className={styles.stars} role="radiogroup" aria-labelledby="rating-screenplay">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingScreenplay ? styles.active : ''}`}
                        onClick={() => setRatingScreenplay(n)}
                        aria-label={`${n} sur 5`}
                        aria-pressed={n === ratingScreenplay}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.ratingRow}>
                  <span className={styles.ratingLabel} id="rating-acting">JEU D'ACTEUR</span>
                  <div className={styles.stars} role="radiogroup" aria-labelledby="rating-acting">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingActing ? styles.active : ''}`}
                        onClick={() => setRatingActing(n)}
                        aria-label={`${n} sur 5`}
                        aria-pressed={n === ratingActing}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className={styles.textareaContainer}>
                <textarea
                  className={styles.textarea}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Ecrivez votre critique ici (minimum 500 caractères)..."
                  rows={8}
                />
                <div className={`${styles.charCount} ${content.length >= MIN_CONTENT_LENGTH ? styles.valid : ''}`}>
                  {content.length}/{MIN_CONTENT_LENGTH}
                </div>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="submit"
                className={styles.submitButton}
                disabled={submitting || content.length < MIN_CONTENT_LENGTH}
              >
                {submitting ? 'PUBLICATION...' : editMode ? 'MODIFIER' : 'PUBLIER (+1 CREDIT)'}
              </button>
            </form>
          )}

          {/* Existing reviews */}
          {reviewsData && reviewsData.reviews.length > 0 && (
            <div className={styles.existingReviews}>
              <div className={styles.reviewsTitle}>
                CRITIQUES ({reviewsData.reviews.length})
                {reviewsData.ratings && (
                  <span className={styles.avgRating}>
                    Moyenne: {reviewsData.ratings.overall.toFixed(1)}/5
                  </span>
                )}
              </div>
              {reviewsData.reviews.map((review) => (
                <div
                  key={review.id}
                  className={styles.reviewItem}
                  onClick={() => setReadingReview(review)}
                  style={{ cursor: 'pointer' }}
                  title="Cliquer pour lire la critique"
                >
                  <div className={styles.reviewHeader}>
                    <span className={styles.reviewAuthor}>@{review.username}</span>
                    <span className={styles.reviewRating}>★ {review.average_rating.toFixed(1)}</span>
                  </div>
                  <div className={styles.reviewContent}>
                    {review.content.length > 288
                      ? review.content.substring(0, 288) + '...'
                      : review.content}
                  </div>
                  <div className={styles.readMore}>LIRE →</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          [ESC] Fermer{editMode ? '' : ' | Critique = +1 credit'}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      {content_ui}
      {readingReview && reviewsData && (
        <ReviewReader
          review={readingReview}
          filmTitle={film.title}
          totalReviews={reviewsData.reviews.length}
          currentIndex={reviewsData.reviews.findIndex((r) => r.id === readingReview.id)}
          onNavigate={(dir) => {
            const idx = reviewsData.reviews.findIndex((r) => r.id === readingReview.id);
            const next = reviewsData.reviews[idx + dir];
            if (next) setReadingReview(next);
          }}
          onClose={() => setReadingReview(null)}
        />
      )}
    </>,
    document.body,
  );
}
