import type { UIMessage } from 'ai';
import type { ChatAnnotation } from '../../types/chat';
import { GenUIRentCard } from './GenUIRentCard';
import { GenUICriticForm } from './GenUICriticForm';
import { GenUIWatchButton } from './GenUIWatchButton';
import styles from './ManagerChat.module.css';

interface Props {
  message: UIMessage;
  genUIData: ChatAnnotation[];
}

export function ChatMessageRenderer({ message, genUIData }: Props) {
  const isAssistant = message.role === 'assistant';

  // Extract text content from message parts
  const displayText = message.parts
    ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('') || '';

  // Find GenUI data for this message (rendered after text)
  const messageGenUI = isAssistant ? genUIData : [];

  return (
    <div
      className={`${styles.message} ${
        isAssistant ? styles.managerMessage : styles.userMessage
      }`}
    >
      {displayText && (
        <span className={styles.messageText}>{displayText}</span>
      )}
      {messageGenUI.map((data, i) => {
        switch (data.name) {
          case 'rent':
            return <GenUIRentCard key={`rent-${i}`} data={data} />;
          case 'critic':
            return <GenUICriticForm key={`critic-${i}`} data={data} />;
          case 'watch':
            return <GenUIWatchButton key={`watch-${i}`} data={data} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
