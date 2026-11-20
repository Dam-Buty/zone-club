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
  /** Quand la fin ne se décode pas : l'anomalie avec sa raison, telle que `tailAnomaly` la rend. */
  tailAnomaly?: string | null;
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
  if (!probe.tailDecodes) anomalies.push(probe.tailAnomaly ?? 'fin indécodable');
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

/** Longueur maximale de la ligne d'erreur de ffmpeg recopiée dans une anomalie. */
const STDERR_LINE_MAX = 120;

/**
 * Le verdict du décodage des dix dernières secondes (`ffmpeg -progress pipe:1 -v error -sseof -10 -i <fichier> -f null -`),
 * avec sa raison : `null` si la fin se décode, sinon l'anomalie « fin indécodable … ». La fin se décode quand ffmpeg
 * sort avec 0, sans une ligne d'erreur, ET a décodé quelque chose (`out_time_us` > 0 dans la progression). Le dernier
 * point compte : un fichier coupé bien avant sa fin fait sauter ffmpeg au-delà des données, il ne décode rien, ne le
 * signale que par un avertissement (muet en `-v error`) et sort avec 0 — vérifié le 20/11/2026 sur un MP4 coupé à 60 %
 * de ses octets. La règle est stricte (la moindre ligne d'erreur suffit) : la raison est là pour que l'opérateur juge
 * une ligne bénigne avant de lancer `--mark`. `timedOut` : ffmpeg tué au bout de 60 s.
 */
export function tailAnomaly(run: { code: number | null; stderr: string; progress: string; timedOut: boolean }): string | null {
  if (run.timedOut) return 'fin indécodable (délai dépassé)';
  const firstError = run.stderr.split('\n').map((line) => line.trim()).find((line) => line !== '');
  if (firstError !== undefined) {
    // « [h264 @ 0x87505d500] … » → « [h264] … » : l'adresse mémoire change à chaque lancement et n'apprend rien.
    const line = firstError.replace(/ @ 0x[0-9a-f]+\]/gi, ']');
    return `fin indécodable : ${line.length > STDERR_LINE_MAX ? `${line.slice(0, STDERR_LINE_MAX - 1)}…` : line}`;
  }
  if (run.code === null) return 'fin indécodable (interrompu)';
  if (run.code !== 0) return `fin indécodable (code de sortie ${run.code})`;
  const positions = [...run.progress.matchAll(/^out_time_us=(.*)$/gm)];
  const decodedUs = positions.length > 0 ? Number(positions[positions.length - 1][1]) : 0;
  return decodedUs > 0 ? null : 'fin indécodable (rien décodé)';
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
