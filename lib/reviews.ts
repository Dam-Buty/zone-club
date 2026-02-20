import { db } from './db';

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
    // 1. Already reviewed this film?
    const existingReview = getUserReview(userId, filmId);
    if (existingReview) {
        return { allowed: false, reason: 'Vous avez déjà critiqué ce film' };
    }

    // 2. Has user rented this film?
    const rental = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND film_id = ?
        ORDER BY rented_at DESC
        LIMIT 1
    `).get(userId, filmId) as any;

    if (!rental) {
        // Not rented — allow 1 non-rented review per week
        const weekStart = getISOWeekStart();
        const weeklyNonRentedReview = db.prepare(`
            SELECT COUNT(*) as cnt FROM reviews
            WHERE user_id = ? AND created_at >= ?
            AND film_id NOT IN (SELECT film_id FROM rentals WHERE user_id = ?)
        `).get(userId, weekStart, userId) as { cnt: number };

        if (weeklyNonRentedReview.cnt >= 1) {
            return { allowed: false, reason: 'Limite d\'une critique par semaine pour les films non loués' };
        }

        return { allowed: true };
    }

    // 3. Rented — must have watched 80%+
    if ((rental.watch_progress ?? 0) < 80) {
        return { allowed: false, reason: 'Vous devez regarder au moins 80% du film' };
    }

    // 4. Time window check (1h)
    const now = new Date();
    if (rental.viewing_mode === 'sur_place' && rental.watch_completed_at) {
        const completedAt = new Date(rental.watch_completed_at + 'Z');
        const deadline = new Date(completedAt.getTime() + 60 * 60 * 1000);
        if (now > deadline) {
            return { allowed: false, reason: 'Délai d\'une heure après le visionnage dépassé' };
        }
    } else {
        const rentedAt = new Date(rental.rented_at + 'Z');
        const deadline = new Date(rentedAt.getTime() + 60 * 60 * 1000);
        if (now > deadline) {
            return { allowed: false, reason: 'Délai d\'une heure après la location dépassé' };
        }
    }

    return { allowed: true };
}

// Helper: get ISO week start (Monday 00:00 UTC)
function getISOWeekStart(): string {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
    return monday.toISOString().replace('T', ' ').replace('Z', '');
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
    if (content.length < MIN_REVIEW_LENGTH) {
        throw new Error(`La critique doit faire au moins ${MIN_REVIEW_LENGTH} caractères`);
    }

    for (const [key, value] of Object.entries(ratings)) {
        if (value < 1 || value > 5 || !Number.isInteger(value)) {
            throw new Error(`La note de ${key} doit être entre 1 et 5`);
        }
    }

    const canReview = canUserReview(userId, filmId);
    if (!canReview.allowed) {
        throw new Error(canReview.reason);
    }

    db.transaction(() => {
        db.prepare(`
            INSERT INTO reviews (user_id, film_id, content, rating_direction, rating_screenplay, rating_acting)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, filmId, content, ratings.direction, ratings.screenplay, ratings.acting);

        db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId);
    })();

    return getUserReview(userId, filmId)!;
}
