import { useState } from 'react';
import { useStore } from '../../store';
import type { GenUIRentData } from '../../types/chat';
import styles from './ManagerChat.module.css';

interface Props {
  data: GenUIRentData;
}

export function GenUIRentCard({ data }: Props) {
  const [state, setState] = useState<'pending' | 'renting' | 'rented' | 'error'>('pending');
  const rentFilm = useStore(s => s.rentFilm);
  const openPlayer = useStore(s => s.openPlayer);
  const hideManager = useStore(s => s.hideManager);
  const fetchMe = useStore(s => s.fetchMe);

  const handleRent = async () => {
    setState('renting');
    const rental = await rentFilm(data.film.id);
    if (rental) {
      await fetchMe();
      setState('rented');
    } else {
      setState('error');
    }
  };

  const handleWatch = () => {
    openPlayer(data.film.id);
    hideManager();
  };

  return (
    <div className={styles.genUICard}>
      <div className={styles.genUICardInner}>
        {data.film.poster_url && (
          <img
            src={data.film.poster_url}
            alt={data.film.title}
            className={styles.genUIPoster}
          />
        )}
        <div className={styles.genUICardInfo}>
          <span className={styles.genUITitle}>{data.film.title}</span>
          {state === 'pending' && (
            <button className={styles.genUIButton} onClick={handleRent}>
              Louer ({data.film.cost} credit{data.film.cost > 1 ? 's' : ''})
            </button>
          )}
          {state === 'renting' && (
            <span className={styles.genUIStatus}>Location en cours...</span>
          )}
          {state === 'rented' && (
            <button className={styles.genUIButtonWatch} onClick={handleWatch}>
              Regarder maintenant
            </button>
          )}
          {state === 'error' && (
            <span className={styles.genUIError}>Erreur de location</span>
          )}
        </div>
      </div>
    </div>
  );
}
