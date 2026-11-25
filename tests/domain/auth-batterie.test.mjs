// Connexion et inscription : défauts relevés par la batterie de tests du 25/11/2026 (testeur « connexion et compte »).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { checkRateLimit, forgiveAttempt, tooManyAttempts } from '../../lib/rate-limit.ts';
import { usernameRuleError } from '../../src/utils/account-rules.ts';

const ROOT = process.cwd();
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('DÉBIT: une connexion réussie ne compte pas comme une tentative', () => {
  // Rusmir s'est fait bloquer un quart d'heure à son premier essai : cinq connexions, réussies ou non, suffisaient.
  const key = `test-${Math.random()}:login`;
  for (let i = 0; i < 20; i++) {
    assert.equal(checkRateLimit(key, 5, 60_000), null, `essai ${i + 1} accepté`);
    forgiveAttempt(key);                       // … et réussi
  }
  // Les échecs, eux, comptent toujours : le sixième est refusé.
  const rate = `test-${Math.random()}:login`;
  for (let i = 0; i < 5; i++) assert.equal(checkRateLimit(rate, 5, 60_000), null);
  assert.ok(checkRateLimit(rate, 5, 60_000) > 0, 'sixième échec : bloqué');
  // Pardonner une clé inconnue ou déjà à zéro ne casse rien.
  forgiveAttempt('jamais-vue');
});

test('DÉBIT: le message de blocage est en français correct, au singulier comme au pluriel', () => {
  assert.equal(tooManyAttempts(840), 'Trop de tentatives. Réessayez dans 14 minutes.');
  assert.equal(tooManyAttempts(31), 'Trop de tentatives. Réessayez dans 1 minute.');
  assert.equal(tooManyAttempts(3600, 'Trop de tentatives sur ce compte'), 'Trop de tentatives sur ce compte. Réessayez dans 60 minutes.');
});

test('DÉBIT: les routes pardonnent les réussites et parlent français', () => {
  const login = read('app/api/auth/login/route.ts');
  assert.match(login, /forgiveAttempt\(ipKey\);[\s\S]{0,80}forgiveAttempt\(usernameKey\);/, 'connexion réussie : ni l\'adresse ni le compte ne sont pénalisés');
  const register = read('app/api/auth/register/route.ts');
  assert.match(register, /forgiveAttempt\(rateLimitKey\)/, 'un refus (pseudo pris, règle) ne mange pas un des trois comptes permis');
  assert.match(register, /'register-refus'/, 'les refus ont leur propre limite, plus large');
  for (const f of ['login', 'register', 'recover']) {
    const src = read(`app/api/auth/${f}/route.ts`);
    assert.ok(!src.includes('Reessayez'), `${f} : « Réessayez » avec son accent`);
    assert.ok(src.includes('tooManyAttempts('), `${f} : message commun`);
  }
  assert.ok(read('app/api/auth/recover/route.ts').includes('Pseudo ou phrase de récupération incorrects'), 'le champ s\'appelle « Phrase de récupération », pas « passphrase »');
});

test('COMPTE: le pseudo ne dépend pas des majuscules, et deux comptes ne peuvent pas ne différer que par elles', () => {
  const auth = read('lib/auth.ts');
  assert.match(auth, /function findUserRow\(username: string\)[\s\S]{0,700}COLLATE NOCASE/, 'recherche exacte d\'abord, puis sans tenir compte de la casse');
  assert.match(auth, /loose\.length === 1/, 'deux comptes anciens qui ne diffèrent que par la casse : seul le pseudo exact se connecte');
  assert.equal((auth.match(/findUserRow\(username\)/g) ?? []).length, 2, 'la connexion et la récupération passent par la même recherche');
  const exists = auth.slice(auth.indexOf('export function usernameExists'));
  assert.match(exists, /COLLATE NOCASE/, '« Test1A » est refusé quand « test1a » existe');
});

test('COMPTE: les routes refusent proprement une requête mal formée', () => {
  for (const f of ['login', 'register', 'recover']) {
    const src = read(`app/api/auth/${f}/route.ts`);
    assert.match(src, /await request\.json\(\)\.catch\(\(\) => null\)/, `${f} : un corps qui n\'est pas du JSON ne fait pas une erreur 500`);
    assert.match(src, /typeof (username|rawUsername) !== 'string'/, `${f} : un pseudo qui n\'est pas du texte est refusé`);
  }
});

test('COMPTE: un pseudo fait d\'espaces est refusé, et les espaces autour ne comptent pas', () => {
  assert.ok(usernameRuleError('   '), 'trois espaces ne font pas un pseudo');
  assert.ok(usernameRuleError('  ab  '), 'deux lettres entourées d\'espaces : trop court');
  assert.equal(usernameRuleError('abc'), null);
  const register = read('app/api/auth/register/route.ts');
  assert.match(register, /const username = [^;]*\.trim\(\)/, 'le serveur enregistre le pseudo sans les espaces autour');
});
