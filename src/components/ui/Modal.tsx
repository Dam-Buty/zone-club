import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function Modal({ isOpen, onClose, children, title }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/85 flex justify-center items-center z-[200] animate-[fadeIn_200ms_ease]"
    >
      <div className="relative bg-card-bg border border-neon-pink rounded-lg p-12 max-w-[90vw] max-h-[90vh] overflow-y-auto glow-pink shadow-[0_25px_50px_rgba(0,0,0,0.5)] animate-[slideUp_300ms_ease]">
        <button
          className="absolute top-4 right-4 bg-transparent border-none text-neon-pink text-2xl cursor-pointer transition-all hover:scale-110 hover:text-glow-pink"
          onClick={onClose}
          aria-label="Fermer"
        >
          ✕
        </button>
        {title && (
          <h2 className="font-display text-neon-cyan text-glow-cyan mb-6 pr-12">
            {title}
          </h2>
        )}
        <div className="text-white">{children}</div>
      </div>
    </div>
  );
}
