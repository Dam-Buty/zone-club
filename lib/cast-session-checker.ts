import {
  getExpiredUnnotifiedSessions,
  markSessionNotified,
} from "./cast-sessions";
import { sendPushNotification } from "./push";
import { db } from "./db";
import { completeCastRental } from "./cast-completion";

const CHECK_INTERVAL_MS = 60_000; // 60 seconds

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function checkExpiredSessions(): Promise<void> {
  const sessions = getExpiredUnnotifiedSessions();

  for (const session of sessions) {
    // D'abord la location, sans dépendre de la notification : un visiteur sans abonnement aux
    // notifications doit aussi retrouver son film noté vu (spec 2026-11-17-cast-suivi-serveur).
    try {
      completeCastRental(db, session);
      // Séance menée à son terme : on la clôt ici, sinon elle resterait « ouverte » à jamais et le
      // prochain envoi de position du téléphone la mettrait à jour au lieu d'en ouvrir une nouvelle.
      db.prepare("UPDATE cast_sessions SET ended = 1 WHERE id = ?").run(session.id);
    } catch {
      // Ni notification ni marque « notifiée » : la séance est rejouée au passage suivant.
      continue;
    }
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
      // Notification échouée : la séance est déjà close, elle n'est plus rejouée. La location, elle, est notée
      // (sendPushNotification absorbe déjà l'échec de chaque abonnement ; seule une erreur de base arrive ici).
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
