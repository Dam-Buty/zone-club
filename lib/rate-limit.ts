/**
 * In-memory rate limiter for auth endpoints.
 * Tracks attempts per key (IP + endpoint) with sliding window.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (now > entry.resetAt) store.delete(key);
    }
}, 10 * 60 * 1000).unref?.();     // ne retient pas le processus (tests, arrêt du serveur)

/**
 * Check rate limit for a given key.
 * @returns null if allowed, or seconds until reset if blocked.
 */
export function checkRateLimit(
    key: string,
    maxAttempts: number = 5,
    windowMs: number = 15 * 60 * 1000, // 15 minutes
): number | null {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return null;
    }

    if (entry.count >= maxAttempts) {
        return Math.ceil((entry.resetAt - now) / 1000);
    }

    entry.count++;
    return null;
}

/**
 * La tentative que `checkRateLimit` vient de compter a réussi : elle ne compte plus. Les limites défendent contre les
 * essais RATÉS (mot de passe deviné, comptes créés en série) ; un visiteur qui se connecte six fois dans le quart
 * d'heure avec le bon mot de passe n'a pas à être bloqué (batterie de tests du 25/11/2026).
 */
export function forgiveAttempt(key: string): void {
    const entry = store.get(key);
    if (entry && entry.count > 0) entry.count--;
}

/** Le message d'un blocage : « Trop de tentatives. Réessayez dans 14 minutes. » */
export function tooManyAttempts(retryAfterSeconds: number, what: string = 'Trop de tentatives'): string {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return `${what}. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

/**
 * Get rate limit key from request IP + endpoint path.
 */
export function getRateLimitKey(request: Request, endpoint: string): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    return `${ip}:${endpoint}`;
}
