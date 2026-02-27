/**
 * Formate une durée en millisecondes en texte lisible.
 * Utilisé par RentalTimer et TVTerminal.
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Expiré';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}j ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
