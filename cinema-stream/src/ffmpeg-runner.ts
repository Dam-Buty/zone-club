import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HLS_OUT_DIR } from "./config.ts";
import { type PlaylistState, currentPosition } from "./playlist.ts";

const REPEAT_PASSES = 50;
const HLS_SEGMENT_SEC = 4;
const HLS_LIST_SIZE = 6;
const RESTART_DELAY_MS = 2000;

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

  constructor(state: PlaylistState) {
    this.state = state;
  }

  start(): void {
    if (!existsSync(HLS_OUT_DIR)) {
      mkdirSync(HLS_OUT_DIR, { recursive: true });
    }
    clearOldSegments();
    this.spawnFfmpeg();
  }

  stop(): void {
    this.stopped = true;
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
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
      if (this.stopped) return;
      setTimeout(() => this.spawnFfmpeg(), RESTART_DELAY_MS);
    });

    this.proc.on("error", (err) => {
      console.error("[ffmpeg] error:", err);
    });
  }
}
