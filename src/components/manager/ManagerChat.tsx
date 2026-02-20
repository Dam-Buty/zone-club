import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { ManagerAvatar } from './ManagerAvatar';
import managerResponses from '../../data/mock/manager-responses.json';
import styles from './ManagerChat.module.css';

export function ManagerChat() {
  const {
    managerVisible,
    hideManager,
    chatHistory,
    addChatMessage,
    claimDailyBonus,
    currentAisle,
    requestPointerUnlock,
    requestPointerLock,
  } = useStore();

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [bonusAwarded, setBonusAwarded] = useState(false);
  const [outsideClickCount, setOutsideClickCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, scrollToBottom]);

  // Focus input when chat opens and unlock pointer
  useEffect(() => {
    if (managerVisible) {
      // Libérer la souris pour interagir avec le chat
      requestPointerUnlock();
      // Reset le compteur de clics extérieurs
      setOutsideClickCount(0);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [managerVisible, requestPointerUnlock]);

  // Détecter les clics en dehors du chat - 2 clics consécutifs ferment le chat
  useEffect(() => {
    if (!managerVisible) return;

    const handleDocumentClick = (e: MouseEvent) => {
      // Vérifier si le clic est en dehors du conteneur du chat
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOutsideClickCount(prev => {
          const newCount = prev + 1;
          if (newCount >= 2) {
            // Fermer le chat après 2 clics extérieurs
            hideManager();
            requestPointerLock();
            return 0;
          }
          return newCount;
        });
      } else {
        // Clic à l'intérieur du chat - reset le compteur
        setOutsideClickCount(0);
      }
    };

    // Délai pour éviter que le clic d'ouverture ne compte
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleDocumentClick);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [managerVisible, hideManager, requestPointerLock]);

  // Send greeting when chat opens and no history
  useEffect(() => {
    if (managerVisible && chatHistory.length === 0) {
      const greetings = managerResponses.greeting;
      const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
      addChatMessage('manager', randomGreeting);
    }
  }, [managerVisible, chatHistory.length, addChatMessage]);

  // Check for daily bonus after sufficient messages
  useEffect(() => {
    if (chatHistory.length >= 6 && !bonusAwarded) {
      const claimed = claimDailyBonus();
      if (claimed) {
        // Use setTimeout to avoid calling setState synchronously in effect
        setTimeout(() => {
          setBonusAwarded(true);
        }, 0);
        setTimeout(() => {
          addChatMessage(
            'manager',
            "Hey, t'es sympa toi. Tiens, un crédit bonus pour la fidélité. Reviens demain, y'en aura peut-être un autre."
          );
        }, 1000);
      }
    }
  }, [chatHistory.length, bonusAwarded, claimDailyBonus, addChatMessage]);

  const getManagerResponse = useCallback((userMessage: string): string => {
    const lowerMessage = userMessage.toLowerCase();

    // Check for aisle-related keywords
    const aisleKeywords: Record<string, keyof typeof managerResponses.aisles> = {
      'nouveaut': 'nouveautes',
      'nouveau': 'nouveautes',
      'action': 'action',
      'horreur': 'horreur',
      'peur': 'horreur',
      'sf': 'sf',
      'science': 'sf',
      'fiction': 'sf',
      'comédie': 'comedie',
      'comedie': 'comedie',
      'drôle': 'comedie',
      'drame': 'drame',
      'émotion': 'drame',
      'dramatique': 'drame',
      'thriller': 'thriller',
      'suspense': 'thriller',
      'policier': 'policier',
      'polar': 'policier',
      'enquête': 'policier',
      'animation': 'animation',
      'animé': 'animation',
      'dessin': 'animation',
      'classique': 'classiques',
      'vieux': 'classiques',
      'ancien': 'classiques',
    };

    for (const [keyword, aisle] of Object.entries(aisleKeywords)) {
      if (lowerMessage.includes(keyword)) {
        return managerResponses.aisles[aisle];
      }
    }

    // Check for current aisle context
    if (lowerMessage.includes('rayon') || lowerMessage.includes('ici') || lowerMessage.includes('quoi')) {
      return managerResponses.aisles[currentAisle];
    }

    // Check for film-related queries
    if (lowerMessage.includes('film') || lowerMessage.includes('conseil') || lowerMessage.includes('recommand')) {
      const reactions = managerResponses.rentalReactions.positive;
      return reactions[Math.floor(Math.random() * reactions.length)] + " Demande-moi sur un rayon spécifique.";
    }

    // Check for greetings
    if (lowerMessage.includes('salut') || lowerMessage.includes('bonjour') || lowerMessage.includes('hello') || lowerMessage.includes('hey')) {
      const greetings = managerResponses.greeting;
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    // Check for thanks
    if (lowerMessage.includes('merci') || lowerMessage.includes('thanks')) {
      return "De rien. C'est mon boulot. Enfin... c'est ma passion surtout.";
    }

    // Check for help
    if (lowerMessage.includes('aide') || lowerMessage.includes('help') || lowerMessage.includes('comment')) {
      return "Tu veux savoir quoi ? Les rayons, les films, les classiques ? Je connais tout ce magasin par coeur.";
    }

    // Default fallback responses
    const fallbacks = [
      "Intéressant. T'as regardé les rayons ? Y'a des pépites partout.",
      "Mmh. Je vois. Tu cherches quelque chose de précis ?",
      "Ouais... Tu veux que je te parle d'un rayon en particulier ?",
      "OK. Bon, si tu veux des conseils sur un genre, hésite pas.",
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }, [currentAisle]);

  const handleSendMessage = useCallback(() => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isTyping) return;

    // Add user message
    addChatMessage('user', trimmedInput);
    setInputValue('');

    // Simulate manager typing
    setIsTyping(true);
    const typingDelay = Math.random() * 1000 + 500; // 500-1500ms

    setTimeout(() => {
      const response = getManagerResponse(trimmedInput);
      addChatMessage('manager', response);
      setIsTyping(false);
    }, typingDelay);
  }, [inputValue, isTyping, addChatMessage, getManagerResponse]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage]
  );

  const handleClose = useCallback(() => {
    hideManager();
    // Re-locker la souris pour reprendre la navigation
    requestPointerLock();
  }, [hideManager, requestPointerLock]);

  if (!managerVisible) return null;

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.avatarSection}>
        <ManagerAvatar />
      </div>

      <div className={styles.chatPanel}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.managerName}>Michel</span>
            <span className={styles.managerTitle}>Gérant depuis '84</span>
          </div>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Fermer le chat"
          >
            ✕
          </button>
        </div>

        <div className={styles.messages}>
          {chatHistory.map((message, index) => (
            <div
              key={index}
              className={`${styles.message} ${
                message.role === 'manager' ? styles.managerMessage : styles.userMessage
              }`}
            >
              <span className={styles.messageText}>{message.text}</span>
            </div>
          ))}
          {isTyping && (
            <div className={`${styles.message} ${styles.managerMessage}`}>
              <span className={styles.typing}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
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
            placeholder="Parle au gérant..."
            disabled={isTyping}
          />
          <button
            className={styles.sendButton}
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isTyping}
            aria-label="Envoyer"
          >
            ➤
          </button>
        </div>

        {bonusAwarded && (
          <div className={styles.bonusBadge}>
            +1 crédit bonus !
          </div>
        )}
      </div>
    </div>
  );
}
