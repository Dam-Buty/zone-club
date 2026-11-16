import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import * as R from '../../src/utils/account-rules.ts';

// Les règles d'un compte (pseudo, mot de passe) vivaient en trois exemplaires qui avaient
// divergé : la route d'inscription (3 à 30 caractères, 8 caractères, minuscule + majuscule +
// chiffre), la route de récupération (8 caractères seulement), et les deux formulaires (celui du
// vidéoclub s'en remettait au navigateur, celui de la borne ne vérifiait rien). L'inscription
// étant limitée à 3 essais par quart d'heure, un visiteur découvrait les règles un refus à la
// fois et se retrouvait bloqué. Une seule définition désormais, pour le serveur et les formulaires.

test('COMPTE: règles du pseudo', () => {
  assert.equal(R.usernameRuleError('ana'), null);
  assert.equal(R.usernameRuleError('a'.repeat(30)), null);
  assert.equal(R.usernameRuleError('ab'), 'Le pseudo doit faire entre 3 et 30 caractères');
  assert.equal(R.usernameRuleError('a'.repeat(31)), 'Le pseudo doit faire entre 3 et 30 caractères');
});
test('COMPTE: règles du mot de passe', () => {
  assert.equal(R.passwordRuleError('Abcdefg1'), null);
  assert.equal(R.passwordRuleError('Abcdef1'), 'Le mot de passe doit faire au moins 8 caractères');
  const mix = 'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre';
  assert.equal(R.passwordRuleError('abcdefg1'), mix, 'sans majuscule');
  assert.equal(R.passwordRuleError('ABCDEFG1'), mix, 'sans minuscule');
  assert.equal(R.passwordRuleError('Abcdefgh'), mix, 'sans chiffre');
});
test('COMPTE: le formulaire dit ce qui manque, dans l\'ordre des champs', () => {
  const ok = { username: 'ana', password: 'Secret12', confirm: 'Secret12', phrase: 'un deux trois' };
  assert.equal(R.accountFormError('login', { ...ok, confirm: '', phrase: '' }), null);
  assert.equal(R.accountFormError('login', { ...ok, username: '  ' }), 'Saisissez votre pseudo.');
  assert.equal(R.accountFormError('login', { ...ok, password: '' }), 'Saisissez votre mot de passe.');
  assert.equal(R.accountFormError('register', { ...ok, confirm: 'autre' }), 'Les deux mots de passe ne sont pas identiques.');
  assert.equal(R.accountFormError('recover', { ...ok, phrase: '' }), 'Saisissez votre phrase de récupération.');
  assert.equal(R.accountFormError('recover', ok), null);
  assert.equal(R.accountFormError('register', ok), null);
});
test('COMPTE: le formulaire applique les règles du serveur AVANT d\'envoyer', () => {
  const ok = { username: 'ana', password: 'Secret12', confirm: 'Secret12', phrase: 'un deux trois' };
  assert.match(R.accountFormError('register', { ...ok, username: 'ab' }), /entre 3 et 30/);
  assert.match(R.accountFormError('register', { ...ok, password: 'Abc1', confirm: 'Abc1' }), /au moins 8/);
  assert.match(R.accountFormError('register', { ...ok, password: 'abcdefg1', confirm: 'abcdefg1' }), /minuscule, une majuscule et un chiffre/);
  assert.match(R.accountFormError('recover', { ...ok, password: 'abcdefgh', confirm: 'abcdefgh' }), /minuscule, une majuscule et un chiffre/);
  // À la connexion, seul le serveur juge : un compte ancien peut porter un mot de passe d'avant les règles.
  assert.equal(R.accountFormError('login', { ...ok, username: 'ab', password: 'x' }), null);
});
test('COMPTE: le serveur et les deux formulaires passent par la même définition', () => {
  const root = process.cwd();
  const register = readText(path.join(root, 'app/api/auth/register/route.ts'));
  assert.ok(register.includes('usernameRuleError(') && register.includes('passwordRuleError('), 'route d\'inscription');
  assert.ok(!/password\.length < 8/.test(register), 'la route d\'inscription ne redéfinit pas la règle');
  const recover = readText(path.join(root, 'app/api/auth/recover/route.ts'));
  assert.ok(recover.includes('passwordRuleError('), 'route de récupération');
  assert.ok(!/newPassword\.length < 8/.test(recover), 'la route de récupération ne redéfinit pas la règle');
  for (const file of ['src/components/kiosk/KioskAuth.tsx', 'src/components/auth/AuthModal.tsx']) {
    assert.ok(readText(path.join(root, file)).includes('accountFormError('), `${file} valide par accountFormError`);
  }
});
test('COMPTE: le formulaire du vidéoclub n\'échoue plus en silence', () => {
  const src = readText(path.join(process.cwd(), 'src/components/auth/AuthModal.tsx'));
  assert.ok(!/console\.error\('Recovery error:'/.test(src), 'un refus de récupération est affiché, pas seulement journalisé');
  assert.ok(src.includes('formError'), 'le refus du formulaire est affiché');
});
