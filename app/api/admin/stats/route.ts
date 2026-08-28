import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getUserFromSession } from '@/lib/session';

/** Les COUNT(*) de cette route renvoient tous la même forme. */
function countOf(sql: string): number {
    return (db.prepare(sql).get() as { count: number }).count;
}

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const stats = {
        totalUsers: countOf('SELECT COUNT(*) as count FROM users'),
        totalFilms: countOf('SELECT COUNT(*) as count FROM films'),
        availableFilms: countOf('SELECT COUNT(*) as count FROM films WHERE is_available = 1'),
        activeRentals: countOf("SELECT COUNT(*) as count FROM rentals WHERE is_active = 1 AND expires_at > datetime('now')"),
        totalRentals: countOf('SELECT COUNT(*) as count FROM rentals'),
        totalReviews: countOf('SELECT COUNT(*) as count FROM reviews'),
        pendingRequests: countOf("SELECT COUNT(*) as count FROM film_requests WHERE status = 'pending'"),

        // Films per aisle
        filmsPerAisle: db.prepare(
            `SELECT aisle, COUNT(*) as count FROM films
             WHERE aisle IS NOT NULL AND is_available = 1
             GROUP BY aisle ORDER BY count DESC`
        ).all() as { aisle: string; count: number }[],

        // Rentals last 14 days
        recentRentals: db.prepare(
            `SELECT DATE(rented_at) as day, COUNT(*) as count FROM rentals
             WHERE rented_at >= datetime('now', '-14 days')
             GROUP BY DATE(rented_at) ORDER BY day`
        ).all() as { day: string; count: number }[],

        // Top 5 most rented films
        topRentedFilms: db.prepare(
            `SELECT f.title, COUNT(r.id) as rental_count FROM films f
             JOIN rentals r ON r.film_id = f.id
             GROUP BY f.id ORDER BY rental_count DESC LIMIT 5`
        ).all() as { title: string; rental_count: number }[],
    };

    return NextResponse.json(stats);
}
