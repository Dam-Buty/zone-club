// Règle d'une critique sur un film loué (docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 6).
//
// Rusmir, 17-18/11/2026 : « on garde les 80 % » ; « il faut qu'a minima le film soit lancé et qu'on ait
// l'information » ; « la critique ne peut être faite avant la fin du film − 20 % de la durée » ; « n'importe quelle
// location suffit ». Une location remplit la règle si elle est vue à 80 % au moins ET si 80 % de la durée du film
// se sont écoulés depuis son lancement — la garde de temps empêche de débloquer la critique en avançant
// rapidement jusqu'à la fin, ce que la TV permet. Sans lancement noté (location antérieure) ou sans durée connue,
// la garde de temps ne s'applique pas.
//
// Aucun import de valeur : chargé tel quel par Node dans les tests.

export type ReviewRentalFacts = {
  watch_progress: number | null;
  /** Date SQLite, UTC sans fuseau (« 2026-11-18 19:50:00 »). */
  watch_started_at: string | null;
  duration_sec: number | null;
  /** Minutes (TMDB) : durée de repli. */
  runtime: number | null;
};

export type ReviewEligibility = { allowed: boolean; reason: string | null; availableAtMs: number | null };

const WATCHED_SHARE = 0.8;

function sqlUtcMs(value: string): number {
  return Date.parse(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'));
}

function durationMs(r: ReviewRentalFacts): number | null {
  if (r.duration_sec && r.duration_sec > 0) return r.duration_sec * 1000;
  if (r.runtime && r.runtime > 0) return r.runtime * 60_000;
  return null;
}

/** « 19 novembre à 21:10 », heure de Paris. */
function frenchDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

/** La critique est-elle permise, au vu de TOUTES les locations de ce film par ce visiteur ? */
export function reviewEligibility(rentals: ReadonlyArray<ReviewRentalFacts>, nowMs: number): ReviewEligibility {
  let earliest: number | null = null;
  for (const r of rentals) {
    if ((r.watch_progress ?? 0) < WATCHED_SHARE * 100) continue;
    const duration = durationMs(r);
    const started = r.watch_started_at ? sqlUtcMs(r.watch_started_at) : NaN;
    if (!Number.isFinite(started) || duration === null) return { allowed: true, reason: null, availableAtMs: null };
    const at = started + WATCHED_SHARE * duration;
    if (nowMs >= at) return { allowed: true, reason: null, availableAtMs: null };
    earliest = earliest === null ? at : Math.min(earliest, at);
  }
  if (earliest !== null) return { allowed: false, reason: `Critique possible à partir du ${frenchDateTime(earliest)}`, availableAtMs: earliest };
  return { allowed: false, reason: 'Vous devez regarder au moins 80 % du film', availableAtMs: null };
}
