import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readText, toPosix, walkFiles } from '../helpers/repo.mjs';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'app', 'lib', 'scripts'];

const RESOLUTION_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.module.css',
  '.sql',
];

function extractImportSpecifiers(source) {
  const specs = new Set();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specs.add(match[1]);
    }
  }

  return [...specs];
}

function resolvesToExistingFile(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);

  if (existsSync(base) && !base.endsWith(path.sep)) return true;

  for (const ext of RESOLUTION_EXTENSIONS) {
    if (existsSync(`${base}${ext}`)) return true;
  }

  for (const ext of RESOLUTION_EXTENSIONS) {
    if (existsSync(path.join(base, `index${ext}`))) return true;
  }

  return false;
}

test('architecture: no dangling relative imports', () => {
  const dangling = [];

  for (const dir of TARGET_DIRS) {
    for (const file of walkFiles(path.join(ROOT, dir))) {
      const source = readText(file);
      const specifiers = extractImportSpecifiers(source);

      for (const specifier of specifiers) {
        if (!specifier.startsWith('.')) continue;
        if (!resolvesToExistingFile(file, specifier)) {
          dangling.push(`${toPosix(path.relative(ROOT, file))} -> ${specifier}`);
        }
      }
    }
  }

  assert.equal(
    dangling.length,
    0,
    `Dangling relative imports detected:\n${dangling.join('\n')}`
  );
});
