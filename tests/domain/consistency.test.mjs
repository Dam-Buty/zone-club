import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

function extractQuotedItems(block) {
  const items = [];
  const re = /'([^']+)'/g;
  let match;
  while ((match = re.exec(block)) !== null) items.push(match[1]);
  return items;
}

function extractAisleTypeItems(source) {
  const match = source.match(/export type AisleType\s*=\s*([^;]+);/);
  assert.ok(match, 'Unable to find AisleType union in src/types/index.ts');
  return extractQuotedItems(match[1]);
}

function extractArrayItems(source, regex, label) {
  const match = source.match(regex);
  assert.ok(match, `Unable to find ${label}`);
  return extractQuotedItems(match[1]);
}

function extractMapperKeys(source) {
  const signature = 'function apiFilmToFilm';
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, 'Unable to find apiFilmToFilm function');

  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, 'Unable to find apiFilmToFilm opening brace');

  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, 'Unable to parse apiFilmToFilm function body');

  const functionBlock = source.slice(bodyStart, end + 1);
  const match = functionBlock.match(/return\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(match, 'Unable to parse apiFilmToFilm return object');
  const keys = [];
  const keyRe = /^\s*([a-zA-Z0-9_]+)\s*:/gm;
  let keyMatch;
  while ((keyMatch = keyRe.exec(match[1])) !== null) {
    keys.push(keyMatch[1]);
  }
  return keys;
}

test('domain: aisle constants stay consistent across app/store/types', () => {
  const typesSource = readText(path.join(ROOT, 'src/types/index.ts'));
  const appSource = readText(path.join(ROOT, 'src/App.tsx'));
  const storeSource = readText(path.join(ROOT, 'src/store/index.ts'));

  const fromTypes = extractAisleTypeItems(typesSource).sort();
  const fromApp = extractArrayItems(
    appSource,
    /const AISLES:\s*AisleType\[]\s*=\s*\[([\s\S]*?)\];/,
    'AISLES array in src/App.tsx'
  ).sort();
  const fromStore = extractArrayItems(
    storeSource,
    /const aisles:\s*AisleType\[]\s*=\s*\[([\s\S]*?)\];/,
    'aisles array in src/store/index.ts'
  ).sort();

  assert.deepEqual(fromApp, fromTypes, 'AISLES in App.tsx must match AisleType');
  assert.deepEqual(fromStore, fromTypes, 'aisles in store must match AisleType');
});

test('domain: apiFilmToFilm is a single shared mapper consumed by App and store', () => {
  // apiFilmToFilm used to be duplicated in App.tsx and store/index.ts (this test
  // guarded that the two copies stayed aligned). It was since extracted into the
  // API client (src/api/index.ts) as a single source of truth, so the invariant
  // is now "defined once, imported — never re-implemented" instead of "kept in sync".
  const apiSource = readText(path.join(ROOT, 'src/api/index.ts'));
  const appSource = readText(path.join(ROOT, 'src/App.tsx'));
  const storeSource = readText(path.join(ROOT, 'src/store/index.ts'));

  // 1. The mapper is defined in the API client with a non-empty return shape.
  const apiKeys = extractMapperKeys(apiSource);
  assert.ok(apiKeys.length > 0, 'apiFilmToFilm must be defined in src/api/index.ts');

  // 2. App and store must NOT redefine their own copy of the mapper.
  assert.equal(
    appSource.includes('function apiFilmToFilm'),
    false,
    'App.tsx must not redefine apiFilmToFilm — import it from ./api instead'
  );
  assert.equal(
    storeSource.includes('function apiFilmToFilm'),
    false,
    'store/index.ts must not redefine apiFilmToFilm — import it from ../api instead'
  );

  // 3. Both consumers actually reference the shared mapper.
  assert.ok(appSource.includes('apiFilmToFilm'), 'App.tsx must use the shared apiFilmToFilm');
  assert.ok(storeSource.includes('apiFilmToFilm'), 'store/index.ts must use the shared apiFilmToFilm');
});

test('domain: mock seed aisles stay within AisleType', () => {
  // La liste de rayons codée en dur dans scripts/seed-films.ts avait perdu
  // `aventure` et `romance` : les films de ces deux rayons étaient seedés avec
  // `aisle = NULL`, donc invisibles dans le 3D, sans la moindre erreur. Le script
  // dérive désormais ses rayons des clés du JSON — reste à vérifier que ces clés
  // sont des rayons réels.
  const typesSource = readText(path.join(ROOT, 'src/types/index.ts'));
  const known = new Set(extractAisleTypeItems(typesSource));

  const seed = JSON.parse(readText(path.join(ROOT, 'src/data/mock/films.json')));
  const unknown = Object.keys(seed).filter((key) => !known.has(key));
  assert.deepEqual(unknown, [], 'films.json contains aisle keys absent from AisleType');

  const physical = [...known].filter((a) => a !== 'nouveautes');
  const missing = physical.filter((a) => !Array.isArray(seed[a]) || seed[a].length === 0);
  assert.deepEqual(missing, [], 'every physical aisle must be seeded with at least one film');
});
