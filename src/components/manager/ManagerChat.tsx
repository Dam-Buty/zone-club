import { useRef, useEffect, useCallback, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { useStore } from '../../store';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import type { ChatAnnotation } from '../../types/chat';
import styles from './ManagerChat.module.css';

export function ManagerChat() {
  const managerVisible = useStore(s => s.managerVisible);
  const hideManager = useStore(s => s.hideManager);
  const chatBackdropUrl = useStore(s => s.chatBackdropUrl);
  const setChatBackdrop = useStore(s => s.setChatBackdrop);
  const drainEvents = useStore(s => s.drainEvents);
  const fetchMe = useStore(s => s.fetchMe);
  const requestPointerUnlock = useStore(s => s.requestPointerUnlock);
  const requestPointerLock = useStore(s => s.requestPointerLock);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [genUIMap, setGenUIMap] = useState<Record<string, ChatAnnotation[]>>({});

  const { messages, sendMessage, status, error } = useChat({
    onFinish: ({ message }) => {
      // Inspect tool results in the finished message for side-effects
      const messageGenUI: ChatAnnotation[] = [];
      if (message.parts) {
        for (const part of message.parts) {
          if (part.type === 'tool-invocation' && 'result' in part) {
            const result = part.result as any;
            if (!result) continue;

            // Backdrop
            if (result.url && result.success === true) {
              setChatBackdrop(result.url);
            }

            // Credits
            if (result.action === 'credits') {
              fetchMe();
            }

            // GenUI actions
            if (result.action === 'rent' && result.film) {
              messageGenUI.push({ name: 'rent', film: result.film });
            }
            if (result.action === 'critic' && result.filmId) {
              messageGenUI.push({
                name: 'critic',
                filmId: result.filmId,
                filmTitle: result.filmTitle,
                preWrittenReview: result.preWrittenReview,
              });
            }
            if (result.action === 'watch' && result.filmId) {
              messageGenUI.push({
                name: 'watch',
                filmId: result.filmId,
                title: result.title,
              });
            }
          }
        }
      }
      if (messageGenUI.length > 0) {
        setGenUIMap(prev => ({ ...prev, [message.id]: messageGenUI }));
      }
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input + unlock pointer when chat opens
  useEffect(() => {
    if (managerVisible) {
      requestPointerUnlock();
      inputRef.current?.focus();
    }
  }, [managerVisible, requestPointerUnlock]);

  // Close chat handler
  const closeChat = useCallback(async () => {
    hideManager();
    requestPointerLock();
    setGenUIMap({});
    try {
      await fetch('/api/chat/close', { method: 'POST', credentials: 'include' });
    } catch {}
  }, [hideManager, requestPointerLock]);

  // Escape to close
  useEffect(() => {
    if (!managerVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeChat();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [managerVisible, closeChat]);

  // beforeunload — sendBeacon to close session
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (managerVisible) {
        navigator.sendBeacon('/api/chat/close');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [managerVisible]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    const events = drainEvents();
    setInputValue('');
    sendMessage({ text }, { body: { events } });
  }, [inputValue, isLoading, sendMessage, drainEvents]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!managerVisible) return null;

  return (
    <div className={styles.overlay}>
      {chatBackdropUrl && (
        <img src={chatBackdropUrl} alt="" className={styles.backdrop} />
      )}

      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.managerName}>Michel</span>
            <span className={styles.managerTitle}>Gerant depuis '84</span>
          </div>
          <button className={styles.closeButton} onClick={closeChat} aria-label="Fermer le chat">
            X
          </button>
        </div>

        <div className={styles.messages}>
          {messages.filter(m => m.role !== 'system').map((message) => (
            <ChatMessageRenderer
              key={message.id}
              message={message}
              genUIData={genUIMap[message.id] || []}
            />
          ))}
          {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role !== 'assistant') && (
            <div className={`${styles.message} ${styles.managerMessage}`}>
              <span className={styles.typing}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </span>
            </div>
          )}
          {error && (
            <div className={`${styles.message} ${styles.managerMessage}`}>
              <span className={styles.messageText}>
                *grommelle* ... La ligne est coupee. Reessaie.
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputArea}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Parle au gerant..."
            disabled={isLoading}
          />
          <button
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            aria-label="Envoyer"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  );
}
