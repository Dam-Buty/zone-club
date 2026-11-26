// Logique pure du compte dans la borne : le bonus de la semaine et la fin d'une location. Sans import de React ni du
// magasin ; seul import de valeur : une règle partagée, avec son extension `.ts` (Node la charge telle quelle dans les tests).
import type { KioskReviewState } from './kiosk-logic.ts';
import { isEarlyReturn } from '../../utils/rental-rules.ts';

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

// ===== Rendre une K7 (demande de Rusmir du 25/11/2026 : « on doit pouvoir rendre un film sur la borne ») =====

/**
 * La question avant de rendre. Le crédit n'est annoncé que dans le délai ; c'est le serveur qui tranche, et le
 * message qui suit le retour dit ce qu'il a décidé. `onTv` : ce film passe sur la TV, que le retour arrête.
 */
export function returnConfirmText(i: { title: string; rentedAt: number | null; nowMs: number; onTv: boolean }): { title: string; body: string } {
  const early = i.rentedAt !== null && isEarlyReturn(i.rentedAt, i.nowMs);
  const parts = [
    early ? 'Rendue dans les 8 h qui suivent la location, elle vous rapporte 1 crédit.' : null,
    'Vous ne pourrez plus la regarder sans la louer à nouveau.',
    i.onTv ? 'Le film sur la télé sera arrêté.' : null,
  ];
  return { title: `Rendre « ${i.title} » ?`, body: parts.filter(Boolean).join(' ') };
}

/** Le message après le retour : la réponse du serveur, ou null quand il a refusé ou n'a pas répondu. */
export function returnDoneText(result: { earlyReturnCredit: boolean } | null, onTv: boolean): { title: string; body: string | undefined } {
  if (!result) return { title: "Le retour n'a pas abouti", body: 'Réessayez dans un instant.' };
  const parts = [result.earlyReturnCredit ? 'Rendue en avance : +1 crédit.' : null, onTv ? 'Le film sur la télé est arrêté.' : null].filter(Boolean);
  return { title: 'K7 rendue', body: parts.length ? parts.join(' ') : undefined };
}

/**
 * Ce que le message de fin du retour propose pour la critique : l'écrire tout de suite, la dire pour plus tard (avec la
 * raison du serveur), ou rien quand elle est déjà publiée.
 */
export function returnReviewOffer(state: KioskReviewState): { kind: 'write' } | { kind: 'later'; reason: string } | null {
  if (state.kind === 'possible') return { kind: 'write' };
  if (state.kind === 'pas-encore') return { kind: 'later', reason: state.reason };
  return null;
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

// ===== La proposition à l'arrivée (spec 2026-11-26-borne-retour-k7-design, §§ 4.1 et 4.2) =====

/** Ce que la proposition lit d'une location. */
export type PromptRental = { filmId: number; rentedAt: number; watchProgress: number; watchCompletedAt: number | null; rewindClaimed: boolean };

/** Une location = un utilisateur, un film, une date de location : la question n'est posée qu'une fois par clé. */
export function returnPromptKey(userId: number, filmId: number, rentedAt: number): string {
  return `${userId}:${filmId}:${rentedAt}`;
}

/** La location à proposer : vue à 80 % au moins, jamais proposée, la plus récemment finie d'abord (`null` = la plus ancienne). */
export function returnPromptCandidate(rentals: ReadonlyArray<PromptRental>, asked: ReadonlySet<string>, userId: number): PromptRental | null {
  let best: PromptRental | null = null;
  for (const r of rentals) {
    if (r.watchProgress < 80 || asked.has(returnPromptKey(userId, r.filmId, r.rentedAt))) continue;
    if (best === null || (r.watchCompletedAt ?? -Infinity) > (best.watchCompletedAt ?? -Infinity)) best = r;
  }
  return best;
}

/** La question, avec seulement les lignes qui sont vraies : le crédit d'avance, le rembobinage, la critique. */
export function returnPromptText(i: { title: string; rentedAt: number; nowMs: number; rewound: boolean; review: KioskReviewState }): { title: string; body: string; lines: string[] } {
  const lines: string[] = [];
  if (isEarlyReturn(i.rentedAt, i.nowMs)) lines.push('rendue avant 8 h : +1 crédit');
  if (!i.rewound) lines.push("rembobinez-la d'abord dans « Mon compte » : +1 crédit");
  if (i.review.kind === 'possible') lines.push('votre critique ensuite : +1 crédit');
  return { title: `Vous avez fini « ${i.title} » ?`, body: 'Rendez la K7 à la borne :', lines };
}

const ASKED_KEY = 'zone-borne-retour-demande';

/** Les locations déjà proposées. Stockage absent, qui lève ou illisible : ensemble vide (on reposera la question, au pire). */
export function readAsked(storage: Pick<Storage, 'getItem'> | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ASKED_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberAsked(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string): void {
  if (!storage) return;
  try {
    const asked = readAsked(storage);
    asked.add(key);
    storage.setItem(ASKED_KEY, JSON.stringify([...asked]));
  } catch {
    // Navigation privée, quota : la question pourra être reposée, rien de grave.
  }
}
