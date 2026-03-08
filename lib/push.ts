import webpush from "web-push";
import { db } from "./db";

interface PushSubscriptionRecord {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Configure VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@lazone.at";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function savePushSubscription(
  userId: number,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): void {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = ?, p256dh = ?, auth = ?`,
  ).run(
    userId,
    subscription.endpoint,
    subscription.keys.p256dh,
    subscription.keys.auth,
    userId,
    subscription.keys.p256dh,
    subscription.keys.auth,
  );
}

export function getUserPushSubscriptions(
  userId: number,
): PushSubscriptionRecord[] {
  return db
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as PushSubscriptionRecord[];
}

export async function sendPushNotification(
  userId: number,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  const subscriptions = getUserPushSubscriptions(userId);

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
      );
    } catch (err: unknown) {
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode: number }).statusCode
          : 0;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or invalid — remove
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      }
    }
  }
}
