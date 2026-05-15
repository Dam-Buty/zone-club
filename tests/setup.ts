// Runs before any test module is imported.
// Points DATABASE_PATH to a per-worker temp file so lib/db.ts (which opens the
// connection at import time) ends up on an isolated SQLite database.
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { vi } from 'vitest'

const dbFile = join(tmpdir(), `zone-test-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_PATH = dbFile
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-hmac-secret-vitest'
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-test-key-noop'

// next/headers.cookies() throws outside a request scope by default. Replace
// it with a jar bound to AsyncLocalStorage so tests can wrap calls in
// withCookies() and inspect Set-Cookie values via the jar.
vi.mock('next/headers', async () => {
  const { cookieAls } = await import('./helpers/cookies')
  return {
    cookies: async () => {
      const jar = cookieAls.getStore()
      if (!jar) {
        throw new Error(
          'next/headers cookies() was called outside withCookies(). Wrap the route call.',
        )
      }
      return jar
    },
    headers: async () => new Headers(),
  }
})

// Cleanup the file when the test process exits.
process.on('exit', () => {
  try { unlinkSync(dbFile) } catch { /* ignore */ }
})
