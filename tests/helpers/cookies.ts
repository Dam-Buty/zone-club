import { AsyncLocalStorage } from 'async_hooks'

export interface TestCookieEntry {
  value: string
  opts?: { httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; maxAge?: number; expires?: Date }
}

/**
 * In-memory cookie jar that mimics the subset of the Next.js cookieStore
 * surface the routes actually call: get(name), set(name, value, opts), delete.
 */
export class TestCookieJar {
  data = new Map<string, TestCookieEntry>()
  get(name: string): { name: string; value: string } | undefined {
    const e = this.data.get(name)
    return e ? { name, value: e.value } : undefined
  }
  set(...args: unknown[]): void {
    // Routes call cookieStore.set('session', token, { httpOnly, ... }).
    const [name, value, opts] = args as [string, string, TestCookieEntry['opts']]
    this.data.set(name, { value, opts })
  }
  delete(name: string): void {
    // delete() in real Next.js sets an empty cookie with no attributes —
    // mirror that here so tests pick up the regression if a route ever
    // reverts from set('',{maxAge:0,...}) back to delete().
    this.data.set(name, { value: '' })
  }
  /** Test-only: read the full entry, including options. */
  entry(name: string): TestCookieEntry | undefined {
    return this.data.get(name)
  }
}

export const cookieAls = new AsyncLocalStorage<TestCookieJar>()

/**
 * Run an async fn inside a request-scoped cookie jar so that `next/headers`'
 * `cookies()` resolves to it (via the mock in tests/setup.ts).
 *
 * Returns the call result + the final jar so tests can read Set-Cookie attrs.
 */
export async function withCookies<T>(
  initial: Record<string, string>,
  fn: () => Promise<T>,
): Promise<{ result: T; jar: TestCookieJar }> {
  const jar = new TestCookieJar()
  for (const [k, v] of Object.entries(initial)) jar.data.set(k, { value: v })
  const result = await cookieAls.run(jar, fn)
  return { result, jar }
}
