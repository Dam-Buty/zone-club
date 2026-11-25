// Traces des lectures en échec : une ligne quand un film ne démarre pas pour un visiteur (docs/superpowers/specs/
// 2026-11-19-versions-et-erreurs-de-lecture-design.md). Les logs applicatifs ne disent ni quel film, ni quelle version,
// ni sur quel appareil ; une ligne par échec le dit, et l'administration le lit.
//
// JAMAIS d'adresse de diffusion ni de chemin de fichier : la table n'a pas la colonne pour, et l'enregistrement ne lit
// que les champs nommés ci-dessous — c'est le secret de la location.
//
// La base arrive en paramètre et ce module n'importe aucune valeur : il est chargé tel quel par Node dans les tests,
// sur une base en mémoire (même patron que cast-session-store.ts).

import type { Db } from './cast-session-store';
import type { PlaybackFailure } from './playback-failure-parse';

/**
 * Note une lecture en échec. Le navigateur (`browser`) est le résumé court de `briefBrowser`, jamais l'en-tête brut.
 * Un film inconnu ne laisse rien et ne casse rien : une trace perdue ne dérange personne.
 */
export function savePlaybackFailure(db: Db, i: PlaybackFailure & { userId: number; browser: string }): void {
  db.prepare(
    `INSERT INTO playback_failures (user_id, film_id, audio, subtitle, place, kind, position_sec, browser)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM films WHERE id = ?)`,
  ).run(i.userId, i.filmId, i.audio, i.subtitle, i.place, i.kind, i.position, i.browser, i.filmId);
}

/** Un nombre de jours entier entre 1 et 365 ; une valeur illisible vaut une semaine. */
export function clampDays(days: number): number {
  return Number.isFinite(days) ? Math.max(1, Math.min(365, Math.round(days))) : 7;
}

export interface PlaybackFailureSummary {
  film_id: number;
  title: string | null;
  audio: string;
  place: string;
  failures: number;
  last_at: string;
}

/**
 * Les échecs des `days` derniers jours, groupés par film, piste audio et lieu (appareil ou télé), avec leur nombre et
 * la date du plus récent. Le groupe touché en dernier d'abord.
 */
export function summarizePlaybackFailures(db: Db, days: number): PlaybackFailureSummary[] {
  return db
    .prepare(
      `SELECT p.film_id AS film_id, f.title AS title, p.audio AS audio, p.place AS place,
              COUNT(*) AS failures, MAX(p.created_at) AS last_at
       FROM playback_failures p LEFT JOIN films f ON f.id = p.film_id
       WHERE p.created_at >= datetime('now', ?)
       GROUP BY p.film_id, p.audio, p.place
       ORDER BY last_at DESC, MAX(p.id) DESC`,
    )
    .all(`-${clampDays(days)} days`) as PlaybackFailureSummary[];
}

export interface PlaybackFailureRow {
  id: number;
  created_at: string;
  user_id: number;
  film_id: number;
  title: string | null;
  audio: string;
  subtitle: string;
  place: string;
  kind: string;
  position_sec: number | null;
  browser: string | null;
}

/** Les `limit` dernières traces (500 au plus), la plus récente d'abord. */
export function recentPlaybackFailures(db: Db, limit: number): PlaybackFailureRow[] {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 50;
  return db
    .prepare(
      `SELECT p.id AS id, p.created_at AS created_at, p.user_id AS user_id, p.film_id AS film_id, f.title AS title,
              p.audio AS audio, p.subtitle AS subtitle, p.place AS place, p.kind AS kind,
              p.position_sec AS position_sec, p.browser AS browser
       FROM playback_failures p LEFT JOIN films f ON f.id = p.film_id
       ORDER BY p.id DESC LIMIT ?`,
    )
    .all(n) as PlaybackFailureRow[];
}

/** Une trace telle qu'elle part vers le navigateur de l'administrateur : celle du film et de la version, pas du visiteur. */
export type PublicPlaybackFailure = Omit<PlaybackFailureRow, 'user_id'>;

/**
 * Les traces sans le visiteur. La liste est nommée champ par champ : un champ de plus sur la ligne lue ne part pas
 * vers le navigateur sans qu'on l'ait décidé. L'administration lit des échecs par film et par version, pas des gens.
 */
export function withoutVisitor(rows: PlaybackFailureRow[]): PublicPlaybackFailure[] {
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    film_id: r.film_id,
    title: r.title,
    audio: r.audio,
    subtitle: r.subtitle,
    place: r.place,
    kind: r.kind,
    position_sec: r.position_sec,
    browser: r.browser,
  }));
}
