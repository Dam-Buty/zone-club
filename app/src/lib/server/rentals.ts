import { db } from './db';
import { createRentalSymlinks, deleteRentalSymlinks, getStreamingUrl } from './symlinks';
import { getFilmById, type Film } from './films';

const RENTAL_DURATION_HOURS = 24;

export interface Rental {
    id: number;
    user_id: number;
    film_id: number;
    symlink_uuid: string;
    rented_at: string;
    expires_at: string;
    is_active: boolean;
}

export interface RentalWithFilm extends Rental {
    film: Film;
    streaming_urls: {
        vf: string | null;
        vo: string | null;
        subtitles: string | null;
    };
    time_remaining: number; // minutes
}

export interface RentalStatus {
    is_rented: boolean;
    rented_by_current_user: boolean;
    rental?: RentalWithFilm;
}

export function getActiveRentalForFilm(filmId: number): Rental | null {
    return db.prepare(`
        SELECT * FROM rentals
        WHERE film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(filmId) as Rental | null;
}

export function getUserActiveRentals(userId: number): RentalWithFilm[] {
    const rentals = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now')
        ORDER BY rented_at DESC
    `).all(userId) as Rental[];

    return rentals.map(rental => enrichRental(rental)).filter((r): r is RentalWithFilm => r !== null);
}

export function getUserRentalHistory(userId: number): Rental[] {
    return db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ?
        ORDER BY rented_at DESC
    `).all(userId) as Rental[];
}

export function hasUserRentedFilm(userId: number, filmId: number): boolean {
    const rental = db.prepare(`
        SELECT 1 FROM rentals WHERE user_id = ? AND film_id = ?
    `).get(userId, filmId);
    return !!rental;
}

export function getFilmRentalStatus(filmId: number, userId: number | null): RentalStatus {
    const activeRental = getActiveRentalForFilm(filmId);

    if (!activeRental) {
        return { is_rented: false, rented_by_current_user: false };
    }

    const isCurrentUser = userId !== null && activeRental.user_id === userId;

    return {
        is_rented: true,
        rented_by_current_user: isCurrentUser,
        rental: isCurrentUser ? enrichRental(activeRental) || undefined : undefined
    };
}

function enrichRental(rental: Rental): RentalWithFilm | null {
    const film = getFilmById(rental.film_id);
    if (!film) return null;

    const expiresAt = new Date(rental.expires_at + 'Z');
    const now = new Date();
    const timeRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60000));

    return {
        ...rental,
        film,
        streaming_urls: {
            vf: film.file_path_vf ? getStreamingUrl(rental.symlink_uuid, 'film_vf.mp4') : null,
            vo: film.file_path_vo ? getStreamingUrl(rental.symlink_uuid, 'film_vo.mp4') : null,
            subtitles: film.subtitle_path ? getStreamingUrl(rental.symlink_uuid, 'subs_fr.vtt') : null
        },
        time_remaining: timeRemaining
    };
}

export async function rentFilm(userId: number, filmId: number): Promise<RentalWithFilm> {
    const film = getFilmById(filmId);
    if (!film) {
        throw new Error('Film non trouvé');
    }

    if (!film.is_available) {
        throw new Error('Ce film n\'est pas disponible');
    }

    // Check if already rented by someone else
    const existingRental = getActiveRentalForFilm(filmId);
    if (existingRental && existingRental.user_id !== userId) {
        throw new Error('Ce film est déjà loué par un autre membre');
    }

    // Check if user already has an active rental for this film
    if (existingRental && existingRental.user_id === userId) {
        return enrichRental(existingRental)!;
    }

    // Check user credits
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (user.credits < 1) {
        throw new Error('Crédits insuffisants');
    }

    // Create symlinks
    const symlinks = await createRentalSymlinks(film.tmdb_id, {
        vf: film.file_path_vf,
        vo: film.file_path_vo,
        subtitles: film.subtitle_path
    });

    // Create rental and deduct credit in transaction
    const expiresAt = new Date(Date.now() + RENTAL_DURATION_HOURS * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');

    db.transaction(() => {
        db.prepare(`
            INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, filmId, symlinks.uuid, expiresAt);

        db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
    })();

    const rental = db.prepare(`
        SELECT * FROM rentals WHERE user_id = ? AND film_id = ? AND is_active = 1
    `).get(userId, filmId) as Rental;

    return enrichRental(rental)!;
}

export async function cleanupExpiredRentals(): Promise<number> {
    const expiredRentals = db.prepare(`
        SELECT * FROM rentals
        WHERE is_active = 1 AND expires_at <= datetime('now')
    `).all() as Rental[];

    for (const rental of expiredRentals) {
        await deleteRentalSymlinks(rental.symlink_uuid);
        db.prepare('UPDATE rentals SET is_active = 0 WHERE id = ?').run(rental.id);
    }

    return expiredRentals.length;
}
