import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseFilm } from '@/lib/films';

// 3 dernières locations rendues — affichées sur le comptoir manager
// Fallback: 3 films aléatoires disponibles si pas assez de locations rendues
export async function GET() {
    try {
        // Chercher les 3 dernières locations rendues (is_active=0)
        const returned = db.prepare(`
            SELECT f.* FROM films f WHERE f.id IN (
                SELECT DISTINCT film_id FROM rentals WHERE is_active = 0
                ORDER BY rented_at DESC LIMIT 3
            ) AND f.is_available = 1
        `).all().map(parseFilm);

        if (returned.length >= 3) {
            return NextResponse.json(returned, {
                headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
            });
        }

        // Fallback: compléter avec des films aléatoires
        const existingIds = returned.map(f => f.id);
        const needed = 3 - returned.length;
        let random;
        if (existingIds.length > 0) {
            const placeholders = existingIds.map(() => '?').join(',');
            random = db.prepare(`
                SELECT * FROM films
                WHERE is_available = 1 AND id NOT IN (${placeholders})
                ORDER BY RANDOM()
                LIMIT ?
            `).all(...existingIds, needed).map(parseFilm);
        } else {
            random = db.prepare(`
                SELECT * FROM films
                WHERE is_available = 1
                ORDER BY RANDOM()
                LIMIT ?
            `).all(needed).map(parseFilm);
        }

        const result = [...returned, ...random];
        return NextResponse.json(result, {
            headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
        });
    } catch (error) {
        console.error('desk-display error:', error);
        return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    }
}
