import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lineCount, toPosix, walkFiles } from '../helpers/repo.mjs';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'app', 'lib', 'scripts'];
const MAX_LINES = 1000;

// Explicit exceptions only (must stay rare).
const EXCEPTIONS = new Map([
  ['src/utils/VHSCoverGenerator.ts', 2800],
  ['src/components/interior/Aisle.tsx', 1100],
  ['src/components/interior/InteractiveTVDisplay.tsx', 1400],
]);

test('architecture: file sizes stay under 1000 lines (with explicit exceptions)', () => {
  const offenders = [];

  for (const dir of TARGET_DIRS) {
    const absoluteDir = path.join(ROOT, dir);
    for (const absoluteFile of walkFiles(absoluteDir)) {
      const rel = toPosix(path.relative(ROOT, absoluteFile));
      const lines = lineCount(absoluteFile);
      const allowedMax = EXCEPTIONS.get(rel) ?? MAX_LINES;

      if (lines > allowedMax) {
        offenders.push(`${rel} -> ${lines} lines (max ${allowedMax})`);
      }
    }
  }

  assert.equal(
    offenders.length,
    0,
    `Files over size budget:\n${offenders.join('\n')}`
  );
});
