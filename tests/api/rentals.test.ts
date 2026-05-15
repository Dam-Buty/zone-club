import { describe, it, expect, beforeEach } from 'vitest'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as rent } from '@/app/api/rentals/[filmId]/route'
import { mkReq, readJson } from '../helpers/request'
import { withCookies } from '../helpers/cookies'
import { resetDb, seedFilm } from '../helpers/db'
import { db } from '@/lib/db'

async function makeUserToken(username: string): Promise<string> {
  const { jar } = await withCookies({}, () =>
    register(mkReq('/api/auth/register', { method: 'POST', body: { username, password: 'Strong1Pass' } })),
  )
  return jar.entry('session')!.value
}

async function callRent(filmId: number, token?: string) {
  const req = mkReq(`/api/rentals/${filmId}`, { method: 'POST' })
  const cookies: Record<string, string> = token ? { session: token } : {}
  const { result } = await withCookies(cookies, () =>
    rent(req as unknown as Parameters<typeof rent>[0], {
      params: Promise.resolve({ filmId: String(filmId) }),
    }),
  )
  return result
}

describe('POST /api/rentals/[filmId]', () => {
  beforeEach(() => resetDb())

  it('200 — renting an available film returns the rental + film payload', async () => {
    const token = await makeUserToken('alice')
    const filmId = seedFilm({ title: 'Rent Me', stock: 1 })

    const res = await callRent(filmId, token)
    expect(res.status).toBe(200)

    const body = await readJson<{ rental: { film_id: number } }>(res)
    expect(body.rental.film_id).toBe(filmId)
  })

  it('401 without session cookie', async () => {
    const filmId = seedFilm()
    const res = await callRent(filmId)
    expect(res.status).toBe(401)
  })

  it('400 when filmId does not exist (B4 — was an opaque FK 500)', async () => {
    const token = await makeUserToken('charlie')
    const res = await callRent(99999999, token)
    expect(res.status).toBe(400)
    const body = await readJson<{ error: string }>(res)
    expect(body.error).toMatch(/non trouv|not found|inexistant/i)
  })

  it('idempotent — renting the same film twice returns the existing rental', async () => {
    const token = await makeUserToken('dora')
    const filmId = seedFilm({ stock: 1 })

    const first = await callRent(filmId, token)
    expect(first.status).toBe(200)
    const r1 = (await readJson<{ rental: { id: number } }>(first)).rental.id

    const second = await callRent(filmId, token)
    expect(second.status).toBe(200)
    const r2 = (await readJson<{ rental: { id: number } }>(second)).rental.id

    expect(r1).toBe(r2)
  })

  it('400 when stock is exhausted by another user', async () => {
    const ownerToken = await makeUserToken('eric')
    const otherToken = await makeUserToken('fiona')
    const filmId = seedFilm({ stock: 1 })

    const r1 = await callRent(filmId, ownerToken)
    expect(r1.status).toBe(200)

    const r2 = await callRent(filmId, otherToken)
    expect(r2.status).toBe(400)
    const body = await readJson<{ error: string }>(r2)
    expect(body.error).toMatch(/copies sont lou|stock|disponibilit/i)
  })

  it('B1 regression — renting a film without file_path no longer crashes (dev local)', async () => {
    // The film is created without file_path_vo/vf — used to ENOENT on mkdir /media.
    const token = await makeUserToken('greg')
    const filmId = seedFilm({ stock: 1 })

    const res = await callRent(filmId, token)
    expect(res.status).toBe(200)

    // symlink_uuid still set (stub UUID), streaming_urls null.
    const rental = db.prepare('SELECT symlink_uuid FROM rentals WHERE film_id = ?').get(filmId) as { symlink_uuid: string }
    expect(rental.symlink_uuid).toMatch(/^[0-9a-f-]{36}$/)
  })
})
