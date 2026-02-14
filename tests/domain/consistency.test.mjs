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

test('domain: ApiFilm -> Film mapper keys stay aligned between App and store', () => {
  const appSource = readText(path.join(ROOT, 'src/App.tsx'));
  const storeSource = readText(path.join(ROOT, 'src/store/index.ts'));

  const appKeys = extractMapperKeys(appSource).sort();
  const storeKeys = extractMapperKeys(storeSource).sort();

  assert.deepEqual(
    appKeys,
    storeKeys,
    `apiFilmToFilm shape mismatch:\nApp keys: ${appKeys.join(', ')}\nStore keys: ${storeKeys.join(', ')}`
  );
});
