import { NextRequest, NextResponse } from 'next/server';
import { getFilmsByAisle, getNouveautes } from '@/lib/films';
import { db } from '@/lib/db';

const VALID_AISLES = ['action', 'horreur', 'sf', 'comedie', 'classiques', 'bizarre', 'drame', 'thriller', 'policier', 'animation'];

function enrichFilmsWithStock(films: { id: number; stock?: number }[]) {
    if (films.length === 0) return films;
    const filmIds = films.map(f => f.id);
    const placeholders = filmIds.map(() => '?').join(',');
    const rentalCounts = db.prepare(`
        SELECT film_id, COUNT(*) as count
        FROM rentals
        WHERE film_id IN (${placeholders})
        AND is_active = 1 AND expires_at > datetime('now')
        GROUP BY film_id
    `).all(...filmIds) as { film_id: number; count: number }[];
    const rentalCountMap = new Map(rentalCounts.map(r => [r.film_id, r.count]));
    return films.map(f => ({
        ...f,
        stock: f.stock ?? 2,
        active_rentals: rentalCountMap.get(f.id) ?? 0,
    }));
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ aisle: string }> }
) {
    const { aisle } = await params;

    if (aisle === 'nouveautes') {
        const films = getNouveautes();
        const filmsWithStock = enrichFilmsWithStock(films);
        const response = NextResponse.json({ aisle, films: filmsWithStock });
        response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
        return response;
    }

    if (!VALID_AISLES.includes(aisle)) {
        return NextResponse.json({ error: 'Allée invalide' }, { status: 400 });
    }

    const films = getFilmsByAisle(aisle);
    const filmsWithStock = enrichFilmsWithStock(films);
    const response = NextResponse.json({ aisle, films: filmsWithStock });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return response;
}
