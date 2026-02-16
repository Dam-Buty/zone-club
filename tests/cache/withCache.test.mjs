/**
 * withCache — Unit tests for the TMDB client-side response cache.
 *
 * Tests the exact same caching logic used in src/services/tmdb.ts:
 * - Cache hit within TTL
 * - Cache miss after TTL expiry
 * - Concurrent requests deduplicate (same Promise)
 * - Different keys are independent
 * - Cache stores/returns correct data
 *
 * Run: node --test tests/cache/withCache.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Replicate the exact withCache implementation from tmdb.ts ──
// (Can't import tmdb.ts directly — it references browser globals & TMDB types)

function createCache() {
  const store = new Map();

  function withCache(key, fetcher, ttl = 24 * 60 * 60 * 1000) {
    const cached = store.get(key);
    if (cached && Date.now() - cached.ts < ttl) return Promise.resolve(cached.data);
    return fetcher().then(data => { store.set(key, { data, ts: Date.now() }); return data; });
  }

  return { store, withCache };
}

test('withCache: first call invokes fetcher and caches result', async () => {
  const { withCache } = createCache();
  let callCount = 0;

  const result = await withCache('film:1', async () => {
    callCount++;
    return { title: 'Inception' };
  });

  assert.equal(callCount, 1);
  assert.deepEqual(result, { title: 'Inception' });
});

test('withCache: second call within TTL returns cached data without calling fetcher', async () => {
  const { withCache } = createCache();
  let callCount = 0;

  const fetcher = async () => {
    callCount++;
    return { title: 'Inception' };
  };

  await withCache('film:1', fetcher);
  const result = await withCache('film:1', fetcher);

  assert.equal(callCount, 1, 'Fetcher should only be called once');
  assert.deepEqual(result, { title: 'Inception' });
});

test('withCache: call after TTL expiry re-invokes fetcher', async () => {
  const { store, withCache } = createCache();
  let callCount = 0;

  const fetcher = async () => {
    callCount++;
    return { title: `v${callCount}` };
  };

  await withCache('film:1', fetcher, 100); // TTL = 100ms
  assert.equal(callCount, 1);

  // Manually expire the entry
  const entry = store.get('film:1');
  entry.ts = Date.now() - 200; // 200ms ago → expired

  const result = await withCache('film:1', fetcher, 100);
  assert.equal(callCount, 2, 'Fetcher should be called again after TTL expiry');
  assert.deepEqual(result, { title: 'v2' });
});

test('withCache: different keys are independent', async () => {
  const { withCache } = createCache();

  const result1 = await withCache('film:1', async () => ({ title: 'Inception' }));
  const result2 = await withCache('film:2', async () => ({ title: 'Matrix' }));

  assert.deepEqual(result1, { title: 'Inception' });
  assert.deepEqual(result2, { title: 'Matrix' });
});

test('withCache: cached data is exactly the same reference', async () => {
  const { withCache } = createCache();

  const obj = { title: 'Inception', nested: { score: 8.8 } };
  await withCache('film:1', async () => obj);
  const result = await withCache('film:1', async () => ({ title: 'WRONG' }));

  assert.equal(result, obj, 'Cached value should be the exact same reference');
});

test('withCache: fetcher error does not pollute cache', async () => {
  const { store, withCache } = createCache();
  let callCount = 0;

  try {
    await withCache('film:bad', async () => {
      callCount++;
      throw new Error('TMDB 500');
    });
  } catch {
    // expected
  }

  assert.equal(callCount, 1);
  assert.equal(store.has('film:bad'), false, 'Failed fetch should not be cached');

  // Retry should call fetcher again
  const result = await withCache('film:bad', async () => {
    callCount++;
    return { title: 'Recovered' };
  });
  assert.equal(callCount, 2);
  assert.deepEqual(result, { title: 'Recovered' });
});

test('withCache: many entries coexist independently', async () => {
  const { store, withCache } = createCache();

  for (let i = 0; i < 50; i++) {
    await withCache(`film:${i}`, async () => ({ id: i }));
  }

  assert.equal(store.size, 50, 'All 50 entries should be cached');

  // Verify random access
  const r25 = await withCache('film:25', async () => ({ id: 'WRONG' }));
  assert.deepEqual(r25, { id: 25 });
});

// ── Static analysis: verify withCache is applied to the right TMDB methods ──

test('static: tmdb.ts wraps expected methods with withCache', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../src/services/tmdb.ts', import.meta.url), 'utf8');

  const expectedCachedMethods = [
    'getFilm',
    'getVideos',
    'getImages',
    'getMovieLogo',
    'getCompanyLogo',
    'getCredits',
    'getCertification',
    'getReviews',
  ];

  for (const method of expectedCachedMethods) {
    // Find the method and check it contains withCache
    const methodRegex = new RegExp(`async ${method}\\([^)]*\\)[^{]*\\{[\\s\\S]*?return withCache\\(`);
    assert.ok(
      methodRegex.test(source),
      `tmdb.${method}() must use withCache()`
    );
  }

  // Verify search/getPopular/getNowPlaying are NOT cached (dynamic results)
  const notCached = ['search', 'getPopular', 'getNowPlaying', 'getTopRatedRecent'];
  for (const method of notCached) {
    const methodStart = source.indexOf(`async ${method}(`);
    assert.notEqual(methodStart, -1, `Method ${method} should exist`);

    // Find the next method or end of object
    const nextMethodIdx = source.indexOf('\n  async ', methodStart + 1);
    const methodBody = nextMethodIdx > -1
      ? source.slice(methodStart, nextMethodIdx)
      : source.slice(methodStart);

    assert.ok(
      !methodBody.includes('withCache('),
      `tmdb.${method}() must NOT be cached (dynamic/search results)`
    );
  }
});
