// Rendre une K7 depuis la borne (Rusmir, 25/11/2026 : « on doit pouvoir rendre un film sur la borne »).
// Le parcours vit dans useKioskReturn, partagé par « Mon compte » et la proposition à l'arrivée.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const src = (p) => readText(path.join(process.cwd(), p));

test('RENDRE: le crochet porte la question, le retour et le message de fin', () => {
  const hook = src('src/components/kiosk/useKioskReturn.ts');
  assert.match(hook, /export function useKioskReturn\(/);
  assert.match(hook, /await returnFilm\(filmId\)/, 'le même retour que la fiche K7 (store.returnFilm → POST /return)');
  assert.match(hook, /returnConfirmText\(/, 'la question avant de rendre');
  assert.match(hook, /label: 'Rendre'/);
  assert.match(hook, /label: 'Annuler'/);
  assert.match(hook, /returnDoneText\(/, 'un message dans tous les cas, échec compris');
  assert.match(hook, /returnReviewOffer\(/);
  assert.match(hook, /label: 'Écrire ma critique'/);
  assert.match(hook, /fetchMe\(\)/, "l'historique relu après le retour");
  assert.match(hook, /finally/, 'returningId toujours remis à zéro');
  assert.match(hook, /beforeReturn\?\.\(filmId\)/);
});

test('RENDRE: « Mon compte » délègue au crochet, la borne le branche', () => {
  const account = src('src/components/kiosk/KioskAccount.tsx');
  assert.match(account, /onAskReturn\(row\.filmId\)/, 'le bouton de la ligne pose la question');
  assert.match(account, /\{returningId === row\.filmId \? 'Retour…' : 'Rendre'\}/);
  assert.doesNotMatch(account, /returnFilm/, 'plus de retour dans le composant');
  assert.match(src('src/components/kiosk/KioskView.tsx'), /useKioskReturn\(/);
});

test('RENDRE: le délai du crédit affiché est celui du serveur (une seule règle)', () => {
  assert.match(src('src/components/kiosk/kiosk-account-logic.ts'), /import \{ isEarlyReturn \} from '\.\.\/\.\.\/utils\/rental-rules\.ts';/);
});

test('RENDRE: la proposition à l\'arrivée est câblée dans la borne', () => {
  const view = src('src/components/kiosk/KioskView.tsx');
  assert.match(view, /useReturnPrompt\(/);
  assert.match(view, /active:[^\n]*!welcome/);
  assert.match(src('src/components/kiosk/useKioskReturn.ts'), /export function useReturnPrompt\(/);
});

test('REMBOBINER: minuterie de 60 s puis crédit, nettoyée au démontage, et le retour ne rembobine jamais', () => {
  const hook = src('src/components/kiosk/useKioskRewind.ts');
  assert.match(hook, /setTimeout\([\s\S]*REWIND_MS/, 'la minuterie dure REWIND_MS');
  assert.match(hook, /claimRewind\(/);
  assert.ok(hook.indexOf('REWIND_MS') < hook.lastIndexOf('claimRewind('), 'le crédit vient après la minuterie');
  assert.match(hook, /clearTimeout/, 'cancel et démontage coupent la minuterie');
  assert.match(hook, /Le rembobinage n'a pas abouti/);
  assert.match(src('src/components/kiosk/KioskView.tsx'), /beforeReturn: rewind\.cancel/);
  assert.doesNotMatch(src('src/components/kiosk/useKioskReturn.ts'), /claimRewind/);
  const account = src('src/components/kiosk/KioskAccount.tsx');
  assert.match(account, /onRewind\(row\.filmId\)/);
  assert.match(account, /'Rembobinage…' : 'Rembobiner'/);
});
