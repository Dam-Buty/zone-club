import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/register/route'
import { mkReq, readJson } from '../helpers/request'
import { withCookies } from '../helpers/cookies'
import { resetDb } from '../helpers/db'

describe('POST /api/auth/register', () => {
  beforeEach(() => resetDb())

  it('200 + signed session cookie with HttpOnly/SameSite=lax on valid payload', async () => {
    const req = mkReq('/api/auth/register', {
      method: 'POST',
      body: { username: 'alice123', password: 'Strong1Pass' },
    })
    const { result: res, jar } = await withCookies({}, () => POST(req))
    expect(res.status).toBe(200)

    const body = await readJson<{ user: { username: string } }>(res)
    expect(body.user.username).toBe('alice123')

    const session = jar.entry('session')
    expect(session).toBeDefined()
    expect(session!.value.length).toBeGreaterThan(20)
    expect(session!.opts?.httpOnly).toBe(true)
    expect(session!.opts?.sameSite).toBe('lax')
    expect(session!.opts?.path).toBe('/')
  })

  it('400 when username or password is missing', async () => {
    const r1 = (await withCookies({}, () => POST(mkReq('/api/auth/register', { method: 'POST', body: { username: 'bob' } })))).result
    expect(r1.status).toBe(400)

    const r2 = (await withCookies({}, () => POST(mkReq('/api/auth/register', { method: 'POST', body: { password: 'Strong1Pass' } })))).result
    expect(r2.status).toBe(400)
  })

  it('400 username < 3 chars', async () => {
    const { result } = await withCookies({}, () =>
      POST(mkReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'ab', password: 'Strong1Pass' },
      })),
    )
    expect(result.status).toBe(400)
  })

  it('400 password policy: too short / no upper / no digit', async () => {
    const cases = [
      { username: 'charlie', password: 'Aa1' },
      { username: 'dora', password: 'lowercase1' },
      { username: 'eric', password: 'NoDigitsHere' },
    ]
    for (const body of cases) {
      const { result } = await withCookies({}, () =>
        POST(mkReq('/api/auth/register', { method: 'POST', body })),
      )
      expect(result.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('409 when username is taken', async () => {
    await withCookies({}, () =>
      POST(mkReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'frank', password: 'Strong1Pass' },
        forwardedFor: '10.99.42.42',
      })),
    )
    const { result: dup } = await withCookies({}, () =>
      POST(mkReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'frank', password: 'Strong1Pass' },
        forwardedFor: '10.99.42.43',
      })),
    )
    expect(dup.status).toBe(409)
  })
})
