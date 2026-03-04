import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserFromSession } from "@/lib/session";
import {
  createCastSession,
  updateCastSession,
  endCastSession,
} from "@/lib/cast-sessions";

// POST — Create a new cast session
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId, durationSeconds, currentPosition } = await request.json();

  if (!filmId || !durationSeconds) {
    return NextResponse.json(
      { error: "filmId et durationSeconds requis" },
      { status: 400 },
    );
  }

  try {
    const session = createCastSession(
      user.id,
      filmId,
      durationSeconds,
      currentPosition || 0,
    );
    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

// PATCH — Update cast session position
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId, currentPosition } = await request.json();

  if (!filmId || currentPosition === undefined) {
    return NextResponse.json(
      { error: "filmId et currentPosition requis" },
      { status: 400 },
    );
  }

  try {
    updateCastSession(user.id, filmId, currentPosition);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

// DELETE — End a cast session
export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId } = await request.json();

  if (!filmId) {
    return NextResponse.json({ error: "filmId requis" }, { status: 400 });
  }

  try {
    endCastSession(user.id, filmId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
