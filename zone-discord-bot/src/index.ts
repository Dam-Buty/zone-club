import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_VOICE_CHANNEL_ID,
  PLAYLIST_START,
  STATUS_REFRESH_MS,
  startEpochSec,
} from "./config.ts";
import { loadPlaylist } from "./playlist.ts";
import { updateStatus } from "./status.ts";

async function main() {
  console.log(
    `[bot] PLAYLIST_START=${PLAYLIST_START} (epoch ${startEpochSec})`,
  );
  const state = loadPlaylist();
  if (state.films.length === 0) {
    console.error("[bot] No films with VF found, exiting.");
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  let voiceConnection: VoiceConnection | null = null;

  client.once("clientReady", async () => {
    console.log(`[bot] logged in as ${client.user?.tag}`);

    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    const channel = await guild.channels.fetch(DISCORD_VOICE_CHANNEL_ID);
    const me = await guild.members.fetchMe();
    if (channel && "permissionsFor" in channel) {
      const perms = channel.permissionsFor(me);
      const required = ["ViewChannel", "Connect", "Speak"] as const;
      const missing = required.filter((p) => !perms?.has(p));
      console.log(
        `[bot] channel perms: ${perms?.toArray().join(", ") || "none"}`,
      );
      if (missing.length > 0) {
        console.error(
          `[bot] missing required permissions in channel: ${missing.join(", ")}`,
        );
      }
    }

    voiceConnection = joinVoiceChannel({
      guildId: DISCORD_GUILD_ID,
      channelId: DISCORD_VOICE_CHANNEL_ID,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    voiceConnection.on("error", (err) => {
      console.error(`[voice:error] ${err.message}`);
    });

    voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn("[voice] disconnected, attempting to recover...");
      try {
        await Promise.race([
          entersState(voiceConnection!, VoiceConnectionStatus.Signalling, 5_000),
          entersState(voiceConnection!, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        voiceConnection?.destroy();
        process.exit(1);
      }
    });

    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 30_000);
      console.log(
        `[bot] joined voice channel ${DISCORD_VOICE_CHANNEL_ID} in guild ${DISCORD_GUILD_ID}`,
      );
    } catch (err) {
      console.error("[bot] voice connection failed to become ready:", err);
      voiceConnection.destroy();
      process.exit(1);
    }

    await updateStatus(client, state);
    setInterval(() => {
      updateStatus(client, state).catch((err) =>
        console.error("[bot] status update error:", err),
      );
    }, STATUS_REFRESH_MS);
  });

  const shutdown = () => {
    console.log("[bot] shutting down...");
    voiceConnection?.destroy();
    client.destroy();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.login(DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error("[bot] fatal:", err);
  process.exit(1);
});
