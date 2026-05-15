import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserActiveRentals, getUserRentalHistory } from '@/lib/rentals';
import { getUserReviews } from '@/lib/reviews';
import { getUserFromSession } from '@/lib/session';
import { canClaimWeeklyBonus } from '@/lib/bonus';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const activeRentals = getUserActiveRentals(user.id);
    const rentalHistory = getUserRentalHistory(user.id);
    const reviews = getUserReviews(user.id);
    const weeklyBonus = canClaimWeeklyBonus(user.id);

    const response = NextResponse.json({
        user: {
            id: user.id,
            username: user.username,
            credits: user.credits,
            is_admin: user.is_admin,
            created_at: user.created_at
        },
        activeRentals,
        rentalHistory,
        reviews,
        weeklyBonus
    });
    // Auth-sensitive payload: never cache. The old `private, max-age=60` was
    // leaking session data after logout — the browser kept serving the cached
    // response for 60s, so the app stayed "logged in" client-side.
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
