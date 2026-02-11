import { db } from './db';

export interface FilmRequest {
    id: number;
    user_id: number;
    tmdb_id: number;
    title: string;
    poster_url: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'added';
    admin_note: string | null;
    created_at: string;
}

export interface FilmRequestWithUser extends FilmRequest {
    username: string;
}

export function createFilmRequest(
    userId: number,
    tmdbId: number,
    title: string,
    posterUrl: string | null
): FilmRequest {
    const existingFilm = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(tmdbId);
    if (existingFilm) {
        throw new Error('Ce film est déjà dans le catalogue');
    }

    const existingRequest = db.prepare('SELECT * FROM film_requests WHERE tmdb_id = ?').get(tmdbId);
    if (existingRequest) {
        throw new Error('Ce film a déjà été demandé');
    }

    db.prepare(`
        INSERT INTO film_requests (user_id, tmdb_id, title, poster_url)
        VALUES (?, ?, ?, ?)
    `).run(userId, tmdbId, title, posterUrl);

    return db.prepare('SELECT * FROM film_requests WHERE tmdb_id = ?').get(tmdbId) as FilmRequest;
}

export function getFilmRequests(status?: string): FilmRequestWithUser[] {
    let query = `
        SELECT r.*, u.username
        FROM film_requests r
        JOIN users u ON r.user_id = u.id
    `;

    if (status) {
        query += ` WHERE r.status = ?`;
        query += ` ORDER BY r.created_at DESC`;
        return db.prepare(query).all(status) as FilmRequestWithUser[];
    }

    query += ` ORDER BY r.created_at DESC`;
    return db.prepare(query).all() as FilmRequestWithUser[];
}

export function getUserRequests(userId: number): FilmRequest[] {
    return db.prepare(`
        SELECT * FROM film_requests
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId) as FilmRequest[];
}

export function updateRequestStatus(
    requestId: number,
    status: 'approved' | 'rejected' | 'added',
    adminNote?: string
): void {
    db.prepare(`
        UPDATE film_requests
        SET status = ?, admin_note = ?
        WHERE id = ?
    `).run(status, adminNote || null, requestId);
}

export function isFilmRequested(tmdbId: number): boolean {
    const request = db.prepare('SELECT 1 FROM film_requests WHERE tmdb_id = ?').get(tmdbId);
    return !!request;
}

export function getRequestByTmdbId(tmdbId: number): FilmRequest | null {
    return db.prepare('SELECT * FROM film_requests WHERE tmdb_id = ?').get(tmdbId) as FilmRequest | null;
}
