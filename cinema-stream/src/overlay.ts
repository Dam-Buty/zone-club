import type { PlaylistFilm, PlaylistState } from "./playlist.ts";
import { formatDuration } from "./format.ts";

/**
 * Nombre de boucles de playlist inscrites dans la liste concat : sert à
 * simuler une diffusion infinie sans logique de bouclage. L'incrustation est
 * générée sur exactement les mêmes passages, sinon le titre se figerait après
 * la première boucle (~31 jours).
 */
export const REPEAT_PASSES = 50;

const OVERLAY_MAX_TITLE = 62;

/**
 * Échappe une chaîne pour une valeur d'option drawtext passée dans un fichier
 * sendcmd. Le texte est ensuite réexpansé par drawtext : `%` doit donc être
 * doublé, et `:` échappé sinon l'option se coupe en deux.
 */
export function escapeDrawtext(raw: string): string {
  return raw
    .replace(/\\/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "%%")
    .replace(/:/g, "\\:");
}

export function filmLabel(film: PlaylistFilm): string {
  const label = `${film.title}${film.year ? ` (${film.year})` : ""}`;
  return label.length > OVERLAY_MAX_TITLE
    ? `${label.slice(0, OVERLAY_MAX_TITLE - 1).trimEnd()}\u2026`
    : label;
}

/**
 * Horloge « temps écoulé dans le film » sous forme d'expression drawtext, donc
 * recalculée à chaque frame sans aucune I/O : `t` est le PTS ffmpeg, et
 * `startSec` situe le début du film sur la timeline du process (négatif si on
 * démarre au milieu de celui-ci).
 */
export function clockExpr(startSec: number, withHours: boolean): string {
  const shifted =
    startSec < 0
      ? `t+${Math.abs(startSec).toFixed(3)}`
      : `t-${startSec.toFixed(3)}`;
  const s = `max(0\\,${shifted})`;
  const pad = (expr: string) => `%{eif\\:${expr}\\:d\\:2}`;
  const hour = `%{eif\\:floor(${s}/3600)\\:d}`;
  const min = pad(`mod(floor(${s}/60)\\,60)`);
  const sec = pad(`mod(floor(${s})\\,60)`);
  return withHours
    ? `${hour}\\:${min}\\:${sec}`
    : `${pad(`floor(${s}/60)`)}\\:${sec}`;
}

/**
 * Fichier sendcmd : une commande `reinit` par film et par passage, horodatées
 * sur la timeline ffmpeg. C'est ce qui produit à la fois le changement de
 * titre aux frontières et l'horloge repartant de zéro à chaque film.
 *
 * Le concat demuxer ne transporte aucune métadonnée par fichier, donc la
 * position courante ne peut pas venir de l'input : elle est déduite des durées
 * de la playlist, exactement comme `currentPosition()`.
 */
export function buildOverlayCommands(
  state: PlaylistState,
  startIndex: number,
  startOffset: number,
  passes: number = REPEAT_PASSES,
): string {
  const n = state.films.length;
  const lines: string[] = [];
  let timeline = 0;

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const film = state.films[(startIndex + i) % n];
      const isFirst = pass === 0 && i === 0;
      // `t` repart de 0 sur l'inpoint du premier film : son horloge démarre
      // à startOffset, donc son origine de film est -startOffset.
      const clock = clockExpr(
        isFirst ? -startOffset : timeline,
        film.durationSec >= 3600,
      );
      const total = escapeDrawtext(formatDuration(film.durationSec));

      lines.push(
        `${timeline.toFixed(3)} [enter] drawtext@ov reinit ` +
          `'text=${escapeDrawtext(filmLabel(film))} \u2014 ${clock} / ${total}:fontsize=${OVERLAY_FONTSIZE}';`,
      );

      timeline += isFirst
        ? Math.max(0, film.durationSec - startOffset)
        : film.durationSec;
    }
  }

  return lines.join("\n") + "\n";
}

export const OVERLAY_FONTSIZE = 38;
export const OVERLAY_FONT =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/**
 * Chaîne de filtres vidéo : `sendcmd` réinjecte les `reinit` dans le drawtext
 * nommé (@ov) aux frontières de films, sans quitter le filtre vidéo.
 */
export function overlayFilter(commandsPath: string): string {
  return (
    `sendcmd=f=${commandsPath},` +
    `drawtext@ov=fontfile=${OVERLAY_FONT}:text=.:fontsize=${OVERLAY_FONTSIZE}` +
    `:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=48:y=48`
  );
}
