import type { UIMessage } from 'ai';
import { isToolUIPart, getToolName } from 'ai';
import { GenUIRentCard } from './GenUIRentCard';
import { GenUICriticForm } from './GenUICriticForm';
import { GenUIWatchButton } from './GenUIWatchButton';
import styles from './ManagerChat.module.css';

interface Props {
  message: UIMessage;
}

export function ChatMessageRenderer({ message }: Props) {
  const isAssistant = message.role === 'assistant';

  return (
    <div
      className={`${styles.message} ${
        isAssistant ? styles.managerMessage : styles.userMessage
      }`}
    >
      {message.parts?.map((part, i) => {
        if (part.type === 'text') {
          return part.text ? (
            <span key={`text-${i}`} className={styles.messageText}>{part.text}</span>
          ) : null;
        }

        if (!isAssistant || !isToolUIPart(part)) return null;

        const toolName = getToolName(part);

        // Only render GenUI when tool output is available
        if (part.state !== 'output-available') return null;
        const output = part.output as any;
        if (!output) return null;

        switch (toolName) {
          case 'rent':
            if (output.action === 'rent' && output.film) {
              return <GenUIRentCard key={part.toolCallId} data={{ name: 'rent', film: output.film }} />;
            }
            return null;
          case 'critic':
            if (output.action === 'critic' && output.filmId) {
              return (
                <GenUICriticForm
                  key={part.toolCallId}
                  data={{
                    name: 'critic',
                    filmId: output.filmId,
                    filmTitle: output.filmTitle,
                    preWrittenReview: output.preWrittenReview,
                  }}
                />
              );
            }
            return null;
          case 'watch':
            if (output.action === 'watch' && output.filmId) {
              return (
                <GenUIWatchButton
                  key={part.toolCallId}
                  data={{ name: 'watch', filmId: output.filmId, title: output.title }}
                />
              );
            }
            return null;
          default:
            // get_film, backdrop, add_credits: no inline UI
            return null;
        }
      })}
    </div>
  );
}
