import { NextRequest } from 'next/server'

type ReqInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  cookies?: Record<string, string>
  headers?: Record<string, string>
  /** Used by lib/rate-limit.ts as the bucket key — vary across tests to avoid bleed-over. */
  forwardedFor?: string
}

const ORIGIN = 'http://localhost:3001'

/**
 * Build a NextRequest with same-origin Origin header (so the CSRF middleware
 * — when integrated by callers — wouldn't reject it) + a unique IP so the
 * in-memory rate-limit bucket stays empty for each test.
 */
export function mkReq(url: string, init: ReqInit = {}): NextRequest {
  const method = init.method ?? 'GET'
  const headers = new Headers({
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'X-Forwarded-For': init.forwardedFor ?? `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    ...(init.headers ?? {}),
  })

  if (init.cookies) {
    const cookieStr = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ')
    headers.set('cookie', cookieStr)
  }

  const fullUrl = url.startsWith('http') ? url : `${ORIGIN}${url}`
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined

  return new NextRequest(fullUrl, { method, headers, body })
}

/** Extract Set-Cookie payload (named cookie) from a Next.js Response. */
export function readSetCookie(res: Response, name: string): {
  value: string
  attrs: Record<string, string | true>
} | null {
  // NextResponse aggregates cookies via response.cookies — but for plain
  // Response/NextResponse.json() the values land in the headers as comma-joined
  // values. We split on the safe ", " boundary inserted by Headers.append.
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  // Cookies that start with `name=` win.
  const entries = raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
  const hit = entries.find((e) => e.trim().startsWith(`${name}=`))
  if (!hit) return null
  const [first, ...rest] = hit.split(';').map((s) => s.trim())
  const value = first.slice(name.length + 1)
  const attrs: Record<string, string | true> = {}
  for (const part of rest) {
    const [k, v] = part.split('=')
    attrs[k.toLowerCase()] = v ?? true
  }
  return { value, attrs }
}

/** Read JSON body without consuming the consumer's response twice. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}
