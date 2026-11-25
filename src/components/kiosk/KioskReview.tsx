import { useId, useMemo, useState } from 'react';
import api from '../../api';
import { useStore } from '../../store';
import { REVIEW_MIN_LENGTH, REVIEW_RATING_LABELS, reviewFormCheck } from '../../utils/review-rules';
import styles from './KioskPanels.module.css';

// Écrire sa critique depuis « Mon compte » (docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 5) :
// trois notes nommées en entier, le texte, un compteur jusqu'à 144. Mêmes routes que le vidéoclub ; une critique
// déjà publiée s'ouvre en modification (une seule critique par film et par visiteur). « PUBLIER » ne se grise
// jamais : il dit ce qui manque.

interface KioskReviewProps {
  filmId: number;
  title: string;
  onDone: () => void;
  onBack: () => void;
}

type Ratings = [number, number, number];
const KEYS = ['direction', 'screenplay', 'acting'] as const;

function Star({ on }: { on: boolean }) {
  return (
    <svg className={on ? styles.kStarOn : styles.kStarOff} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z" />
    </svg>
  );
}

export function KioskReview({ filmId, title, onDone, onBack }: KioskReviewProps) {
  const fieldId = useId();
  const userReviews = useStore((state) => state.userReviews);
  const fetchMe = useStore((state) => state.fetchMe);
  const existing = useMemo(() => userReviews.find((r) => r.film_id === filmId) ?? null, [userReviews, filmId]);

  const [content, setContent] = useState(existing?.content ?? '');
  const [ratings, setRatings] = useState<Ratings>(
    existing ? [existing.rating_direction, existing.rating_screenplay, existing.rating_acting] : [0, 0, 0],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const length = content.trim().length;

  const publish = async () => {
    if (sending) return;
    const missing = reviewFormCheck({ length, ratings });
    if (missing) {
      setMessage(missing);
      return;
    }
    setSending(true);
    setMessage(null);
    const data = { content: content.trim(), rating_direction: ratings[0], rating_screenplay: ratings[1], rating_acting: ratings[2] };
    try {
      if (existing) await api.reviews.update(filmId, data);
      else await api.reviews.create(filmId, data);
      // Le compte (critique publiée, crédit gagné) est relu avant de revenir.
      await fetchMe();
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Publication impossible');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.kAuth}>
      <button type="button" className={styles.kAuthBack} onClick={onBack}>
        Retour
      </button>
      <h2 className={styles.kAuthTitle}>{existing ? 'Modifier ma critique' : 'Ma critique'}</h2>
      <p className={styles.kReviewFilm}>{title}</p>

      {KEYS.map((key, i) => (
        <div key={key} className={styles.kReviewRating} role="group" aria-label={`${REVIEW_RATING_LABELS[key]} : ${ratings[i]} sur 5`}>
          <span className={styles.kFieldLabel}>{REVIEW_RATING_LABELS[key]}</span>
          <span className={styles.kStars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={styles.kStarBtn}
                aria-label={`${n} sur 5`}
                aria-pressed={ratings[i] === n}
                onClick={() => {
                  setRatings((current) => {
                    const next = [...current] as Ratings;
                    next[i] = n;
                    return next;
                  });
                  setMessage(null);
                }}
              >
                <Star on={ratings[i] >= n} />
              </button>
            ))}
          </span>
        </div>
      ))}

      <label className={styles.kField} htmlFor={fieldId}>
        <span className={styles.kFieldLabel}>Votre critique</span>
        <textarea
          id={fieldId}
          className={`${styles.kInput} ${styles.kReviewText}`}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setMessage(null);
          }}
          placeholder={`Au moins ${REVIEW_MIN_LENGTH} caractères`}
          rows={6}
        />
      </label>
      <p className={`${styles.kReviewCount} ${length >= REVIEW_MIN_LENGTH ? styles.kReviewCountOk : ''}`}>
        {length} / {REVIEW_MIN_LENGTH}
      </p>

      {message && (
        <p className={styles.kAuthError} role="alert">
          {message}
        </p>
      )}

      <button type="button" className={styles.kAuthSubmit} aria-busy={sending} onClick={() => void publish()}>
        {sending ? 'Publication…' : 'Publier'}
        {existing ? null : <span className={styles.kReviewBonus}> · +1 crédit</span>}
      </button>
    </div>
  );
}
