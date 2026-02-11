import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import api, { type ReviewsResponse } from '../../api';
import type { Film } from '../../types';
import styles from './ReviewModal.module.css';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  film: Film | null;
}

const MIN_CONTENT_LENGTH = 500;

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

  const { isAuthenticated, addCredits } = useStore();

  // Load reviews and check if user can review
  useEffect(() => {
    if (isOpen && film) {
      setLoading(true);
      api.reviews.getByFilm(film.id).then((data) => {
        setReviewsData(data);
        setLoading(false);
      }).catch((err) => {
        console.error(err);
        setLoading(false);
      });
    }
  }, [isOpen, film]);

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
      await api.reviews.create(film.id, {
        content,
        rating_direction: ratingDirection,
        rating_screenplay: ratingScreenplay,
        rating_acting: ratingActing,
      });
      setSuccess(true);
      addCredits(1); // +1 credit locally
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la publication');
    } finally {
      setSubmitting(false);
    }
  }, [film, isAuthenticated, content, ratingDirection, ratingScreenplay, ratingActing, addCredits]);

  const handleClose = useCallback(() => {
    setContent('');
    setRatingDirection(3);
    setRatingScreenplay(3);
    setRatingActing(3);
    setError(null);
    setSuccess(false);
    setReviewsData(null);
    onClose();
  }, [onClose]);

  if (!isOpen || !film) return null;

  const canReview = reviewsData?.canReview?.allowed ?? false;
  const canReviewReason = reviewsData?.canReview?.reason;

  const content_ui = (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          CRITIQUER: {film.title.toUpperCase().substring(0, 30)}
          <span className={styles.cursor} />
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>CHARGEMENT...</div>
          ) : success ? (
            <div className={styles.successBox}>
              <div className={styles.checkmark}>✓</div>
              <div>CRITIQUE PUBLIEE !</div>
              <div className={styles.creditBonus}>+1 CREDIT</div>
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
                  <span className={styles.ratingLabel}>REALISATION</span>
                  <div className={styles.stars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingDirection ? styles.active : ''}`}
                        onClick={() => setRatingDirection(n)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.ratingRow}>
                  <span className={styles.ratingLabel}>SCENARIO</span>
                  <div className={styles.stars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingScreenplay ? styles.active : ''}`}
                        onClick={() => setRatingScreenplay(n)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.ratingRow}>
                  <span className={styles.ratingLabel}>JEU D'ACTEUR</span>
                  <div className={styles.stars}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`${styles.star} ${n <= ratingActing ? styles.active : ''}`}
                        onClick={() => setRatingActing(n)}
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
                {submitting ? 'PUBLICATION...' : 'PUBLIER (+1 CREDIT)'}
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
              {reviewsData.reviews.slice(0, 3).map((review) => (
                <div key={review.id} className={styles.reviewItem}>
                  <div className={styles.reviewHeader}>
                    <span className={styles.reviewAuthor}>@{review.username}</span>
                    <span className={styles.reviewRating}>★ {review.average_rating.toFixed(1)}</span>
                  </div>
                  <div className={styles.reviewContent}>
                    {review.content.substring(0, 200)}...
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          [ESC] Fermer | Critique = +1 credit
        </div>
      </div>
    </div>
  );

  return createPortal(content_ui, document.body);
}
