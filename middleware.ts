import { NextRequest, NextResponse } from 'next/server'

// CSRF defense via Origin/Referer header check on every non-GET API route.
//
// Browsers send the Origin header on cross-origin POST/PUT/PATCH/DELETE and
// also on same-origin POST in modern versions. Verifying that Origin matches
// the request's own host blocks cross-site form submissions even though our
// session cookies are `sameSite: 'lax'` (lax allows top-level GET cross-site
// navigation, but does not by itself defend against tag-triggered POST).
//
// Exemptions:
//   - GET / HEAD / OPTIONS are read-only, no CSRF risk.
//   - Requests carrying a valid x-api-key header (server-to-server / scripted
//     usage of /api/chat etc.). The key gate itself authenticates the caller.
//
// Replaces the (deleted) lib/csrf.ts double-submit token. Simpler, opt-out
// by header rather than per-route opt-in.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function middleware(req: NextRequest) {
  // Only police /api/* routes — Next.js internals (RSC, _next/*) handle
  // their own security model and our static pages are GET-only anyway.
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }
  if (SAFE_METHODS.has(req.method)) {
    return NextResponse.next()
  }

  // API-key authenticated callers are explicitly allowed cross-origin.
  if (req.headers.get('x-api-key')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const host = req.headers.get('host')

  // Build the expected same-origin (scheme + host) from the proxied request.
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const proto = forwardedProto?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '')
  const expectedOrigin = host ? `${proto}://${host}` : null

  // Accept matching Origin OR matching Referer prefix (some legacy callers
  // strip Origin but keep Referer).
  if (origin && expectedOrigin && origin === expectedOrigin) {
    return NextResponse.next()
  }
  if (!origin && referer && expectedOrigin && referer.startsWith(expectedOrigin)) {
    return NextResponse.next()
  }

  return new NextResponse(
    JSON.stringify({ error: 'Origine non autorisée' }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
}

export const config = {
  // Match every API route. The function above filters by method itself.
  matcher: ['/api/:path*'],
}
