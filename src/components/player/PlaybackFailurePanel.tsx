import { useId } from 'react';
import type { FailurePanel } from '../../utils/playback-failure';
import type { VersionChoice } from '../../utils/version-choice';
import styles from './PlaybackFailurePanel.module.css';

/**
 * « Cette version ne se lance pas » : par-dessus la vidéo, le titre et la version, puis « Essayer en … » (seulement si
 * une autre version existe), « Réessayer » et « Retour ». Les textes viennent de failurePanel (utils/playback-failure).
 */
export function PlaybackFailurePanel({ panel, onTryOther, onRetry, onBack }: {
  panel: FailurePanel;
  onTryOther(version: VersionChoice): void;
  onRetry(): void;
  onBack(): void;
}) {
  const id = useId();
  const other = panel.tryOther;
  return (
    <div className={styles.overlay}>
      <div className={styles.panel} role="alertdialog" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-line`}>
        <div id={`${id}-heading`} className={styles.heading}>{panel.heading}</div>
        <div id={`${id}-line`} className={styles.line}>{panel.line}</div>
        <div className={styles.actions}>
          {other && (
            <button type="button" className={styles.primary} onClick={() => onTryOther(other.version)}>
              {other.label}
            </button>
          )}
          <button type="button" className={other ? styles.secondary : styles.primary} onClick={onRetry}>
            Réessayer
          </button>
          <button type="button" className={styles.secondary} onClick={onBack}>
            Retour
          </button>
        </div>
      </div>
    </div>
  );
}
