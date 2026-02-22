import { db } from './db';
import { createRentalSymlinks, deleteRentalSymlinks, getStreamingUrl } from './symlinks';
import { getFilmById, getFilmTier, type Film } from './films';
import { RENTAL_COSTS, RENTAL_DURATIONS } from '../src/types';
import { access } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface Rental {
    id: number;
    user_id: number;
    film_id: number;
    symlink_uuid: string;
    rented_at: string;
    expires_at: string;
    is_active: boolean;
    watch_progress: number;
    watch_completed_at: string | null;
    extension_used: number; // SQLite boolean (0/1)
    rewind_claimed: number; // SQLite boolean (0/1)
    suggestion_film_id: number | null;
    viewing_mode: string | null;
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

export interface RentalDownloadSource {
    absolutePath: string;
    filename: string;
}

const SYMLINKS_PATH = process.env.SYMLINKS_PATH || '/media/public/symlinks';
const FORCED_RENTAL_VIDEO_URL = process.env.FORCED_RENTAL_VIDEO_URL || null;
const FORCED_RENTAL_FILE_PATH = process.env.FORCED_RENTAL_FILE_PATH || null;
const IS_FORCED_RENTAL_MODE = !!(FORCED_RENTAL_VIDEO_URL || FORCED_RENTAL_FILE_PATH);

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

    const streamingUrls = FORCED_RENTAL_VIDEO_URL
        ? {
            vf: FORCED_RENTAL_VIDEO_URL,
            vo: FORCED_RENTAL_VIDEO_URL,
            subtitles: null
        }
        : {
            vf: film.file_path_vf_transcoded ? getStreamingUrl(rental.symlink_uuid, 'film_vf.mp4') : null,
            vo: film.file_path_vo_transcoded ? getStreamingUrl(rental.symlink_uuid, 'film_vo.mp4') : null,
            subtitles: film.subtitle_path ? getStreamingUrl(rental.symlink_uuid, 'subs_fr.vtt') : null
        };

    return {
        ...rental,
        film,
        streaming_urls: streamingUrls,
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

    const existingRental = getActiveRentalForFilm(filmId);
    if (existingRental && existingRental.user_id !== userId) {
        throw new Error('Ce film est déjà loué par un autre membre');
    }

    if (existingRental && existingRental.user_id === userId) {
        return enrichRental(existingRental)!;
    }

    const tier = getFilmTier(film);
    const cost = RENTAL_COSTS[tier];
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (user.credits < cost) {
        throw new Error(`Crédits insuffisants (${cost} requis, ${user.credits} disponibles)`);
    }

    const symlinks = IS_FORCED_RENTAL_MODE
        ? { uuid: `forced-${randomUUID()}` }
        : await createRentalSymlinks(film.tmdb_id, {
            vf: film.file_path_vf_transcoded,
            vo: film.file_path_vo_transcoded,
            subtitles: film.subtitle_path
        });

    const durationMs = RENTAL_DURATIONS[tier];
    const expiresAt = new Date(Date.now() + durationMs)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');

    db.transaction(() => {
        db.prepare(`
            INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, filmId, symlinks.uuid, expiresAt);

        db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(cost, userId);
    })();

    const rental = db.prepare(`
        SELECT * FROM rentals WHERE user_id = ? AND film_id = ? AND is_active = 1
    `).get(userId, filmId) as Rental;

    return enrichRental(rental)!;
}

export function updateWatchProgress(userId: number, filmId: number, progress: number): void {
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));

    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(userId, filmId) as Rental | null;

    if (!rental) throw new Error('Location active non trouvée');

    // Only update if progress increased (no going backward)
    if (clampedProgress <= rental.watch_progress) return;

    db.prepare(`
        UPDATE rentals SET watch_progress = ? WHERE id = ?
    `).run(clampedProgress, rental.id);

    // Mark as completed when reaching 80%
    if (clampedProgress >= 80 && !rental.watch_completed_at) {
        db.prepare(`
            UPDATE rentals SET watch_completed_at = datetime('now') WHERE id = ?
        `).run(rental.id);
    }
}

const EXTENSION_HOURS = 48;
const EXTENSION_COST = 1;

export function extendRental(userId: number, filmId: number): RentalWithFilm {
    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(userId, filmId) as Rental | null;

    if (!rental) throw new Error('Location active non trouvée');
    if (rental.extension_used) throw new Error('Prolongation déjà utilisée');

    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (user.credits < EXTENSION_COST) throw new Error('Crédits insuffisants');

    const currentExpiry = new Date(rental.expires_at + 'Z');
    const newExpiry = new Date(currentExpiry.getTime() + EXTENSION_HOURS * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').replace('Z', '');

    db.transaction(() => {
        db.prepare('UPDATE rentals SET expires_at = ?, extension_used = 1 WHERE id = ?')
            .run(newExpiry, rental.id);
        db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?')
            .run(EXTENSION_COST, userId);
    })();

    return enrichRental(db.prepare('SELECT * FROM rentals WHERE id = ?').get(rental.id) as Rental)!;
}

export function claimRewindCredit(userId: number, filmId: number): void {
    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ? AND is_active = 1
    `).get(userId, filmId) as Rental | null;

    if (!rental) throw new Error('Location non trouvée');
    if (rental.watch_progress < 80) throw new Error('Film non visionné (80% requis)');
    if (rental.rewind_claimed) throw new Error('Crédit rembobinage déjà réclamé');

    db.transaction(() => {
        db.prepare('UPDATE rentals SET rewind_claimed = 1 WHERE id = ?').run(rental.id);
        db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId);
    })();
}

export function setViewingMode(userId: number, filmId: number, mode: 'sur_place' | 'emporter'): RentalWithFilm {
    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(userId, filmId) as Rental | null;

    if (!rental) throw new Error('Location active non trouvée');

    db.prepare('UPDATE rentals SET viewing_mode = ? WHERE id = ?').run(mode, rental.id);

    return enrichRental(db.prepare('SELECT * FROM rentals WHERE id = ?').get(rental.id) as Rental)!;
}

function sanitizeDownloadName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'film';
}

export async function getRentalDownloadSource(userId: number, filmId: number): Promise<RentalDownloadSource> {
    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(userId, filmId) as Rental | null;

    if (!rental) throw new Error('Location active non trouvée');

    const film = getFilmById(filmId);
    if (!film) throw new Error('Film non trouvé');

    if (FORCED_RENTAL_FILE_PATH) {
        try {
            await access(FORCED_RENTAL_FILE_PATH);
        } catch {
            throw new Error('FORCED_RENTAL_FILE_PATH est configuré mais le fichier est introuvable');
        }
        return {
            absolutePath: FORCED_RENTAL_FILE_PATH,
            filename: `${sanitizeDownloadName(film.title)}-FORCED.mp4`
        };
    }

    const vfPath = join(SYMLINKS_PATH, rental.symlink_uuid, 'film_vf.mp4');
    const voPath = join(SYMLINKS_PATH, rental.symlink_uuid, 'film_vo.mp4');

    let absolutePath: string | null = null;
    let languageSuffix = 'VO';

    try {
        await access(vfPath);
        absolutePath = vfPath;
        languageSuffix = 'VF';
    } catch {
        try {
            await access(voPath);
            absolutePath = voPath;
            languageSuffix = 'VO';
        } catch {
            absolutePath = null;
        }
    }

    if (!absolutePath) {
        throw new Error('Aucun fichier vidéo disponible pour cette location');
    }

    const baseName = sanitizeDownloadName(film.title);
    return {
        absolutePath,
        filename: `${baseName}-${languageSuffix}.mp4`
    };
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
