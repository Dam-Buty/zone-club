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
