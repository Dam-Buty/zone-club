import Database from "better-sqlite3";
import ffmpeg from "fluent-ffmpeg";
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

function probeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) return reject(err);
      const d = data.format?.duration;
      if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) {
        return reject(new Error(`No duration for ${path}`));
      }
      resolve(d);
    });
  });
}

export async function loadPlaylist(): Promise<PlaylistState> {
  const db = new Database(DATABASE_PATH);

  try {
    db.exec("ALTER TABLE films ADD COLUMN duration_sec REAL DEFAULT NULL");
  } catch {}

  const rows = db
    .prepare(
      `SELECT id, title, release_year, file_path_vf, file_path_vf_transcoded, duration_sec
       FROM films
       WHERE file_path_vf IS NOT NULL
       ORDER BY id`,
    )
    .all() as FilmRow[];

  const updateDuration = db.prepare(
    "UPDATE films SET duration_sec = ? WHERE id = ?",
  );

  const films: PlaylistFilm[] = [];
  let probedCount = 0;
  for (const row of rows) {
    const relative = row.file_path_vf_transcoded ?? row.file_path_vf!;
    const absolutePath = join(FILMS_VF_ROOT, relative);

    let durationSec = row.duration_sec;
    if (durationSec == null) {
      try {
        durationSec = await probeDuration(absolutePath);
        updateDuration.run(durationSec, row.id);
        probedCount++;
        console.log(
          `[playlist] probed ${row.title}: ${formatDuration(durationSec)}`,
        );
      } catch (err) {
        console.warn(
          `[playlist] skipping ${row.title}:`,
          (err as Error).message,
        );
        continue;
      }
    }

    films.push({
      id: row.id,
      title: row.title,
      year: row.release_year,
      absolutePath,
      durationSec,
    });
  }

  db.close();

  const totalSec = films.reduce((acc, f) => acc + f.durationSec, 0);
  console.log(
    `[playlist] ${films.length} films loaded (${probedCount} freshly probed), total ${formatDuration(totalSec)}`,
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
