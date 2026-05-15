import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkReq } from '../helpers/request'
import { withCookies } from '../helpers/cookies'
import { resetDb } from '../helpers/db'

// The chat route streams from OpenRouter via the AI SDK; we don't want a real
// network call. Stub the SDK so `streamText` returns a tiny in-memory stream.
vi.mock('ai', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return {
    ...actual,
    streamText: () => ({
      toUIMessageStreamResponse: () => new Response('ok', { status: 200 }),
    }),
    convertToModelMessages: (m: unknown) => m,
  }
})
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => null,
}))
// `after()` requires a real Next.js request scope; no-op it in tests.
vi.mock('next/server', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return {
    ...actual,
    after: () => undefined,
  }
})

// Import AFTER mocks are registered.
const { POST: chat } = await import('@/app/api/chat/route')

function buildMessages(text = 'Hi') {
  return {
    messages: [{ id: 'm1', role: 'user', content: text, parts: [{ type: 'text', text }] }],
    events: [],
  }
}

describe('POST /api/chat', () => {
  beforeEach(() => resetDb())

  it('200 for a guest under the rate-limit', async () => {
    const { result } = await withCookies({}, () =>
      chat(mkReq('/api/chat', { method: 'POST', body: buildMessages(), forwardedFor: '10.99.60.10' })),
    )
    expect(result.status).toBe(200)
  })

  it('429 once a guest exceeds 8 calls in the window (P1 rate-limit)', async () => {
    const ip = '10.99.61.11'
    let last = 0
    for (let i = 0; i < 12; i++) {
      const { result } = await withCookies({}, () =>
        chat(mkReq('/api/chat', { method: 'POST', body: buildMessages(`Msg ${i}`), forwardedFor: ip })),
      )
      last = result.status
    }
    expect(last).toBe(429)
  })

  it('x-api-key bypasses the rate-limit (server-to-server convention)', async () => {
    // getUserFromApiKey looks up users.id = process.env.API_USER_ID (default 1)
    // — seed one so the bypass branch can resolve a real user.
    const { POST: register } = await import('@/app/api/auth/register/route')
    await withCookies({}, () =>
      register(mkReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'apibot', password: 'Strong1Pass' },
      })),
    )
    const { db } = await import('@/lib/db')
    const apiUserId = (db.prepare("SELECT id FROM users WHERE username='apibot'").get() as { id: number }).id
    process.env.API_SECRET = process.env.API_SECRET || 'test-api-secret'
    process.env.API_USER_ID = String(apiUserId)

    const ip = '10.99.62.12'
    // First exhaust the guest bucket on this IP.
    for (let i = 0; i < 10; i++) {
      await withCookies({}, () =>
        chat(mkReq('/api/chat', { method: 'POST', body: buildMessages(`pre ${i}`), forwardedFor: ip })),
      )
    }
    // Now an api-key request on the same IP should still go through.
    const { result } = await withCookies({}, () =>
      chat(mkReq('/api/chat', {
        method: 'POST',
        body: buildMessages('with-key'),
        headers: { 'x-api-key': process.env.API_SECRET!, 'x-user-id': String(apiUserId) },
        forwardedFor: ip,
      })),
    )
    expect(result.status).toBe(200)
  })
})
