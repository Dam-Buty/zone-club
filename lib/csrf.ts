/**
 * CSRF protection via custom header check.
 * All frontend API calls include X-Requested-With: XMLHttpRequest.
 * Combined with SameSite=Strict cookies, this prevents CSRF attacks.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify that the request includes the X-Requested-With header.
 * Returns a 403 response if missing (unless API key auth is used).
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
    // API key auth bypasses CSRF (server-to-server / testing)
    if (request.headers.get('x-api-key')) return null;

    // GET/HEAD/OPTIONS don't need CSRF protection
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

    const xRequestedWith = request.headers.get('x-requested-with');
    if (xRequestedWith !== 'XMLHttpRequest') {
        return NextResponse.json(
            { error: 'Requete non autorisee' },
            { status: 403 },
        );
    }

    return null;
}
