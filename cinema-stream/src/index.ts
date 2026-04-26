import { loadPlaylist } from "./playlist.ts";
import { FfmpegSupervisor } from "./ffmpeg-runner.ts";
import { startEpochSec, PLAYLIST_START } from "./config.ts";

async function main() {
  console.log(
    `[cinema-stream] PLAYLIST_START=${PLAYLIST_START} (epoch ${startEpochSec})`,
  );
  const state = await loadPlaylist();
  if (state.films.length === 0) {
    console.error("[cinema-stream] No films with VF found, exiting.");
    process.exit(1);
  }
  const supervisor = new FfmpegSupervisor(state);
  supervisor.start();

  const shutdown = () => {
    console.log("[cinema-stream] shutting down...");
    supervisor.stop();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[cinema-stream] fatal:", err);
  process.exit(1);
});
