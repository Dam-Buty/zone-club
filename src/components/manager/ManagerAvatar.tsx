import { useStore } from '../../store';
import styles from './ManagerAvatar.module.css';

export function ManagerAvatar() {
  const { managerVisible } = useStore();

  if (!managerVisible) return null;

  return (
    <div className={styles.container}>
      <div className={styles.avatar}>
        <div className={styles.face}>
          <div className={styles.glasses}>
            <div className={styles.lens} />
            <div className={styles.lens} />
          </div>
          <div className={styles.mouth} />
        </div>
        <div className={styles.body}>
          <div className={styles.shirt} />
        </div>
      </div>
    </div>
  );
}
