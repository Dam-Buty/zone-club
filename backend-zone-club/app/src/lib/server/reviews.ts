import { db } from './db';
import { hasUserRentedFilm } from './rentals';

const MIN_REVIEW_LENGTH = 500;

export interface Review {
    id: number;
    user_id: number;
    film_id: number;
    content: string;
    rating_direction: number;
    rating_screenplay: number;
    rating_acting: number;
    created_at: string;
}

export interface ReviewWithUser extends Review {
    username: string;
    average_rating: number;
}

export interface FilmRatings {
    direction: number;
    screenplay: number;
    acting: number;
    overall: number;
    count: number;
}

export function getReviewsByFilm(filmId: number): ReviewWithUser[] {
    return db.prepare(`
        SELECT r.*, u.username,
            (r.rating_direction + r.rating_screenplay + r.rating_acting) / 3.0 as average_rating
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.film_id = ?
        ORDER BY r.created_at DESC
    `).all(filmId) as ReviewWithUser[];
}

export function getFilmRatings(filmId: number): FilmRatings | null {
    const result = db.prepare(`
        SELECT
            AVG(rating_direction) as direction,
            AVG(rating_screenplay) as screenplay,
            AVG(rating_acting) as acting,
            AVG((rating_direction + rating_screenplay + rating_acting) / 3.0) as overall,
            COUNT(*) as count
        FROM reviews
        WHERE film_id = ?
    `).get(filmId) as any;

    if (!result || result.count === 0) return null;

    return {
        direction: Math.round(result.direction * 10) / 10,
        screenplay: Math.round(result.screenplay * 10) / 10,
        acting: Math.round(result.acting * 10) / 10,
        overall: Math.round(result.overall * 10) / 10,
        count: result.count
    };
}

export function getUserReview(userId: number, filmId: number): Review | null {
    return db.prepare(`
        SELECT * FROM reviews WHERE user_id = ? AND film_id = ?
    `).get(userId, filmId) as Review | null;
}

export function getUserReviews(userId: number): ReviewWithUser[] {
    return db.prepare(`
        SELECT r.*, u.username,
            (r.rating_direction + r.rating_screenplay + r.rating_acting) / 3.0 as average_rating
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
    `).all(userId) as ReviewWithUser[];
}

export function canUserReview(userId: number, filmId: number): { allowed: boolean; reason?: string } {
    // Check if user has rented this film
    if (!hasUserRentedFilm(userId, filmId)) {
        return { allowed: false, reason: 'Vous devez d\'abord louer ce film pour pouvoir le critiquer' };
    }

    // Check if user already reviewed this film
    const existingReview = getUserReview(userId, filmId);
    if (existingReview) {
        return { allowed: false, reason: 'Vous avez déjà critiqué ce film' };
    }

    // Check if rental is less than 1 hour old
    const recentRental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ?
        AND datetime(rented_at, '+1 hour') > datetime('now')
        ORDER BY rented_at DESC
        LIMIT 1
    `).get(userId, filmId);

    if (!recentRental) {
        return { allowed: false, reason: 'Vous ne pouvez critiquer un film que dans l\'heure suivant sa location' };
    }

    return { allowed: true };
}

export function createReview(
    userId: number,
    filmId: number,
    content: string,
    ratings: {
        direction: number;
        screenplay: number;
        acting: number;
    }
): Review {
    // Validate content length
    if (content.length < MIN_REVIEW_LENGTH) {
        throw new Error(`La critique doit faire au moins ${MIN_REVIEW_LENGTH} caractères`);
    }

    // Validate ratings
    for (const [key, value] of Object.entries(ratings)) {
        if (value < 1 || value > 5 || !Number.isInteger(value)) {
            throw new Error(`La note de ${key} doit être entre 1 et 5`);
        }
    }

    // Check if user can review
    const canReview = canUserReview(userId, filmId);
    if (!canReview.allowed) {
        throw new Error(canReview.reason);
    }

    // Create review and add credit in transaction
    db.transaction(() => {
        db.prepare(`
            INSERT INTO reviews (user_id, film_id, content, rating_direction, rating_screenplay, rating_acting)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, filmId, content, ratings.direction, ratings.screenplay, ratings.acting);

        db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId);
    })();

    return getUserReview(userId, filmId)!;
}
