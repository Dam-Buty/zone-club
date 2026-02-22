import { sign, unsign } from 'cookie-signature';
import { getUserById, type User } from './auth';

const SECRET = process.env.HMAC_SECRET || 'dev-secret-change-in-production';

export interface Session {
    userId: number;
}

export function createSessionToken(userId: number): string {
    const payload = JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }); // 7 days
    return sign(Buffer.from(payload).toString('base64'), SECRET);
}

export function verifySessionToken(token: string): Session | null {
    const unsigned = unsign(token, SECRET);
    if (!unsigned) return null;

    try {
        const payload = JSON.parse(Buffer.from(unsigned, 'base64').toString());
        if (payload.exp < Date.now()) return null;
        return { userId: payload.userId };
    } catch {
        return null;
    }
}

export function getUserFromSession(token: string | undefined): User | null {
    if (!token) return null;

    const session = verifySessionToken(token);
    if (!session) return null;

    return getUserById(session.userId);
}

/**
 * Authenticate via x-api-key header + x-user-id header.
 * For automated testing / CLI tooling only.
 */
export function getUserFromApiKey(req: Request): User | null {
    const key = req.headers.get('x-api-key');
    const apiSecret = process.env.API_SECRET;
    if (!key || !apiSecret || key !== apiSecret) return null;

    const userId = parseInt(req.headers.get('x-user-id') || '1', 10);
    return getUserById(userId);
}
