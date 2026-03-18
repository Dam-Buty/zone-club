import { sign, unsign } from 'cookie-signature';
import { getUserById, type User } from './auth';

function getSecret(): string {
    const secret = process.env.HMAC_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('HMAC_SECRET environment variable is required in production');
        }
        return 'dev-only-insecure-secret';
    }
    return secret;
}
const SECRET: string = getSecret();

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
 * Authenticate via x-api-key header.
 * For automated testing / CLI tooling only.
 * Always authenticates as the user defined by API_USER_ID env var (default: 1).
 * x-user-id header is NOT trusted — user ID is server-side only.
 */
export function getUserFromApiKey(req: Request): User | null {
    const key = req.headers.get('x-api-key');
    const apiSecret = process.env.API_SECRET;
    if (!key || !apiSecret || key !== apiSecret) return null;

    const userId = parseInt(process.env.API_USER_ID || '1', 10);
    return getUserById(userId);
}
