import { useEffect, useId, useRef } from 'react';
import styles from './KioskView.module.css';

/** Un message dans l'écran de la borne : un titre, un texte, un ou deux boutons. */
export type KioskNoticeSpec = {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
};

export function KioskNotice({ title, body, primary, secondary }: KioskNoticeSpec) {
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Le bouton principal reçoit le focus à l'ouverture, et à chaque nouveau message.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [title, body]);

  return (
    <div className={styles.kNoticeScrim}>
      <div className={styles.kNotice} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.kNoticeTitle}>{title}</h2>
        <p className={styles.kNoticeBody}>{body}</p>
        <div className={styles.kNoticeActions}>
          {secondary && (
            <button type="button" className={styles.kNoticeBtn} onClick={secondary.onPress}>
              {secondary.label}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary}`}
            onClick={primary.onPress}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
