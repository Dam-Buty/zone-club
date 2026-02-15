import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserActiveRentals, getUserRentalHistory } from '@/lib/rentals';
import { getUserReviews } from '@/lib/reviews';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const activeRentals = getUserActiveRentals(user.id);
    const rentalHistory = getUserRentalHistory(user.id);
    const reviews = getUserReviews(user.id);

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
        reviews
    });
    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
}
