import { useStore } from '../../store';
import type { GenUIWatchData } from '../../types/chat';
import styles from './ManagerChat.module.css';

interface Props {
  data: GenUIWatchData;
}

export function GenUIWatchButton({ data }: Props) {
  const openPlayer = useStore(s => s.openPlayer);
  const hideManager = useStore(s => s.hideManager);

  const handleWatch = () => {
    openPlayer(data.filmId);
    hideManager();
  };

  return (
    <div className={styles.genUICard}>
      <button className={styles.genUIButtonWatch} onClick={handleWatch}>
        Regarder {data.title}
      </button>
    </div>
  );
}
