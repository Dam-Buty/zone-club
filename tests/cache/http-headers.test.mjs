/**
 * Cache HTTP Headers — Static + Integration tests
 *
 * Static: Verify every API route file that should emit Cache-Control actually does.
 * Integration: Hit the running dev server and assert response headers.
 *
 * Run: node --test tests/cache/http-headers.test.mjs
 * Integration needs: npm run dev (port 3000)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from '../helpers/repo.mjs';
import path from 'node:path';

const ROOT = process.cwd();

// ── Static analysis: verify Cache-Control is set in source code ──

const ROUTES_WITH_PUBLIC_CACHE = [
  'app/api/films/aisle/[aisle]/route.ts',
  'app/api/films/genre/[slug]/route.ts',
  'app/api/films/route.ts',
];

const ROUTE_WITH_PRIVATE_CACHE = 'app/api/me/route.ts';

test('static: public API routes set Cache-Control with s-maxage', () => {
  for (const route of ROUTES_WITH_PUBLIC_CACHE) {
    const source = readText(path.join(ROOT, route));
    assert.ok(
      source.includes('s-maxage='),
      `${route} must set s-maxage in Cache-Control header`
    );
    assert.ok(
      source.includes('stale-while-revalidate='),
      `${route} must set stale-while-revalidate`
    );
  }
});

test('static: /api/me sets private Cache-Control', () => {
  const source = readText(path.join(ROOT, ROUTE_WITH_PRIVATE_CACHE));
  assert.ok(
    source.includes("'Cache-Control'") || source.includes('"Cache-Control"'),
    '/api/me/route.ts must set Cache-Control header'
  );
  assert.ok(
    source.includes('private'),
    '/api/me must use private cache directive'
  );
});

test('static: /api/films route uses conditional cache (public vs no-cache)', () => {
  const source = readText(path.join(ROOT, 'app/api/films/route.ts'));
  assert.ok(
    source.includes('no-cache'),
    '/api/films must use no-cache for admin requests (?all=true)'
  );
  assert.ok(
    source.includes('public'),
    '/api/films must use public cache for user-facing requests'
  );
});

// ── Integration: hit running dev server and check headers ──

const BASE = 'http://localhost:3000';

async function canReachServer() {
  try {
    const r = await fetch(`${BASE}/api/films`, { signal: AbortSignal.timeout(2000) });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

test('integration: /api/films/aisle/action returns public cache header', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const res = await fetch(`${BASE}/api/films/aisle/action`);
  assert.equal(res.status, 200);
  const cc = res.headers.get('cache-control');
  assert.ok(cc, 'Cache-Control header must be present');
  assert.ok(cc.includes('public'), `Expected public, got: ${cc}`);
  assert.ok(cc.includes('s-maxage=300'), `Expected s-maxage=300, got: ${cc}`);
  assert.ok(cc.includes('stale-while-revalidate=3600'), `Expected swr=3600, got: ${cc}`);
});

test('integration: /api/films/aisle/nouveautes returns public cache header', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const res = await fetch(`${BASE}/api/films/aisle/nouveautes`);
  assert.equal(res.status, 200);
  const cc = res.headers.get('cache-control');
  assert.ok(cc, 'Cache-Control header must be present');
  assert.ok(cc.includes('s-maxage=300'), `Expected s-maxage=300, got: ${cc}`);
});

test('integration: /api/films (user-facing) returns public cache header', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const res = await fetch(`${BASE}/api/films`);
  assert.equal(res.status, 200);
  const cc = res.headers.get('cache-control');
  assert.ok(cc, 'Cache-Control header must be present');
  assert.ok(cc.includes('public'), `Expected public, got: ${cc}`);
  assert.ok(cc.includes('s-maxage=300'), `Expected s-maxage=300, got: ${cc}`);
});

test('integration: /api/me without auth returns 401', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const res = await fetch(`${BASE}/api/me`);
  assert.equal(res.status, 401);
});

test('integration: /api/films response is valid JSON with films array', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const res = await fetch(`${BASE}/api/films/aisle/action`);
  const data = await res.json();
  assert.ok(data.films, 'Response must contain films key');
  assert.ok(Array.isArray(data.films), 'films must be an array');
  assert.ok(data.films.length > 0, 'films array must not be empty (DB seeded)');
});

test('integration: repeated requests return same data (cache consistency)', { skip: !(await canReachServer()) && 'Dev server not running' }, async () => {
  const [res1, res2] = await Promise.all([
    fetch(`${BASE}/api/films/aisle/action`).then(r => r.json()),
    fetch(`${BASE}/api/films/aisle/action`).then(r => r.json()),
  ]);
  assert.deepEqual(res1, res2, 'Two concurrent requests must return identical data');
});
