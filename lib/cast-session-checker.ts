import {
  getExpiredUnnotifiedSessions,
  markSessionNotified,
} from "./cast-sessions";
import { sendPushNotification } from "./push";

const CHECK_INTERVAL_MS = 60_000; // 60 seconds

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function checkExpiredSessions(): Promise<void> {
  const sessions = getExpiredUnnotifiedSessions();

  for (const session of sessions) {
    try {
      await sendPushNotification(session.user_id, {
        title: "Zone Club",
        body: `${session.film_title} est termine ! Revenez rembobiner.`,
        data: {
          filmId: session.film_id,
          action: "castEnded",
        },
      });
      markSessionNotified(session.id);
    } catch {
      // Notification failed — will retry next interval
    }
  }
}

export function startCastSessionChecker(): void {
  if (intervalHandle) return;

  intervalHandle = setInterval(() => {
    checkExpiredSessions().catch(() => {});
  }, CHECK_INTERVAL_MS);

  // Run once immediately
  checkExpiredSessions().catch(() => {});
}
