/**
 * Audit Security Fixes — Regression Tests
 *
 * Guards against reintroducing vulnerabilities fixed in audit-2026-03-17:
 *   S-01: HMAC secret hardcoded fallback in production
 *   S-02: x-user-id header trust (user impersonation via API key)
 *   S-08: Radarr API calls without timeout (hanging requests)
 *   S-09: Review content without max length validation (DoS vector)
 *
 * Run: node --test tests/domain/audit-security.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

// ===== S-01: HMAC Secret =====

test('S-01: session.ts must NOT have a simple hardcoded HMAC fallback', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  // The old pattern: const SECRET = process.env.HMAC_SECRET || 'dev-secret-change-in-production'
  assert.ok(
    !source.includes("|| 'dev-secret"),
    'Must not have inline || fallback for HMAC_SECRET — use getSecret() with production guard'
  );
  assert.ok(
    !source.includes("|| \"dev-secret"),
    'Must not have inline || fallback for HMAC_SECRET (double quotes)'
  );
});

test('S-01: session.ts must throw in production when HMAC_SECRET is missing', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  assert.ok(
    source.includes("process.env.NODE_ENV === 'production'"),
    'Must check NODE_ENV === production before throwing'
  );
  assert.ok(
    source.includes("throw new Error('HMAC_SECRET environment variable is required in production')") ||
    source.includes('throw new Error("HMAC_SECRET environment variable is required in production")'),
    'Must throw explicit error about HMAC_SECRET in production'
  );
});

test('S-01: session.ts must use getSecret() function, not inline fallback', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  assert.ok(
    source.includes('function getSecret()'),
    'Must define getSecret() function'
  );
  assert.ok(
    source.includes('const SECRET: string = getSecret()') ||
    source.includes('const SECRET = getSecret()'),
    'SECRET must be initialized via getSecret() call'
  );
});

test('S-01: SECRET must be typed as string (never string | undefined)', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  // getSecret() returns string, so SECRET is typed string
  const getSecretFn = source.slice(
    source.indexOf('function getSecret()'),
    source.indexOf('const SECRET')
  );
  assert.ok(
    getSecretFn.includes(': string'),
    'getSecret() must have explicit string return type'
  );
});

// ===== S-02: API Key User Impersonation =====

test('S-02: getUserFromApiKey must NOT read x-user-id from request headers', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  const fnBlock = source.slice(source.indexOf('getUserFromApiKey'));
  assert.ok(
    !fnBlock.includes("get('x-user-id')"),
    'Must NOT trust x-user-id from client — user ID must be server-side only'
  );
});

test('S-02: getUserFromApiKey must use API_USER_ID env var', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  const fnBlock = source.slice(source.indexOf('getUserFromApiKey'));
  assert.ok(
    fnBlock.includes("process.env.API_USER_ID"),
    'Must read user ID from API_USER_ID env var, not from client headers'
  );
});

test('S-02: getUserFromApiKey must default to user 1 when API_USER_ID unset', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  const fnBlock = source.slice(source.indexOf('getUserFromApiKey'));
  assert.ok(
    fnBlock.includes("|| '1'"),
    'Must default to user ID 1 when API_USER_ID is not set'
  );
});

test('S-02: getUserFromApiKey must validate API_SECRET exists before comparing', () => {
  const source = readText(path.join(ROOT, 'lib/session.ts'));
  const fnBlock = source.slice(source.indexOf('getUserFromApiKey'));
  // Must check !apiSecret (prevents matching when API_SECRET is unset)
  assert.ok(
    fnBlock.includes('!apiSecret'),
    'Must check that API_SECRET env var exists before comparing keys'
  );
});

// ===== S-08: Radarr Timeout =====

test('S-08: radarr.ts must include AbortSignal.timeout on fetch calls', () => {
  const source = readText(path.join(ROOT, 'lib/radarr.ts'));
  assert.ok(
    source.includes('AbortSignal.timeout('),
    'All Radarr fetch calls must have AbortSignal.timeout to prevent hanging'
  );
});

test('S-08: radarr.ts timeout must be 15 seconds', () => {
  const source = readText(path.join(ROOT, 'lib/radarr.ts'));
  assert.ok(
    source.includes('AbortSignal.timeout(15000)'),
    'Radarr timeout must be 15000ms (15 seconds)'
  );
});

test('S-08: radarr.ts must not override caller-provided signal', () => {
  const source = readText(path.join(ROOT, 'lib/radarr.ts'));
  // Pattern: options.signal ?? AbortSignal.timeout — respects caller signal
  assert.ok(
    source.includes('options.signal ??') || source.includes('options.signal??'),
    'Must use nullish coalescing (??) to respect caller-provided AbortSignal'
  );
});

// ===== S-09: Review Content Validation =====

test('S-09: reviews POST must validate content type and length', () => {
  const source = readText(path.join(ROOT, 'app/api/reviews/[filmId]/route.ts'));
  const postBlock = source.slice(
    source.indexOf('export async function POST'),
    source.indexOf('export async function PUT')
  );
  assert.ok(
    postBlock.includes("typeof content !== 'string'"),
    'POST must check content is a string'
  );
  assert.ok(
    postBlock.includes('content.length > 10000'),
    'POST must reject content over 10000 characters'
  );
  assert.ok(
    postBlock.includes('status: 400'),
    'POST must return 400 for invalid content'
  );
});

test('S-09: reviews PUT must validate content type and length', () => {
  const source = readText(path.join(ROOT, 'app/api/reviews/[filmId]/route.ts'));
  const putBlock = source.slice(source.indexOf('export async function PUT'));
  assert.ok(
    putBlock.includes("typeof content !== 'string'"),
    'PUT must check content is a string'
  );
  assert.ok(
    putBlock.includes('content.length > 10000'),
    'PUT must reject content over 10000 characters'
  );
  assert.ok(
    putBlock.includes('status: 400'),
    'PUT must return 400 for invalid content'
  );
});

test('S-09: content validation must happen BEFORE createReview/updateReview call', () => {
  const source = readText(path.join(ROOT, 'app/api/reviews/[filmId]/route.ts'));

  // POST: validation before createReview
  const postBlock = source.slice(
    source.indexOf('export async function POST'),
    source.indexOf('export async function PUT')
  );
  const postValidationPos = postBlock.indexOf('content.length > 10000');
  const postCreatePos = postBlock.indexOf('createReview(');
  assert.ok(postValidationPos < postCreatePos,
    'POST: content validation must come before createReview() call'
  );

  // PUT: validation before updateReview
  const putBlock = source.slice(source.indexOf('export async function PUT'));
  const putValidationPos = putBlock.indexOf('content.length > 10000');
  const putUpdatePos = putBlock.indexOf('updateReview(');
  assert.ok(putValidationPos < putUpdatePos,
    'PUT: content validation must come before updateReview() call'
  );
});
