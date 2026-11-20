// Contrôle des fichiers d'un film (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 6).
//
// Logique pure : `scripts/media-check.ts` sonde les fichiers (ffprobe, décodage des dix dernières secondes) et juge
// ici ; le serveur s'en sert pour savoir quelles versions d'un film sont jouables. Aucun import de valeur : le module
// se charge tel quel dans `node --test`.

/** Ce que la sonde a lu d'un fichier. `duration` en secondes (0 si ffprobe ne la donne pas). */
export interface FileProbe {
  exists: boolean;
  opens: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  duration: number;
  tailDecodes: boolean;
}

/**
 * Un fichier plus court que 90 % de la durée annoncée par TMDB est tronqué. Relevé en production le 19/11/2026 :
 * une VF de 68,5 min pour « 2001 » (156 min), de 37,7 min pour « The Revenant » (157 min).
 */
export const MIN_DURATION_RATIO = 0.9;

/** La VF et la VO partagent la même vidéo : au-delà de deux secondes d'écart, l'une des deux est fausse. */
export const VF_VO_MAX_GAP_S = 2;

/** Les anomalies d'un film, en français : celles de chaque version, et celles de la paire VF / VO. */
export interface FilmJudgement {
  vf: string[];
  vo: string[];
  pair: string[];
}

/** « 68,5 » : des secondes en minutes, au dixième, virgule décimale. */
function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1).replace('.', ',');
}

function fileAnomalies(probe: FileProbe | null, runtimeMin: number | null): string[] {
  if (probe === null) return [];
  // Sans fichier, ou sans fichier lisible, le reste ne se mesure pas.
  if (!probe.exists) return ['fichier absent'];
  if (!probe.opens) return ['illisible'];
  const anomalies: string[] = [];
  if (!probe.hasVideo) anomalies.push('pas de piste vidéo');
  if (!probe.hasAudio) anomalies.push('pas de piste audio');
  if (!probe.tailDecodes) anomalies.push('fin indécodable');
  if (runtimeMin !== null && runtimeMin > 0 && probe.duration < MIN_DURATION_RATIO * runtimeMin * 60) {
    anomalies.push(`durée ${minutes(probe.duration)} min pour un film de ${String(runtimeMin).replace('.', ',')} min`);
  }
  return anomalies;
}

/** Un fichier dont la durée a été lue. */
function measured(probe: FileProbe | null): probe is FileProbe {
  return probe !== null && probe.exists && probe.opens && probe.duration > 0;
}

/**
 * Juge les fichiers d'un film. `null` = version que le film n'a pas : aucune anomalie. `runtimeMin` = durée TMDB,
 * en minutes ; inconnue (`null` ou 0), elle ne donne aucune anomalie de durée. L'écart VF / VO est une anomalie de la
 * paire : il ne dit pas laquelle des deux est fausse.
 */
export function judgeFilm(i: { runtimeMin: number | null; vf: FileProbe | null; vo: FileProbe | null }): FilmJudgement {
  const pair: string[] = [];
  if (measured(i.vf) && measured(i.vo) && Math.abs(i.vf.duration - i.vo.duration) > VF_VO_MAX_GAP_S) {
    pair.push(`VF et VO de durées différentes (${minutes(i.vf.duration)} min / ${minutes(i.vo.duration)} min)`);
  }
  return { vf: fileAnomalies(i.vf, i.runtimeMin), vo: fileAnomalies(i.vo, i.runtimeMin), pair };
}

/**
 * Les versions que `--mark` marque : celles qui ont leurs propres anomalies. Une version saine est à démarquer. Un écart
 * VF / VO seul ne marque rien : la version sous 90 % de la durée TMDB l'est déjà par sa propre anomalie de durée, et
 * sans durée TMDB on ne sait pas laquelle est fausse.
 */
export function versionsToMark(j: FilmJudgement): { vf: boolean; vo: boolean } {
  return { vf: j.vf.length > 0, vo: j.vo.length > 0 };
}

/**
 * Le verdict du décodage des dix dernières secondes (`ffmpeg -progress pipe:1 -v error -sseof -10 -i <fichier> -f null -`) :
 * sorti avec 0, sans une ligne d'erreur, ET quelque chose a été décodé (`out_time_us` > 0 dans la progression). Le
 * dernier point compte : un fichier coupé bien avant sa fin fait sauter ffmpeg au-delà des données, il ne décode rien,
 * ne le signale que par un avertissement (muet en `-v error`) et sort avec 0 — vérifié le 20/11/2026 sur un MP4 coupé à
 * 60 % de ses octets. `code` nul = ffmpeg tué (plus de 60 s).
 */
export function tailDecoded(run: { code: number | null; stderr: string; progress: string }): boolean {
  const positions = [...run.progress.matchAll(/^out_time_us=(.*)$/gm)];
  const decodedUs = positions.length > 0 ? Number(positions[positions.length - 1][1]) : 0;
  return run.code === 0 && run.stderr.trim() === '' && decodedUs > 0;
}

/** Une ligne de rapport par anomalie : « [12] 2001 : L'Odyssée de l'espace — VF : durée 68,5 min pour un film de 156 min ». */
export function reportLines(film: { id: number; title: string }, j: FilmJudgement): string[] {
  const head = `[${film.id}] ${film.title} — `;
  return [
    ...j.vf.map((a) => `${head}VF : ${a}`),
    ...j.vo.map((a) => `${head}VO : ${a}`),
    ...j.pair.map((a) => head + a),
  ];
}

/**
 * Les versions réellement jouables d'un film : le fichier transcodé existe et la version n'est pas marquée illisible
 * (`vf_unplayable` / `vo_unplayable`, posés par `npm run media:check -- --mark`). Une version marquée compte comme
 * absente partout : `has_vf` / `has_vo` de la fiche, adresses et liens de la location.
 */
export function playableVersions(film: {
  file_path_vf_transcoded: string | null;
  file_path_vo_transcoded: string | null;
  vf_unplayable?: number | null;
  vo_unplayable?: number | null;
}): { vf: boolean; vo: boolean } {
  return {
    vf: !!film.file_path_vf_transcoded && !film.vf_unplayable,
    vo: !!film.file_path_vo_transcoded && !film.vo_unplayable,
  };
}
