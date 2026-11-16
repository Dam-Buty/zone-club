import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText, walkFiles } from '../helpers/repo.mjs';

const ROOT = process.cwd();
const setGpu = (value) => Object.defineProperty(globalThis.navigator, 'gpu', { value, configurable: true });

test('BORNE: sans WebGPU, la vanne des préchargements 3D reste fermée', async () => {
  setGpu(undefined);
  const gate = await import('../../src/utils/interior-preload-gate.ts');
  let ran = 0;
  gate.afterStorefront(() => { ran++; });
  assert.equal(gate.hasWebGPU(), false);
  gate.releaseInteriorPreload();
  assert.equal(ran, 0, 'aucun préchargement 3D ne doit partir sans WebGPU');
  setGpu({});
  assert.equal(gate.hasWebGPU(), true);
  gate.releaseInteriorPreload();
  assert.equal(ran, 1);
});
test('BORNE: la borne est une scène à part entière', () => {
  const src = readText(path.join(ROOT, 'src/types/index.ts'));
  assert.match(src, /export type SceneType = 'exterior' \| 'interior' \| 'kiosk';/);
});
test('BORNE: la vidéo d\'attente de la devanture est désactivée', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  for (const gone of ['IdleVideo', 'useIdleDetection', 'videoclubvideo']) {
    assert.ok(!src.includes(gone), `ExteriorView ne doit plus référencer ${gone}`);
  }
});
test('BORNE: la devanture propose la borne et ne laisse pas entrer sans WebGPU', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  assert.ok(src.includes('onOpenKiosk'), 'bouton de la borne');
  assert.ok(src.includes('canEnter'), 'la porte consulte canEnter');
  assert.ok(src.includes('DoorBlockedNotice'), 'message de la porte');
});
test('BORNE: le message de la porte sans WebGPU n\'offre pas d\'entrer quand même', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/DoorBlockedNotice.tsx'));
  assert.match(src, /onForceEnter\s*&&/, '« Entrer quand même » n\'apparaît que si onForceEnter est fourni');
});
