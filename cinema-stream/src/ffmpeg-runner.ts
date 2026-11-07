import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HLS_OUT_DIR } from "./config.ts";
import {
  type PlaylistFilm,
  type PlaylistState,
  currentPosition,
  formatDuration,
} from "./playlist.ts";

const REPEAT_PASSES = 50;
const HLS_SEGMENT_SEC = 4;
const HLS_LIST_SIZE = 6;
const RESTART_DELAY_MS = 2000;
const WATCHDOG_INTERVAL_MS = 10_000;
const WATCHDOG_STALL_MS = 30_000;

const OVERLAY_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const OVERLAY_FONTSIZE = 38;
const OVERLAY_MAX_TITLE = 62;

function escapeConcatPath(path: string): string {
  return path.replace(/'/g, "'\\''");
}

function buildConcatList(
  state: PlaylistState,
  startIndex: number,
  startOffset: number,
): string {
  const lines: string[] = ["ffconcat version 1.0"];
  for (let pass = 0; pass < REPEAT_PASSES; pass++) {
    for (let i = 0; i < state.films.length; i++) {
      const film = state.films[(startIndex + i) % state.films.length];
      lines.push(`file '${escapeConcatPath(film.absolutePath)}'`);
      if (pass === 0 && i === 0 && startOffset > 0) {
        lines.push(`inpoint ${startOffset.toFixed(3)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Échappe une chaîne pour une valeur d'option drawtext passée dans un fichier
 * sendcmd. Le texte est ensuite réexpansé par drawtext : `%` doit donc être
 * doublé, et `:` échappé sinon l'option se coupe en deux.
 */
function escapeDrawtext(raw: string): string {
  return raw
    .replace(/\\/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "%%")
    .replace(/:/g, "\\:");
}

function filmLabel(film: PlaylistFilm): string {
  const label = `${film.title}${film.year ? ` (${film.year})` : ""}`;
  return label.length > OVERLAY_MAX_TITLE
    ? `${label.slice(0, OVERLAY_MAX_TITLE - 1).trimEnd()}\u2026`
    : label;
}

/**
 * Horloge « temps écoulé dans le film » sous forme d'expression drawtext, donc
 * recalculée à chaque frame sans aucune I/O : `t` est le PTS ffmpeg, et
 * `startSec` situe le début du film sur la timeline du process (~0 pour le
 * premier, négatif si on démarre au milieu de celui-ci).
 */
function clockExpr(startSec: number, withHours: boolean): string {
  // `startSec` peut être négatif (démarrage au milieu du premier film).
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
 */
export function buildOverlayCommands(
  state: PlaylistState,
  startIndex: number,
  startOffset: number,
): string {
  const n = state.films.length;
  const lines: string[] = [];
  let timeline = 0;

  for (let pass = 0; pass < REPEAT_PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      const film = state.films[(startIndex + i) % n];
      const isFirst = pass === 0 && i === 0;
      // `t` repart de 0 sur l'inpoint du premier film : son horloge démarre
      // à startOffset, donc son origine de film est -startOffset.
      const clockStart = isFirst ? -startOffset : timeline;
      const total = escapeDrawtext(formatDuration(film.durationSec));
      const clock = clockExpr(clockStart, film.durationSec >= 3600);

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

function clearOldSegments(): void {
  if (!existsSync(HLS_OUT_DIR)) return;
  for (const name of readdirSync(HLS_OUT_DIR)) {
    if (name.endsWith(".ts") || name === "live.m3u8") {
      try {
        unlinkSync(join(HLS_OUT_DIR, name));
      } catch {}
    }
  }
}

export class FfmpegSupervisor {
  private proc: ChildProcess | null = null;
  private state: PlaylistState;
  private stopped = false;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(state: PlaylistState) {
    this.state = state;
  }

  start(): void {
    if (!existsSync(HLS_OUT_DIR)) {
      mkdirSync(HLS_OUT_DIR, { recursive: true });
    }
    clearOldSegments();
    this.spawnFfmpeg();
    this.watchdog = setInterval(
      () => this.checkProgress(),
      WATCHDOG_INTERVAL_MS,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  private checkProgress(): void {
    if (!this.proc || this.stopped) return;
    const playlist = join(HLS_OUT_DIR, "live.m3u8");
    if (!existsSync(playlist)) return;
    const ageMs = Date.now() - statSync(playlist).mtimeMs;
    if (ageMs > WATCHDOG_STALL_MS) {
      console.warn(
        `[watchdog] live.m3u8 not updated in ${Math.round(ageMs / 1000)}s, killing ffmpeg`,
      );
      this.proc.kill("SIGKILL");
    }
  }

  private spawnFfmpeg(): void {
    const pos = currentPosition(this.state);
    console.log(
      `[ffmpeg] starting at film #${pos.index + 1}/${this.state.films.length}: ${pos.film.title} @ ${pos.offsetSec.toFixed(1)}s`,
    );

    const concatPath = join(tmpdir(), `cinema-concat-${Date.now()}.txt`);
    const concat = buildConcatList(this.state, pos.index, pos.offsetSec);
    writeFileSync(concatPath, concat);

    const overlayPath = join(tmpdir(), `cinema-overlay-${Date.now()}.txt`);
    const overlay = buildOverlayCommands(this.state, pos.index, pos.offsetSec);
    writeFileSync(overlayPath, overlay);
    console.log(
      `[ffmpeg] overlay: ${overlay.split("\n").length - 1} cues, ${(overlay.length / 1024).toFixed(0)} KiB`,
    );

    // `sendcmd` en tête de chaîne : il réinjecte les `reinit` dans le drawtext
    // nommé (@ov) aux frontières de films, sans quitter le filtre vidéo.
    const videoFilter =
      `sendcmd=f=${overlayPath},` +
      `drawtext@ov=fontfile=${OVERLAY_FONT}:text=.:fontsize=${OVERLAY_FONTSIZE}` +
      `:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=48:y=48`;

    const playlistPath = join(HLS_OUT_DIR, "live.m3u8");

    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-re",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-g",
      String(HLS_SEGMENT_SEC * 30),
      "-keyint_min",
      String(HLS_SEGMENT_SEC * 30),
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      String(HLS_SEGMENT_SEC),
      "-hls_list_size",
      String(HLS_LIST_SIZE),
      "-hls_flags",
      "delete_segments+omit_endlist+independent_segments",
      "-hls_segment_filename",
      join(HLS_OUT_DIR, "seg-%05d.ts"),
      playlistPath,
    ];

    this.proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "inherit", "inherit"],
    });

    this.proc.on("exit", (code, signal) => {
      console.log(`[ffmpeg] exited code=${code} signal=${signal}`);
      this.proc = null;
      try {
        unlinkSync(concatPath);
      } catch {}
      try {
        unlinkSync(overlayPath);
      } catch {}
      if (this.stopped) return;
      setTimeout(() => this.spawnFfmpeg(), RESTART_DELAY_MS);
    });

    this.proc.on("error", (err) => {
      console.error("[ffmpeg] error:", err);
    });
  }
}
