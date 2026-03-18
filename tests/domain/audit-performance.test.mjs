/**
 * Audit Performance Fixes — Regression Tests
 *
 * Guards against reintroducing performance regressions fixed in audit-2026-03-17:
 *   P-01: N+1 query in getUserActiveRentals (per-rental getFilmById)
 *   P-02: 10+ sequential getFilmsByAisle calls in chat.ts
 *   P-04: Missing composite indexes on rentals table
 *
 * Run: node --test tests/domain/audit-performance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

// ===== P-01: N+1 Rental Query =====

test('P-01: getUserActiveRentals must use JOIN query (not N+1)', () => {
  const source = readText(path.join(ROOT, 'lib/rentals.ts'));
  const fnStart = source.indexOf('export function getUserActiveRentals');
  assert.notEqual(fnStart, -1, 'getUserActiveRentals must exist');

  // Find the next export to bound the function
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  assert.ok(
    fnBlock.includes('JOIN films'),
    'getUserActiveRentals must JOIN films table (not call getFilmById per rental)'
  );
});

test('P-01: getUserActiveRentals must NOT call enrichRental', () => {
  const source = readText(path.join(ROOT, 'lib/rentals.ts'));
  const fnStart = source.indexOf('export function getUserActiveRentals');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  assert.ok(
    !fnBlock.includes('enrichRental('),
    'getUserActiveRentals must NOT use enrichRental (it causes N+1 via getFilmById)'
  );
});

test('P-01: getUserActiveRentals must NOT call getFilmById in a loop', () => {
  const source = readText(path.join(ROOT, 'lib/rentals.ts'));
  const fnStart = source.indexOf('export function getUserActiveRentals');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  assert.ok(
    !fnBlock.includes('getFilmById('),
    'getUserActiveRentals must NOT call getFilmById (N+1 pattern)'
  );
});

test('P-01: getUserActiveRentals must use parseFilm for type-safe Film construction', () => {
  const source = readText(path.join(ROOT, 'lib/rentals.ts'));
  assert.ok(
    source.includes("import") && source.includes('parseFilm'),
    'Must import parseFilm from films module'
  );
  const fnStart = source.indexOf('export function getUserActiveRentals');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  assert.ok(
    fnBlock.includes('parseFilm('),
    'getUserActiveRentals must call parseFilm to construct Film objects from JOIN result'
  );
});

test('P-01: JOIN query must select all necessary film columns with f_ prefix', () => {
  const source = readText(path.join(ROOT, 'lib/rentals.ts'));
  const fnStart = source.indexOf('export function getUserActiveRentals');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  const criticalColumns = [
    'f.tmdb_id', 'f.title', 'f.poster_url', 'f.aisle',
    'f.file_path_vf', 'f.file_path_vo', 'f.subtitle_path',
    'f.is_available', 'f.is_nouveaute',
  ];

  for (const col of criticalColumns) {
    assert.ok(
      fnBlock.includes(col),
      `JOIN query must select ${col} for complete Film object`
    );
  }
});

// ===== P-02: Chat N+1 Aisle Queries =====

test('P-02: chat.ts must NOT import getFilmsByAisle', () => {
  const source = readText(path.join(ROOT, 'lib/chat.ts'));
  // Must not import the per-aisle function
  assert.ok(
    !source.includes('getFilmsByAisle'),
    'chat.ts must NOT import getFilmsByAisle (causes 10+ sequential queries)'
  );
});

test('P-02: chat.ts must NOT import getNouveautes', () => {
  const source = readText(path.join(ROOT, 'lib/chat.ts'));
  assert.ok(
    !source.includes('getNouveautes'),
    'chat.ts must NOT import getNouveautes (replaced by grouped query)'
  );
});

test('P-02: chat.ts must use getAllAvailableFilmsGroupedByAisle', () => {
  const source = readText(path.join(ROOT, 'lib/chat.ts'));
  assert.ok(
    source.includes('getAllAvailableFilmsGroupedByAisle'),
    'chat.ts must use getAllAvailableFilmsGroupedByAisle (single query for all aisles)'
  );
});

test('P-02: films.ts must export getAllAvailableFilmsGroupedByAisle', () => {
  const source = readText(path.join(ROOT, 'lib/films.ts'));
  assert.ok(
    source.includes('export function getAllAvailableFilmsGroupedByAisle'),
    'films.ts must export getAllAvailableFilmsGroupedByAisle'
  );
});

test('P-02: getAllAvailableFilmsGroupedByAisle must use single query', () => {
  const source = readText(path.join(ROOT, 'lib/films.ts'));
  const fnStart = source.indexOf('export function getAllAvailableFilmsGroupedByAisle');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  // Must have exactly one db.prepare call
  const prepareCount = (fnBlock.match(/db\.prepare\(/g) || []).length;
  assert.equal(prepareCount, 1, 'getAllAvailableFilmsGroupedByAisle must have exactly 1 db.prepare call');

  // Must return a Map
  assert.ok(
    fnBlock.includes('Map<string, Film[]>'),
    'Must return Map<string, Film[]>'
  );
});

test('P-02: grouped query must handle nouveautes as virtual aisle', () => {
  const source = readText(path.join(ROOT, 'lib/films.ts'));
  const fnStart = source.indexOf('export function getAllAvailableFilmsGroupedByAisle');
  const fnEnd = source.indexOf('\nexport ', fnStart + 1);
  const fnBlock = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

  assert.ok(
    fnBlock.includes('is_nouveaute'),
    'Must check is_nouveaute flag for virtual nouveautes group'
  );
  assert.ok(
    fnBlock.includes("'nouveautes'"),
    'Must group nouveautes under the key "nouveautes"'
  );
});

test('P-02: chat.ts buildSystemPrompt must NOT loop over hardcoded aisle array', () => {
  const source = readText(path.join(ROOT, 'lib/chat.ts'));
  const buildPromptStart = source.indexOf('export function buildSystemPrompt');
  const buildPromptEnd = source.indexOf('\nexport ', buildPromptStart + 1);
  const fnBlock = source.slice(buildPromptStart, buildPromptEnd > 0 ? buildPromptEnd : undefined);

  // Must not have a hardcoded aisles array
  assert.ok(
    !fnBlock.includes("'action', 'horreur', 'sf'"),
    'buildSystemPrompt must NOT have hardcoded aisle array — use Map from grouped query'
  );
});

// ===== P-04: Composite Indexes =====

test('P-04: schema.sql must have composite index on rentals(film_id, is_active, expires_at)', () => {
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  assert.ok(
    schema.includes('idx_rentals_film_active') &&
    /idx_rentals_film_active\s+ON\s+rentals\s*\(\s*film_id\s*,\s*is_active\s*,\s*expires_at\s*\)/i.test(schema),
    'Must have composite index idx_rentals_film_active ON rentals(film_id, is_active, expires_at)'
  );
});

test('P-04: schema.sql must have composite index on rentals(user_id, is_active, expires_at)', () => {
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  assert.ok(
    schema.includes('idx_rentals_user_active') &&
    /idx_rentals_user_active\s+ON\s+rentals\s*\(\s*user_id\s*,\s*is_active\s*,\s*expires_at\s*\)/i.test(schema),
    'Must have composite index idx_rentals_user_active ON rentals(user_id, is_active, expires_at)'
  );
});

test('P-04: schema.sql must have index on rentals(expires_at)', () => {
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  assert.ok(
    schema.includes('idx_rentals_expires') &&
    /idx_rentals_expires\s+ON\s+rentals\s*\(\s*expires_at\s*\)/i.test(schema),
    'Must have index idx_rentals_expires ON rentals(expires_at)'
  );
});
