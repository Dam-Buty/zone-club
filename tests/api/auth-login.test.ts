import { describe, it, expect, beforeEach } from 'vitest'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as login } from '@/app/api/auth/login/route'
import { mkReq } from '../helpers/request'
import { withCookies } from '../helpers/cookies'
import { resetDb } from '../helpers/db'

async function makeUser(username: string, password = 'Strong1Pass') {
  await withCookies({}, () =>
    register(mkReq('/api/auth/register', { method: 'POST', body: { username, password } })),
  )
}

describe('POST /api/auth/login', () => {
  beforeEach(() => resetDb())

  it('200 + new session cookie on valid credentials', async () => {
    await makeUser('alice')
    const { result: res, jar } = await withCookies({}, () =>
      login(mkReq('/api/auth/login', {
        method: 'POST',
        body: { username: 'alice', password: 'Strong1Pass' },
      })),
    )
    expect(res.status).toBe(200)

    const session = jar.entry('session')
    expect(session).toBeDefined()
    expect(session!.opts?.httpOnly).toBe(true)
    expect(session!.opts?.sameSite).toBe('lax')
    expect(session!.value.length).toBeGreaterThan(20)
  })

  it('401 on wrong password', async () => {
    await makeUser('bob')
    const { result } = await withCookies({}, () =>
      login(mkReq('/api/auth/login', {
        method: 'POST',
        body: { username: 'bob', password: 'WrongPass1' },
        forwardedFor: '10.99.50.1',
      })),
    )
    expect(result.status).toBe(401)
  })

  it('429 after 10 failed attempts on the same username (per-username bucket)', async () => {
    await makeUser('charlie')
    let lastStatus = 0
    for (let i = 0; i < 12; i++) {
      const { result } = await withCookies({}, () =>
        login(mkReq('/api/auth/login', {
          method: 'POST',
          body: { username: 'charlie', password: `Bad${i}Pass!` },
          // Rotating IPs ensure per-IP bucket isn't the trigger; only the
          // per-username bucket (limit = 10) should fire 429.
          forwardedFor: `10.99.51.${i + 1}`,
        })),
      )
      lastStatus = result.status
    }
    expect(lastStatus).toBe(429)
  })
})
