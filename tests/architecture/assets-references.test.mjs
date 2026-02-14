import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

function extractPublicAssetPathsFromTsx(source) {
  const assets = new Set();
  const patterns = [
    /src\s*=\s*["']\/([^"']+)["']/g,
    /load\(\s*["']\/([^"']+)["']\s*\)/g,
    /files\s*=\s*["']\/([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      assets.add(match[1]);
    }
  }

  return [...assets];
}

test('architecture: referenced static assets exist in public/', () => {
  const filesToInspect = [
    'src/components/exterior/ExteriorView.tsx',
    'src/components/mobile/MobileOnboarding.tsx',
    'src/components/exterior/scene/ExteriorScene.ts',
    'src/components/interior/InteriorScene.tsx',
  ];

  const missing = [];

  for (const relativeFile of filesToInspect) {
    const absoluteFile = path.join(ROOT, relativeFile);
    const source = readText(absoluteFile);
    const assets = extractPublicAssetPathsFromTsx(source);

    for (const asset of assets) {
      const absoluteAsset = path.join(ROOT, 'public', asset);
      if (!existsSync(absoluteAsset)) {
        missing.push(`${relativeFile} -> /${asset}`);
      }
    }
  }

  assert.equal(
    missing.length,
    0,
    `Missing assets referenced in code:\n${missing.join('\n')}`
  );
});
