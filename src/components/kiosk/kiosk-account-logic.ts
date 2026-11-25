// Logique pure du compte dans la borne : le bonus de la semaine et la fin d'une location. Sans import de React ni du
// magasin, et sans import de valeur : Node la charge telle quelle dans les tests.

/** « 1 crédit », « 3 crédits » — même écriture que `creditsLabel` de kiosk-logic. */
const creditsLabel = (n: number): string => `${n} crédit${n > 1 ? 's' : ''}`;

// ===== Bonus de la semaine (spec 2026-11-20-credits-au-moment-de-l-action, § 5.5) =====

/** L'état du bonus tel que la borne l'écrit. `unknown` : pas encore lu, ou un serveur qui ne dit pas pourquoi. */
export type BonusLine = { state: 'available'; amount: number } | { state: 'claimed' } | { state: 'enough' } | { state: 'unknown' };

export function bonusLine(status: { canClaim: boolean; amount: number; reason?: string; code?: string } | null | undefined): BonusLine {
  if (!status) return { state: 'unknown' };
  if (status.canClaim && status.amount > 0) return { state: 'available', amount: status.amount };
  // Un serveur d'avant le code ne donne que sa phrase : elle suffit à reconnaître les deux cas.
  if (status.code === 'claimed' || (status.code === undefined && /déjà/.test(status.reason ?? ''))) return { state: 'claimed' };
  if (status.code === 'enough' || (status.code === undefined && /Solde/.test(status.reason ?? ''))) return { state: 'enough' };
  return { state: 'unknown' };
}

/** La ligne « Bonus de la semaine » de « Mon compte », quand il n'y a rien à recevoir : du texte, pas un bouton. */
export function bonusLineText(line: Exclude<BonusLine, { state: 'available' }>): string {
  if (line.state === 'claimed') return 'déjà reçu';
  if (line.state === 'enough') return 'quand il vous reste moins de 5 crédits';
  return "indisponible pour l'instant";
}

export function bonusButtonLabel(amount: number): string {
  return `Recevoir +${creditsLabel(amount)}`;
}

/**
 * « Crédits insuffisants ». `offer` : le montant du bonus à proposer — seulement s'il attend ET qu'il suffit à payer le
 * film (la borne enchaîne alors sur la confirmation de la location) ; sinon null, et le message ne promet rien.
 */
export function insufficientText(i: { cost: number; credits: number; bonus: BonusLine }): { title: string; body: string; offer: number | null } {
  const base = `Ce film coûte ${creditsLabel(i.cost)}. Vous en avez ${i.credits}.`;
  const offer = i.bonus.state === 'available' && i.credits + i.bonus.amount >= i.cost ? i.bonus.amount : null;
  return {
    title: 'Crédits insuffisants',
    body: offer === null ? base : `${base} Votre bonus de la semaine vous en offre ${offer}.`,
    offer,
  };
}

// ===== Fin d'une location =====

/**
 * La location qui finit la première (échue comprise, tant que le serveur ne l'a pas retirée) : la borne arme une
 * minuterie dessus pour relire le compte et prévenir le visiteur — sinon « REGARDER » restait affiché sur un film qui
 * ne se lançait plus, sans un mot (batterie de tests du 25/11/2026).
 */
export function nextRentalEnd(rentals: readonly { filmId: number; expiresAt: number }[], _nowMs: number): { filmId: number; at: number } | null {
  let next: { filmId: number; at: number } | null = null;
  for (const r of rentals) {
    if (next === null || r.expiresAt < next.at) next = { filmId: r.filmId, at: r.expiresAt };
  }
  return next;
}
