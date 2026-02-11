import type { Handle } from '@sveltejs/kit';
import { getUserFromSession } from '$lib/server/session';
import { cleanupExpiredRentals } from '$lib/server/rentals';

// ============ CRON CLEANUP ============
// Nettoyage automatique des locations expirées toutes les 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup() {
    try {
        const count = await cleanupExpiredRentals();
        if (count > 0) {
            console.log(`[CRON] Cleaned up ${count} expired rental(s)`);
        }
    } catch (error) {
        console.error('[CRON] Error during cleanup:', error);
    }
}

// Start cleanup interval on first request (server startup)
function ensureCleanupStarted() {
    if (!cleanupInterval) {
        console.log('[CRON] Starting rental cleanup scheduler (every 5 minutes)');
        // Run immediately on startup
        runCleanup();
        // Then run every 5 minutes
        cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
    }
}

// ============ CORS ============
// CORS origins autorisées
const FRONTEND_ORIGIN = `https://${process.env.FRONTEND_SUBDOMAIN || 'club'}.${process.env.DOMAIN || 'lazone.at'}`;

const ALLOWED_ORIGINS = [
    FRONTEND_ORIGIN,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:5177',
    'http://localhost:5178',
    'http://localhost:5179',
    'http://localhost:5180',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
];

export const handle: Handle = async ({ event, resolve }) => {
    // Start cleanup scheduler on first request
    ensureCleanupStarted();

    const sessionToken = event.cookies.get('session');
    event.locals.user = getUserFromSession(sessionToken);

    // Handle CORS preflight
    if (event.request.method === 'OPTIONS') {
        const origin = event.request.headers.get('origin');
        const headers: Record<string, string> = {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        };
        if (origin && ALLOWED_ORIGINS.includes(origin)) {
            headers['Access-Control-Allow-Origin'] = origin;
        }
        return new Response(null, { status: 204, headers });
    }

    const response = await resolve(event);

    // Add CORS headers to all responses
    const origin = event.request.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return response;
};
