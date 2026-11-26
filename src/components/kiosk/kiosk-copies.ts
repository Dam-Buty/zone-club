// L'état de chaque exemplaire d'un film, pour la fiche de la borne (spec § 7 bis.2).
import { formatUntil } from './kiosk-logic.ts';

export type CopyLine = { n: number; available: boolean; text: string };

/**
 * Une ligne par exemplaire : les loués d'abord (dans l'ordre des retours), puis les disponibles.
 * `max(stock, locations)` lignes : une location en trop (stock réduit depuis) n'est jamais cachée.
 * `null` tant que le détail est inconnu. `timeZone` ne sert qu'aux tests.
 */
export function copyLines(
  i: { stock: number; returns: ReadonlyArray<{ atMs: number; mine: boolean }> } | null,
  timeZone?: string,
): CopyLine[] | null {
  if (!i) return null;
  const total = Math.max(i.stock, i.returns.length);
  const lines: CopyLine[] = [];
  for (let k = 0; k < total; k++) {
    const r = i.returns[k];
    let text = 'disponible';
    if (r) {
      const known = Number.isFinite(r.atMs);
      text = r.mine
        ? known ? `loué par vous · jusqu'au ${formatUntil(r.atMs, timeZone)}` : 'loué par vous'
        : known ? `loué · retour prévu le ${formatUntil(r.atMs, timeZone)}` : 'loué';
    }
    lines.push({ n: k + 1, available: !r, text });
  }
  return lines;
}
