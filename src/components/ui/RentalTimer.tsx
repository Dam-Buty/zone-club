import { useState, useEffect } from 'react';

interface RentalTimerProps {
  expiresAt: number;
  compact?: boolean;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Expiré';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}j ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function getUrgencyClasses(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'text-red-500 animate-[blink_0.5s_infinite]';
  if (hours < 6) return 'text-red-400 animate-[pulse_1s_infinite]';
  if (hours < 24) return 'text-orange-400';
  return 'text-white/70';
}

function computeRemaining(expiresAt: number): number {
  return expiresAt - Date.now();
}

export function RentalTimer({ expiresAt, compact = false }: RentalTimerProps) {
  const [remaining, setRemaining] = useState(() => computeRemaining(expiresAt));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(computeRemaining(expiresAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const urgencyClasses = getUrgencyClasses(remaining);
  const sizeClasses = compact ? 'text-xs py-0.5 px-1' : 'py-1 px-2';

  return (
    <div className={`inline-flex items-center gap-1 font-display rounded bg-black/50 ${sizeClasses} ${urgencyClasses}`}>
      <span className="text-[0.9em]">⏱</span>
      <span className="tracking-wide">{formatTimeRemaining(remaining)}</span>
    </div>
  );
}
