// Le délai de retour anticipé et le nombre d'exemplaires : une seule valeur, lue par le serveur, le vidéoclub 3D, le tutoriel et la borne.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import * as R from '../../src/utils/rental-rules.ts';

const src = (p) => readText(path.join(process.cwd(), p));

test('RÈGLES: retour anticipé sous 8 h, borne comprise', () => {
  const t0 = Date.UTC(2026, 10, 26, 12, 0);
  assert.equal(R.EARLY_RETURN_HOURS, 8);
  assert.equal(R.isEarlyReturn(t0, t0 + 8 * 3_600_000), true);
  assert.equal(R.isEarlyReturn(t0, t0 + 8 * 3_600_000 + 1), false);
});

test('RÈGLES: 2 exemplaires pour une nouveauté, 1 sinon', () => {
  assert.equal(R.copiesForFilm(true), 2); assert.equal(R.copiesForFilm(1), 2);
  assert.equal(R.copiesForFilm(false), 1); assert.equal(R.copiesForFilm(0), 1); assert.equal(R.copiesForFilm(null), 1);
});

test('RÈGLES: le serveur, le vidéoclub 3D, le tutoriel et la borne lisent la même règle', () => {
  assert.match(src('lib/rentals.ts'), /isEarlyReturn\(/);
  assert.doesNotMatch(src('lib/rentals.ts'), /EARLY_RETURN_HOURS = 24/);
  assert.match(src('src/components/videoclub/VHSCaseOverlay.tsx'), /isEarlyReturn\(rental\.rentedAt, Date\.now\(\)\)/);
  assert.doesNotMatch(src('src/components/videoclub/VHSCaseOverlay.tsx'), /24h|24 \* 60 \* 60/);
  assert.match(src('src/components/tutorial/TutorialOverlay.tsx'), /Retourner le film sous 8h/);
});

test('EXEMPLAIRES: une migration unique, guidée par PRAGMA user_version, et plus l\'ancienne règle 3/2/1', () => {
  const db = src('lib/db.ts');
  assert.match(db, /PRAGMA user_version/);
  assert.match(db, /copiesForFilm/);
  assert.doesNotMatch(db, /SET stock = 3 WHERE is_nouveaute = 1/);
  assert.match(src('lib/films.ts'), /setFilmNouveaute[\s\S]{0,300}copiesForFilm\(isNouveaute\)/);
  assert.match(src('scripts/seed-films.ts'), /copiesForFilm\(/);
  assert.match(src('lib/rentals.ts'), /active_returns: activeRentals\.map\(/);
});

test('EXEMPLAIRES: un film inséré après la migration naît avec le bon nombre d\'exemplaires', () => {
  const films = src('lib/films.ts');
  assert.match(films, /INSERT INTO films \([\s\S]{0,400}aisle, is_nouveaute, stock\s*\)\s*VALUES \((\?, ){14}\?\)/);
  assert.match(films, /isNouveaute \? 1 : 0,\s*copiesForFilm\(isNouveaute\)\s*\)/);
  assert.match(src('lib/schema.sql'), /stock INTEGER DEFAULT 1,/);
});

test('RETOUR: deux retours simultanés ne créditent qu\'une fois (le UPDATE garde is_active = 1)', () => {
  const r = src('lib/rentals.ts');
  assert.match(r, /UPDATE rentals SET is_active = 0, returned_early = \?, returned_at = datetime\('now'\) WHERE id = \? AND is_active = 1/);
  assert.match(r, /\.changes !== 1/);
});
