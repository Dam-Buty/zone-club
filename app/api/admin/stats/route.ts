import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const stats = {
        totalUsers: (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count,
        totalFilms: (db.prepare('SELECT COUNT(*) as count FROM films').get() as any).count,
        availableFilms: (db.prepare('SELECT COUNT(*) as count FROM films WHERE is_available = 1').get() as any).count,
        activeRentals: (db.prepare("SELECT COUNT(*) as count FROM rentals WHERE is_active = 1 AND expires_at > datetime('now')").get() as any).count,
        totalRentals: (db.prepare('SELECT COUNT(*) as count FROM rentals').get() as any).count,
        totalReviews: (db.prepare('SELECT COUNT(*) as count FROM reviews').get() as any).count,
        pendingRequests: (db.prepare("SELECT COUNT(*) as count FROM film_requests WHERE status = 'pending'").get() as any).count,
    };

    return NextResponse.json(stats);
}
