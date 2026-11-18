import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { reviewEligibility } from '../../lib/review-eligibility.ts';

// Règle de critique (spec 2026-11-17-borne-mon-compte, § 6) : au moins une location du film avec 80 % vus, et
// au moins 80 % de la durée écoulés depuis son lancement ; n'importe quelle location suffit (Rusmir, 18/11).
const NOW = Date.UTC(2026, 10, 18, 20, 0);
const sqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const rental = (o = {}) => ({ watch_progress: 100, watch_started_at: null, duration_sec: 7200, runtime: 120, ...o });

test('CRITIQUE: vue à 100 % sans lancement noté (location antérieure) → permise', () => {
  assert.deepEqual(reviewEligibility([rental()], NOW), { allowed: true, reason: null, availableAtMs: null });
});
test('CRITIQUE: vue à 100 % mais lancée il y a 10 min sur un film de 2 h → pas encore', () => {
  const started = NOW - 10 * 60_000;
  const r = reviewEligibility([rental({ watch_started_at: sqlUtc(started) })], NOW);
  assert.equal(r.allowed, false);
  assert.equal(r.availableAtMs, started + 0.8 * 7200 * 1000);
  assert.match(r.reason, /^Critique possible à partir du /);
});
test('CRITIQUE: n\'importe quelle location suffit — l\'ancienne vue en entier, la nouvelle à 0 %', () => {
  const r = reviewEligibility([rental({ watch_progress: 0, watch_started_at: null }), rental({ watch_started_at: sqlUtc(NOW - 3 * 86_400_000) })], NOW);
  assert.equal(r.allowed, true);
});
test('CRITIQUE: seule location à 40 % → il faut avoir vu 80 % du film', () => {
  assert.deepEqual(reviewEligibility([rental({ watch_progress: 40 })], NOW), { allowed: false, reason: 'Vous devez regarder au moins 80 % du film', availableAtMs: null });
});
test('CRITIQUE: durée inconnue → la garde de temps ne bloque pas', () => {
  const r = reviewEligibility([rental({ watch_started_at: sqlUtc(NOW - 60_000), duration_sec: null, runtime: null })], NOW);
  assert.equal(r.allowed, true);
});
test('CRITIQUE: sans duration_sec, la durée vient de runtime', () => {
  const started = NOW - 10 * 60_000;
  const r = reviewEligibility([rental({ watch_started_at: sqlUtc(started), duration_sec: null, runtime: 90 })], NOW);
  assert.equal(r.availableAtMs, started + 0.8 * 90 * 60 * 1000);
});
test('CRITIQUE: canUserReview lit toutes les locations du film et délègue à la règle', () => {
  const src = readText(path.join(process.cwd(), 'lib/reviews.ts'));
  const fn = src.slice(src.indexOf('export function canUserReview'), src.indexOf('function getISOWeekStart'));
  assert.ok(fn.includes('reviewEligibility('), 'délègue');
  assert.ok(!/LIMIT 1/.test(fn), 'plus seulement la dernière location');
  assert.ok(fn.includes('duration_sec') && fn.includes('watch_started_at'), 'lit la durée et le lancement');
});
