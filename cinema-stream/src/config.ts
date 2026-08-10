function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const DATABASE_PATH = process.env.DATABASE_PATH ?? "/data/zone.db";
export const FILMS_ROOT = process.env.FILMS_ROOT ?? "/media/films";
export const FILMS_VF_ROOT = process.env.FILMS_VF_ROOT ?? "/media/films-vf";
export const HLS_OUT_DIR =
  process.env.HLS_OUT_DIR ?? "/media/public/symlinks/cinema-live";
export const PLAYLIST_START = required("PLAYLIST_START");

export const startEpochSec = parisMidnightToUtcEpoch(PLAYLIST_START);

function parisMidnightToUtcEpoch(yyyymmdd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!m)
    throw new Error(`PLAYLIST_START must be YYYY-MM-DD, got: ${yyyymmdd}`);
  const [, y, mo, d] = m;

  const naive = Date.UTC(+y, +mo - 1, +d, 0, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naive));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const parisAsUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second,
  );
  const offsetMs = parisAsUtc - naive;
  return (naive - offsetMs) / 1000;
}
