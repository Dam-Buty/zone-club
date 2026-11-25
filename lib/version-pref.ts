// La version préférée du compte (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.2) :
// un réglage que le visiteur fait lui-même dans « Mon compte ». L'application ne la déduit jamais — ni d'un choix fait
// sur un film, ni d'« Essayer en … », ni de la réponse à la question des sous-titres : seul PATCH /api/me/version
// l'écrit. Deux colonnes sur `users` (pref_audio, pref_subtitle), toutes deux nulles = « Automatique ».
//
// La base arrive en paramètre (même patron que cast-session-store.ts) et la seule valeur importée passe par un chemin
// relatif portant l'extension `.ts` : Node charge ce module tel quel dans les tests, sur une base en mémoire.

import type { Db } from './cast-session-store';
import { parseVersionChoice } from '../src/utils/version-choice.ts';
import type { VersionChoice } from '../src/utils/version-choice.ts';

/**
 * La préférence du compte, ou null (« Automatique »). Une préférence illisible — une colonne nulle et pas l'autre,
 * une valeur inconnue — vaut « Automatique », sans lever : `/api/me` ne doit jamais échouer pour elle.
 */
export function readVersionPref(db: Db, userId: number): VersionChoice | null {
  const row = db.prepare('SELECT pref_audio, pref_subtitle FROM users WHERE id = ?').get(userId) as
    | { pref_audio: unknown; pref_subtitle: unknown }
    | undefined;
  if (!row) return null;
  return parseVersionChoice(row.pref_audio, row.pref_subtitle);
}

/** Enregistre la préférence du compte ; null (« Automatique ») remet les deux colonnes à NULL. */
export function writeVersionPref(db: Db, userId: number, pref: VersionChoice | null): void {
  db.prepare('UPDATE users SET pref_audio = ?, pref_subtitle = ? WHERE id = ?').run(pref?.audio ?? null, pref?.subtitle ?? null, userId);
}

/**
 * Le corps du PATCH : `{ audio, subtitle }`. Un couple que `parseVersionChoice` reconnaît, ou deux null explicites
 * pour « Automatique ». Un seul des deux nul, un champ absent, une valeur inconnue : refusé.
 */
export function parseVersionPrefBody(json: unknown): { ok: true; pref: VersionChoice | null } | { ok: false } {
  if (typeof json !== 'object' || json === null) return { ok: false };
  const { audio, subtitle } = json as { audio?: unknown; subtitle?: unknown };
  if (audio === null && subtitle === null) return { ok: true, pref: null };
  const pref = parseVersionChoice(audio, subtitle);
  return pref === null ? { ok: false } : { ok: true, pref };
}
