import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

// lib/perf-run-parse.ts n'a aucun import : Node le charge tel quel quand le retrait de types
// est disponible. Sur un Node plus ancien, ces cas sont sautés plutôt que de casser la suite.
let parse = null;
try {
  parse = await import(pathToFileURL(path.join(ROOT, 'lib/perf-run-parse.ts')).href);
} catch {
  parse = null;
}
const skip = parse === null ? 'retrait de types TypeScript indisponible sur ce Node' : false;

test('perf: une mesure valide est conservée, bornée et arrondie', { skip }, () => {
  const run = parse.parsePerfRun({
    run_key: 'a1b2c3d4e5f60718293a4b5c', build: 'abc1234', outcome: 'ready', is_mobile: 1, first_visit: true,
    click_to_ready_ms: 9180.4, warmup_ms: 4482, post_fps: 59.8, model: 'Pixel 9a',
    ua: 'x'.repeat(1000), cores: 8,
  });
  assert.equal(run.outcome, 'ready');
  assert.equal(run.run_key, 'a1b2c3d4e5f60718293a4b5c');
  assert.equal(run.click_to_ready_ms, 9180);
  assert.equal(run.is_mobile, 1);
  assert.equal(run.first_visit, 1);
  assert.equal(run.automated, 0);
  assert.equal(run.model, 'Pixel 9a');
  assert.equal(run.ua.length, 256);
  assert.equal(run.precompile_ms, null);
});

test('perf: ce qui n\'est pas une mesure est refusé', { skip }, () => {
  assert.equal(parse.parsePerfRun(null), null);
  assert.equal(parse.parsePerfRun('ready'), null);
  assert.equal(parse.parsePerfRun([]), null);
  const key = 'a1b2c3d4e5f60718293a4b5c';
  assert.equal(parse.parsePerfRun({ run_key: key, outcome: 'ready' }), null, 'build manquant');
  assert.equal(parse.parsePerfRun({ run_key: key, build: 'abc', outcome: 'gagné' }), null, 'issue inconnue');
  assert.equal(parse.parsePerfRun({ build: 'abc', outcome: 'ready' }), null, 'clé de passe manquante');
  assert.equal(parse.parsePerfRun({ run_key: "x'; DROP TABLE films;--", build: 'abc', outcome: 'ready' }), null, 'clé de passe mal formée');
});

test('perf: les valeurs aberrantes ou mal typées deviennent null, pas des lignes fausses', { skip }, () => {
  const run = parse.parsePerfRun({
    run_key: 'a1b2c3d4e5f60718293a4b5c', build: 'abc', outcome: 'abandoned',
    click_to_ready_ms: -5, warmup_ms: 9e9, precompile_ms: '3000', post_fps: Infinity,
    cores: 0, model: 42, gpu_desc: 'Mali\u0000\nG715',
  });
  assert.equal(run.click_to_ready_ms, null);
  assert.equal(run.warmup_ms, null);
  assert.equal(run.precompile_ms, null);
  assert.equal(run.post_fps, null);
  assert.equal(run.cores, null);
  assert.equal(run.model, null);
  assert.equal(run.gpu_desc, 'Mali  G715');
});

test('perf: la route publique ne stocke ni IP ni session, et borne la taille du corps', () => {
  const route = readText(path.join(ROOT, 'app/api/perf/route.ts'));
  assert.match(route, /PERF_MAX_BODY_BYTES/, 'taille du corps bornée');
  assert.match(route, /checkRateLimit/, 'débit limité');
  assert.doesNotMatch(route, /getUserFromSession|cookies\(/, 'aucune lecture de session');
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS client_perf_runs'));
  const columns = table.slice(0, table.indexOf(');'));
  assert.doesNotMatch(columns, /\b(ip|user_id|session|email)\b/i, 'aucune colonne identifiante');
});

test('perf: la mesure part par étapes, jamais au départ de la page', () => {
  // Sous le contrôle du service worker, un sendBeacon émis pendant pagehide est accepté par
  // Chrome puis jamais envoyé (mesuré : 0 sur 5). Les étapes « page vivante » sont la seule
  // façon fiable de compter ceux qui n'entrent pas ou abandonnent.
  const beacon = readText(path.join(ROOT, 'src/utils/perf-beacon.ts'));
  const code = beacon.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /addEventListener\(\s*['"](pagehide|beforeunload|unload)['"]/, 'aucun envoi suspendu au départ de la page');
  for (const stage of ["flush('no_entry')", "flush('abandoned')", "flush(warmupMax ? 'warmup_max' : 'ready')"]) {
    assert.ok(code.includes(stage), `étape ${stage} présente`);
  }
  const lib = readText(path.join(ROOT, 'lib/perf-runs.ts'));
  assert.match(lib, /ON CONFLICT\(run_key\) DO UPDATE/, 'une ligne par passe, mise à jour d\'étape en étape');
  assert.match(lib, /WHERE client_perf_runs\.outcome NOT IN \('ready', 'warmup_max'\)/, 'une passe prête ne redescend pas');
});

test('perf: chaque colonne insérée existe dans le schéma', () => {
  const lib = readText(path.join(ROOT, 'lib/perf-runs.ts'));
  const block = lib.slice(lib.indexOf('const COLUMNS = ['), lib.indexOf('] as const'));
  const names = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 20, 'liste de colonnes lue');
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS client_perf_runs'));
  const columns = table.slice(0, table.indexOf(');'));
  for (const name of names) {
    assert.match(columns, new RegExp('\\n\\s+' + name + ' '), `colonne ${name} absente de client_perf_runs`);
  }
});
