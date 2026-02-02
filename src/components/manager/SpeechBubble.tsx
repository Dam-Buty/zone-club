import styles from './SpeechBubble.module.css';

interface SpeechBubbleProps {
  text: string;
  onClose?: () => void;
}

export function SpeechBubble({ text, onClose }: SpeechBubbleProps) {
  return (
    <div className={styles.bubble}>
      <p className={styles.text}>{text}</p>
      {onClose && (
        <button className={styles.close} onClick={onClose}>
          ✕
        </button>
      )}
      <div className={styles.tail} />
    </div>
  );
}
