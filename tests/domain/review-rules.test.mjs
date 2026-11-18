import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { REVIEW_MIN_LENGTH, REVIEW_RATING_LABELS } from '../../src/utils/review-rules.ts';

// Rusmir, 17-18/11/2026 : « on en demande trop » (500 → 144) ; « on ne peut pas juste écrire scén ou jeu, il faut
// dire scénario et jeu d'acteurs ». Une seule définition, utilisée partout où une critique s'écrit ou se lit.
const ROOT = process.cwd();
const read = (f) => readText(path.join(ROOT, f));

test('CRITIQUE: 144 caractères au minimum, et les notes nommées en entier', () => {
  assert.equal(REVIEW_MIN_LENGTH, 144);
  assert.deepEqual(REVIEW_RATING_LABELS, { direction: 'Réalisation', screenplay: 'Scénario', acting: "Jeu d'acteurs" });
});
test('CRITIQUE: plus aucun minimum de 500 nulle part', () => {
  const files = ['lib/reviews.ts', 'src/components/review/ReviewModal.tsx', 'src/components/player/VHSPlayer.tsx',
    'src/components/manager/GenUICriticForm.tsx', 'lib/chat-tools.ts', 'lib/chat.ts'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/MIN_[A-Z_]*LENGTH\s*=\s*500|minimum 500|500\+|min\. 500|\/500|length < 500/.test(src), `${f} parle encore de 500`);
    assert.ok(src.includes('REVIEW_MIN_LENGTH') || src.includes('144'), `${f} ne connaît pas le minimum de 144`);
  }
});
test('CRITIQUE: aucune note abrégée là où une critique s\'écrit ou se lit', () => {
  for (const f of ['src/components/player/VHSPlayer.tsx', 'src/components/review/ReviewModal.tsx',
    'src/components/manager/GenUICriticForm.tsx', 'src/components/terminal/TVTerminal.tsx']) {
    const src = read(f);
    assert.ok(src.includes('REVIEW_RATING_LABELS'), `${f} doit lire REVIEW_RATING_LABELS`);
    for (const bad of ["'RÉAL'", "'SCÉN'", "'JEU'", 'Réal:', 'Scén:', 'Jeu:', "'Realisation'", "'Scenario'"]) {
      assert.ok(!src.includes(bad), `${f} contient encore ${bad}`);
    }
  }
});
// Vu le 18/11 au format du téléphone (412 px) : les trois rangées de cinq étoiles, côte à côte, débordaient de
// l'écran du lecteur. Sous 600 px, elles s'empilent, avec des étoiles à la taille du doigt.
test('CRITIQUE (lecteur): les notes s\'empilent sur un téléphone', () => {
  const css = readText(path.join(ROOT, 'src/components/player/VHSPlayer.module.css'));
  const mq = css.slice(css.indexOf('@media (max-width: 600px)', css.indexOf('.rewindRatingsRow')));
  assert.ok(css.indexOf('@media (max-width: 600px)', css.indexOf('.rewindRatingsRow')) !== -1, 'une règle pour les écrans étroits');
  assert.match(mq, /\.rewindRatingsRow\s*\{[^}]*flex-direction:\s*column/, 'notes empilées');
  assert.match(mq, /\.rewindStar\s*\{[^}]*min-width:\s*44px/, 'étoiles à la taille du doigt');
});
