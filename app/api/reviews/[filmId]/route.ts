import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createReview, updateReview, getReviewsByFilm, getFilmRatings, canUserReview } from '@/lib/reviews';
import { getUserFromSession } from '@/lib/session';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);

    if (isNaN(filmId)) {
        return NextResponse.json({ error: 'ID film invalide' }, { status: 400 });
    }

    const reviews = getReviewsByFilm(filmId);
    const ratings = getFilmRatings(filmId);

    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    let canReview: { allowed: boolean; reason?: string } = { allowed: false, reason: 'Non authentifié' };
    if (user) {
        canReview = canUserReview(user.id, filmId, user.is_admin);
    }

    return NextResponse.json({ reviews, ratings, canReview });
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);
    const { content, rating_direction, rating_screenplay, rating_acting } = await request.json();

    if (typeof content !== 'string' || content.length > 10000) {
        return NextResponse.json({ error: 'Critique trop longue (max 10 000 caracteres)' }, { status: 400 });
    }

    try {
        const review = createReview(user.id, filmId, content, {
            direction: rating_direction,
            screenplay: rating_screenplay,
            acting: rating_acting
        }, user.is_admin);
        return NextResponse.json({ review });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);
    const { content, rating_direction, rating_screenplay, rating_acting } = await request.json();

    if (typeof content !== 'string' || content.length > 10000) {
        return NextResponse.json({ error: 'Critique trop longue (max 10 000 caracteres)' }, { status: 400 });
    }

    try {
        const review = updateReview(user.id, filmId, content, {
            direction: rating_direction,
            screenplay: rating_screenplay,
            acting: rating_acting
        });
        return NextResponse.json({ review });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
