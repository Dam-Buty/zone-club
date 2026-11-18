import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserFromSession } from "@/lib/session";
import { getFilmById } from "@/lib/films";
import {
  createCastSession,
  updateCastSession,
  endCastSession,
} from "@/lib/cast-sessions";

// POST — Ouvre la séance de Cast (ou met à jour celle qui est ouverte). La durée est facultative : le
// téléphone ne la connaît pas toujours au lancement, le serveur retombe alors sur celle du film.
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId, currentPosition, durationSeconds } = await request.json();

  if (!filmId) {
    return NextResponse.json({ error: "filmId requis" }, { status: 400 });
  }

  if (!getFilmById(filmId)) {
    return NextResponse.json({ error: "Film inconnu" }, { status: 404 });
  }

  try {
    const opening = createCastSession(
      user.id,
      filmId,
      currentPosition,
      durationSeconds,
    );
    if (opening.status === "unknown-duration") {
      return NextResponse.json(
        { error: "Durée du film inconnue" },
        { status: 400 },
      );
    }
    // Sans location active, pas de séance : ce n'est pas une erreur, le client n'a rien à suivre.
    return NextResponse.json({
      session: opening.status === "opened" ? opening.session : null,
    });
  } catch (err) {
    console.error('cast-sessions POST error:', err);
    return NextResponse.json(
      { error: "Erreur interne" },
      { status: 500 },
    );
  }
}

// PATCH — Position (et durée corrigée) de la séance ouverte ; sans séance ouverte, le serveur en rouvre une
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId, currentPosition, durationSeconds } = await request.json();

  if (!filmId || currentPosition === undefined) {
    return NextResponse.json(
      { error: "filmId et currentPosition requis" },
      { status: 400 },
    );
  }

  if (!getFilmById(filmId)) {
    return NextResponse.json({ error: "Film inconnu" }, { status: 404 });
  }

  try {
    const ok = updateCastSession(
      user.id,
      filmId,
      currentPosition,
      durationSeconds,
    );
    return NextResponse.json({ ok });
  } catch (err) {
    console.error('cast-sessions PATCH error:', err);
    return NextResponse.json(
      { error: "Erreur interne" },
      { status: 500 },
    );
  }
}

// DELETE — Clôt la séance. `finished: true` : le téléphone a vu le film se terminer, la location est notée
// vue. Sinon c'est un arrêt en cours de film : la location n'est pas touchée, la position est notée.
export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const user = getUserFromSession(cookieStore.get("session")?.value);
  if (!user)
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { filmId, currentPosition, finished } = await request.json();

  if (!filmId) {
    return NextResponse.json({ error: "filmId requis" }, { status: 400 });
  }

  if (!getFilmById(filmId)) {
    return NextResponse.json({ error: "Film inconnu" }, { status: 404 });
  }

  try {
    endCastSession(user.id, filmId, {
      position: currentPosition,
      finished: finished === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('cast-sessions DELETE error:', err);
    return NextResponse.json(
      { error: "Erreur interne" },
      { status: 500 },
    );
  }
}
