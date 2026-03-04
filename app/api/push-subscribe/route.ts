import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserFromSession } from "@/lib/session";
import { savePushSubscription } from "@/lib/push";

// POST — Register a push subscription
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { subscription } = await request.json();

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json(
      { error: "Subscription invalide" },
      { status: 400 },
    );
  }

  try {
    savePushSubscription(user.id, subscription);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
