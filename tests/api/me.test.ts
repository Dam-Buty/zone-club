import { describe, it, expect, beforeEach } from 'vitest'
import { POST as register } from '@/app/api/auth/register/route'
import { GET as me } from '@/app/api/me/route'
import { mkReq, readJson } from '../helpers/request'
import { withCookies } from '../helpers/cookies'
import { resetDb } from '../helpers/db'

async function makeUser(username: string): Promise<string> {
  const { jar } = await withCookies({}, () =>
    register(mkReq('/api/auth/register', { method: 'POST', body: { username, password: 'Strong1Pass' } })),
  )
  return jar.entry('session')!.value
}

describe('GET /api/me', () => {
  beforeEach(() => resetDb())

  it('200 + user payload when session cookie is valid', async () => {
    const token = await makeUser('alice')
    const { result: res } = await withCookies({ session: token }, () => me())
    expect(res.status).toBe(200)
    const body = await readJson<{ user: { username: string }; activeRentals: unknown[] }>(res)
    expect(body.user.username).toBe('alice')
    expect(Array.isArray(body.activeRentals)).toBe(true)
  })

  it('401 without cookie', async () => {
    const { result } = await withCookies({}, () => me())
    expect(result.status).toBe(401)
  })

  it('401 with malformed cookie', async () => {
    const { result } = await withCookies({ session: 'not-a-real-token' }, () => me())
    expect(result.status).toBe(401)
  })

  it('Cache-Control: no-store (regression — was leaking 60s of stale auth payload)', async () => {
    const token = await makeUser('bob')
    const { result: res } = await withCookies({ session: token }, () => me())
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
