import Database from "better-sqlite3";
import { join } from "node:path";
import {
  DATABASE_PATH,
  FILMS_VF_ROOT,
  startEpochSec,
} from "./config.ts";

interface FilmRow {
  id: number;
  title: string;
  release_year: number | null;
  file_path_vf: string | null;
  file_path_vf_transcoded: string | null;
  duration_sec: number | null;
}

export interface PlaylistFilm {
  id: number;
  title: string;
  year: number | null;
  absolutePath: string;
  durationSec: number;
}

export interface PlaylistState {
  films: PlaylistFilm[];
  totalSec: number;
}

export interface CurrentPosition {
  film: PlaylistFilm;
  index: number;
  offsetSec: number;
}

export function loadPlaylist(): PlaylistState {
  const db = new Database(DATABASE_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, title, release_year, file_path_vf, file_path_vf_transcoded, duration_sec
       FROM films
       WHERE file_path_vf IS NOT NULL AND duration_sec IS NOT NULL
       ORDER BY id`,
    )
    .all() as FilmRow[];

  const missingCount = (
    db
      .prepare(
        "SELECT COUNT(*) as n FROM films WHERE file_path_vf IS NOT NULL AND duration_sec IS NULL",
      )
      .get() as { n: number }
  ).n;
  db.close();

  const films: PlaylistFilm[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.release_year,
    absolutePath: join(
      FILMS_VF_ROOT,
      row.file_path_vf_transcoded ?? row.file_path_vf!,
    ),
    durationSec: row.duration_sec!,
  }));

  const totalSec = films.reduce((acc, f) => acc + f.durationSec, 0);
  console.log(
    `[playlist] ${films.length} films cached, total ${formatDuration(totalSec)}` +
      (missingCount > 0
        ? ` (${missingCount} sans duration_sec — démarre cinema-stream pour les probe)`
        : ""),
  );
  return { films, totalSec };
}

export function currentPosition(
  state: PlaylistState,
  atEpochSec: number = Date.now() / 1000,
): CurrentPosition {
  const total = state.totalSec;
  if (total <= 0) throw new Error("Empty playlist");
  const elapsed = atEpochSec - startEpochSec;
  const positionInLoop = ((elapsed % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < state.films.length; i++) {
    const film = state.films[i];
    if (positionInLoop < acc + film.durationSec) {
      return { film, index: i, offsetSec: positionInLoop - acc };
    }
    acc += film.durationSec;
  }
  return { film: state.films[0], index: 0, offsetSec: 0 };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}
