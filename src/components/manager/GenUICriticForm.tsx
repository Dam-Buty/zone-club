import { useState } from 'react';
import api from '../../api';
import { useStore } from '../../store';
import type { GenUICriticData } from '../../types/chat';
import styles from './ManagerChat.module.css';

interface Props {
  data: GenUICriticData;
}

export function GenUICriticForm({ data }: Props) {
  const [content, setContent] = useState(data.preWrittenReview);
  const [ratings, setRatings] = useState({ direction: 3, screenplay: 3, acting: 3 });
  const [state, setState] = useState<'editing' | 'submitting' | 'submitted' | 'error'>('editing');
  const [errorMsg, setErrorMsg] = useState('');
  const fetchMe = useStore(s => s.fetchMe);

  const handleSubmit = async () => {
    if (content.length < 500) return;
    setState('submitting');
    try {
      await api.reviews.create(data.filmId, {
        content,
        rating_direction: ratings.direction,
        rating_screenplay: ratings.screenplay,
        rating_acting: ratings.acting,
      });
      await fetchMe();
      setState('submitted');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur');
      setState('error');
    }
  };

  if (state === 'submitted') {
    return (
      <div className={styles.genUICard}>
        <span className={styles.genUISuccess}>Critique publiee ! +1 credit</span>
      </div>
    );
  }

  return (
    <div className={styles.genUICard}>
      <div className={styles.genUICriticHeader}>Critique — {data.filmTitle}</div>
      <textarea
        className={styles.genUITextarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        disabled={state === 'submitting'}
      />
      <div className={styles.genUICharCount}>
        {content.length}/500 {content.length < 500 ? '(min 500)' : ''}
      </div>
      <div className={styles.genUIRatings}>
        {(['direction', 'screenplay', 'acting'] as const).map((key) => (
          <div key={key} className={styles.genUIRatingRow}>
            <span>{key === 'direction' ? 'Realisation' : key === 'screenplay' ? 'Scenario' : 'Jeu d\'acteurs'}</span>
            <div className={styles.genUIStars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`${styles.genUIStar} ${n <= ratings[key] ? styles.genUIStarActive : ''}`}
                  onClick={() => setRatings(r => ({ ...r, [key]: n }))}
                  disabled={state === 'submitting'}
                >
                  *
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        className={styles.genUIButton}
        onClick={handleSubmit}
        disabled={content.length < 500 || state === 'submitting'}
      >
        {state === 'submitting' ? 'Publication...' : 'Publier la critique'}
      </button>
      {state === 'error' && <span className={styles.genUIError}>{errorMsg}</span>}
    </div>
  );
}
