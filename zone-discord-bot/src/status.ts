import { ActivityType, type Client } from "discord.js";
import {
  type PlaylistState,
  currentPosition,
  formatDuration,
} from "./playlist.ts";
import { DISCORD_VOICE_CHANNEL_ID } from "./config.ts";

function statusLine(state: PlaylistState): {
  channelStatus: string;
  activityName: string;
} {
  const pos = currentPosition(state);
  const yearSuffix = pos.film.year ? ` (${pos.film.year})` : "";
  const elapsed = formatDuration(pos.offsetSec);
  const total = formatDuration(pos.film.durationSec);
  return {
    channelStatus: `🎬 ${pos.film.title}${yearSuffix} — ${elapsed} / ${total}`,
    activityName: `${pos.film.title}${yearSuffix}`,
  };
}

export async function updateStatus(
  client: Client,
  state: PlaylistState,
): Promise<void> {
  const { channelStatus, activityName } = statusLine(state);

  if (client.user) {
    client.user.setActivity({
      type: ActivityType.Watching,
      name: activityName,
    });
  }

  try {
    await client.rest.put(
      `/channels/${DISCORD_VOICE_CHANNEL_ID}/voice-status`,
      { body: { status: channelStatus } },
    );
  } catch (err) {
    console.warn(
      "[status] voice-status update failed:",
      (err as Error).message,
    );
  }
}
