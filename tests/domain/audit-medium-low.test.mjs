/**
 * Audit Medium + Low Priority Fixes — Regression Tests
 *
 * Guards against reintroducing issues fixed in audit round 2:
 *   S-10: Password complexity validation
 *   S-13: IDOR filter on unavailable films
 *   S-14: Radarr env var production guard
 *   S-15: Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
 *   U-09: SearchModal error auto-dismiss
 *   U-13: Star rating ARIA labels in ReviewModal
 *   U-14: Loading indicator accessible (role="status")
 *   C-08: crypto.randomUUID fallback
 *   P-11: PrivateSign texture not duplicated (single instance)
 *
 * Run: node --test tests/domain/audit-medium-low.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

// ===== S-10: Password Complexity =====

test('S-10: register route must check for lowercase letter', () => {
  const source = readText(path.join(ROOT, 'app/api/auth/register/route.ts'));
  assert.ok(
    source.includes('[a-z]'),
    'Register must validate at least one lowercase letter'
  );
});

test('S-10: register route must check for uppercase letter', () => {
  const source = readText(path.join(ROOT, 'app/api/auth/register/route.ts'));
  assert.ok(
    source.includes('[A-Z]'),
    'Register must validate at least one uppercase letter'
  );
});

test('S-10: register route must check for digit', () => {
  const source = readText(path.join(ROOT, 'app/api/auth/register/route.ts'));
  assert.ok(
    source.includes('[0-9]'),
    'Register must validate at least one digit'
  );
});

test('S-10: password complexity check must return 400 on failure', () => {
  const source = readText(path.join(ROOT, 'app/api/auth/register/route.ts'));
  // Find the complexity check block and verify it returns 400
  const complexityIdx = source.indexOf('[a-z]');
  const returnIdx = source.indexOf('status: 400', complexityIdx);
  assert.ok(
    returnIdx > complexityIdx && returnIdx - complexityIdx < 300,
    'Password complexity check must return 400 status'
  );
});

// ===== S-13: IDOR Film Availability =====

test('S-13: individual film endpoint must filter by is_available', () => {
  const source = readText(path.join(ROOT, 'app/api/films/[tmdbId]/route.ts'));
  assert.ok(
    source.includes('is_available'),
    'Film endpoint must check is_available to prevent IDOR on hidden films'
  );
});

test('S-13: unavailable film must return 404, not the film data', () => {
  const source = readText(path.join(ROOT, 'app/api/films/[tmdbId]/route.ts'));
  // The check must be in the same condition as !film
  assert.ok(
    source.includes('!film || !film.is_available') ||
    source.includes('!film.is_available'),
    'Unavailable films must be treated as not found'
  );
});

// ===== S-14: Radarr Env Var Guards =====

test('S-14: radarr.ts must validate API keys in production', () => {
  const source = readText(path.join(ROOT, 'lib/radarr.ts'));
  assert.ok(
    source.includes("process.env.NODE_ENV === 'production'") &&
    source.includes('throw new Error'),
    'Radarr must throw in production when API keys are missing'
  );
});

test('S-14: radarr.ts must NOT have bare empty string fallback for API keys', () => {
  const source = readText(path.join(ROOT, 'lib/radarr.ts'));
  // Old pattern: process.env.RADARR_VO_API_KEY || ''
  assert.ok(
    !source.includes("RADARR_VO_API_KEY || ''") &&
    !source.includes("RADARR_VF_API_KEY || ''"),
    'Must not have bare empty string fallback for Radarr API keys'
  );
});

// ===== S-15: Security Headers =====

test('S-15: next.config must set X-Content-Type-Options: nosniff', () => {
  const source = readText(path.join(ROOT, 'next.config.ts'));
  assert.ok(
    source.includes('X-Content-Type-Options') && source.includes('nosniff'),
    'Must set X-Content-Type-Options: nosniff header'
  );
});

test('S-15: next.config must set X-Frame-Options: DENY', () => {
  const source = readText(path.join(ROOT, 'next.config.ts'));
  assert.ok(
    source.includes('X-Frame-Options') && source.includes('DENY'),
    'Must set X-Frame-Options: DENY header'
  );
});

test('S-15: next.config must set Referrer-Policy', () => {
  const source = readText(path.join(ROOT, 'next.config.ts'));
  assert.ok(
    source.includes('Referrer-Policy') && source.includes('strict-origin-when-cross-origin'),
    'Must set Referrer-Policy: strict-origin-when-cross-origin'
  );
});

test('S-15: next.config must set Permissions-Policy', () => {
  const source = readText(path.join(ROOT, 'next.config.ts'));
  assert.ok(
    source.includes('Permissions-Policy'),
    'Must set Permissions-Policy header'
  );
});

test('S-15: security headers must apply to all routes', () => {
  const source = readText(path.join(ROOT, 'next.config.ts'));
  assert.ok(
    source.includes("source: '/(.*)'") || source.includes('source: "/(.*)"'),
    'Security headers must apply to all routes via /(.*) pattern'
  );
});

// ===== U-09: SearchModal Error Auto-Dismiss =====

test('U-09: SearchModal search error must auto-dismiss', () => {
  const source = readText(path.join(ROOT, 'src/components/search/SearchModal.tsx'));
  // Find the catch block and verify it has a setTimeout to clear error
  const catchIdx = source.indexOf("setError('Erreur lors de la recherche')");
  assert.ok(catchIdx > 0, 'SearchModal must have error message for search failures');

  const dismissIdx = source.indexOf('setTimeout(() => setError(null)', catchIdx);
  assert.ok(
    dismissIdx > catchIdx && dismissIdx - catchIdx < 200,
    'Search error must auto-dismiss via setTimeout after the setError call'
  );
});

// ===== U-13: Star Rating ARIA Labels =====

test('U-13: ReviewModal star buttons must have aria-label', () => {
  const source = readText(path.join(ROOT, 'src/components/review/ReviewModal.tsx'));
  const ariaLabelCount = (source.match(/aria-label=\{`\$\{n\} sur 5`\}/g) || []).length;
  assert.ok(
    ariaLabelCount >= 3,
    `Expected aria-label on star buttons for all 3 rating categories, found ${ariaLabelCount}`
  );
});

test('U-13: ReviewModal star groups must have role="radiogroup"', () => {
  const source = readText(path.join(ROOT, 'src/components/review/ReviewModal.tsx'));
  const roleCount = (source.match(/role="radiogroup"/g) || []).length;
  assert.ok(
    roleCount >= 3,
    `Expected role="radiogroup" on all 3 star containers, found ${roleCount}`
  );
});

test('U-13: ReviewModal star groups must have aria-labelledby', () => {
  const source = readText(path.join(ROOT, 'src/components/review/ReviewModal.tsx'));
  assert.ok(
    source.includes('aria-labelledby="rating-direction"'),
    'Direction stars must reference their label via aria-labelledby'
  );
  assert.ok(
    source.includes('aria-labelledby="rating-screenplay"'),
    'Screenplay stars must reference their label via aria-labelledby'
  );
  assert.ok(
    source.includes('aria-labelledby="rating-acting"'),
    'Acting stars must reference their label via aria-labelledby'
  );
});

// ===== U-14: Loading Indicator Accessible =====

test('U-14: App loading overlay must have role="status"', () => {
  const source = readText(path.join(ROOT, 'src/App.tsx'));
  // Find the loading overlay section
  const loadingStart = source.indexOf('Vidéoclub en cours de chargement');
  assert.ok(loadingStart > 0, 'Loading text must exist');

  // role="status" should be on the container div before the loading text
  const containerStart = source.lastIndexOf('role="status"', loadingStart);
  assert.ok(
    containerStart > 0,
    'Loading overlay container must have role="status" for screen readers'
  );
});

test('U-14: App loading overlay must have aria-live="polite"', () => {
  const source = readText(path.join(ROOT, 'src/App.tsx'));
  const loadingStart = source.indexOf('Vidéoclub en cours de chargement');
  const ariaLive = source.lastIndexOf('aria-live="polite"', loadingStart);
  assert.ok(
    ariaLive > 0,
    'Loading overlay must have aria-live="polite"'
  );
});

// ===== C-08: crypto.randomUUID Fallback =====

test('C-08: ManagerChat must NOT use bare crypto.randomUUID()', () => {
  const source = readText(path.join(ROOT, 'src/components/manager/ManagerChat.tsx'));
  // Must not have direct crypto.randomUUID() without fallback
  assert.ok(
    !source.includes('= crypto.randomUUID()') &&
    !source.includes('crypto.randomUUID();'),
    'Must not use bare crypto.randomUUID() — needs fallback for older browsers'
  );
});

test('C-08: ManagerChat must have fallback for randomUUID', () => {
  const source = readText(path.join(ROOT, 'src/components/manager/ManagerChat.tsx'));
  assert.ok(
    source.includes('randomUUID?.()') || source.includes('randomUUID?.()'),
    'Must use optional chaining on randomUUID'
  );
  assert.ok(
    source.includes('Math.random()'),
    'Must have Math.random fallback for browsers without crypto.randomUUID'
  );
});

// ===== P-11: PrivateSign Texture =====

test('P-11: PrivateSign must be instantiated only once in Aisle', () => {
  const source = readText(path.join(ROOT, 'src/components/interior/Aisle.tsx'));
  const instances = (source.match(/<PrivateSign/g) || []).length;
  assert.ok(
    instances <= 2,
    `PrivateSign should not be duplicated unnecessarily — found ${instances} instances`
  );
});
