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
test('BORNE: App n\'arrête plus tout le site quand WebGPU manque', () => {
  const src = readText(path.join(ROOT, 'src/App.tsx'));
  assert.ok(!/return\s*<WebGPUNotSupported/.test(src), 'plus de retour anticipé sur l\'écran d\'excuses');
  assert.ok(src.includes("'kiosk'"), 'App connaît la scène kiosk');
  assert.ok(/suspended=\{/.test(src), 'la scène intérieure reçoit suspended');
});
test('BORNE: l\'interface de la borne reste du DOM pur', () => {
  const dir = path.join(ROOT, 'src/components/kiosk');
  const banned = [/backdrop-filter/i, /backdropFilter/, /<canvas/i, /from ['"]three/, /@react-three/, /selectFilm\(/, /fetchVHSCoverData/, /AuthModal/];
  for (const file of walkFiles(dir)) {
    const src = readText(file);
    for (const rx of banned) assert.ok(!rx.test(src), `${path.basename(file)} ne doit pas contenir ${rx}`);
  }
});
test('BORNE: la garde du geste retour n\'est jamais posée dès le montage', () => {
  // En dev, StrictMode rejoue les effets de montage (pose, retrait, pose) : avec useBackGuard(true, …)
  // le retrait asynchrone de l'entrée d'historique retombe une entrée trop loin, et « quitter »
  // fait sortir du site (constaté le 16/11/2026 : la page finissait sur about:blank).
  for (const file of walkFiles(path.join(ROOT, 'src/components/kiosk'))) {
    assert.ok(!/useBackGuard\(\s*true\b/.test(readText(file)), `${path.basename(file)} : useBackGuard(true, …) au montage`);
  }
});

// ===== Scène intérieure réellement abandonnée quand la borne s'ouvre en plein préchauffage =====
// Constat du 16/11/2026 (attribution des requestAnimationFrame dans le navigateur) : une scène
// démontée laissait tourner sa boucle de préchauffage et la boucle interne de son renderer.

test('BORNE: une scène démontée libère son renderer, après le nettoyage de R3F', async (t) => {
  const { releaseRendererAfterUnmount } = await import('../../src/components/interior/release-renderer.ts');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let disposed = 0; let rootGone = false;
  releaseRendererAfterUnmount({ renderer: { dispose: () => { disposed++; } }, isRootGone: () => rootGone, isMountedAgain: () => false });
  t.mock.timers.tick(700);
  assert.equal(disposed, 0, 'pas tant que R3F n\'a pas libéré la scène');
  rootGone = true;
  t.mock.timers.tick(300);
  assert.equal(disposed, 1);
  t.mock.timers.tick(10000);
  assert.equal(disposed, 1, 'une seule fois');
});
test('BORNE: le renderer est libéré au plafond même si R3F ne rend jamais la main', async (t) => {
  const { releaseRendererAfterUnmount, RELEASE_CAP_MS } = await import('../../src/components/interior/release-renderer.ts');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let disposed = 0;
  releaseRendererAfterUnmount({ renderer: { dispose: () => { disposed++; } }, isRootGone: () => false, isMountedAgain: () => false });
  t.mock.timers.tick(RELEASE_CAP_MS - 300);
  assert.equal(disposed, 0);
  t.mock.timers.tick(600);
  assert.equal(disposed, 1);
});
test('BORNE: une scène remontée aussitôt (StrictMode, rechargement à chaud) garde son renderer', async (t) => {
  const { releaseRendererAfterUnmount } = await import('../../src/components/interior/release-renderer.ts');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let disposed = 0;
  releaseRendererAfterUnmount({ renderer: { dispose: () => { disposed++; } }, isRootGone: () => true, isMountedAgain: () => true });
  t.mock.timers.tick(20000);
  assert.equal(disposed, 0);
});
test('BORNE: un dispose() qui échoue ne remonte pas d\'erreur', async (t) => {
  const { releaseRendererAfterUnmount } = await import('../../src/components/interior/release-renderer.ts');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  releaseRendererAfterUnmount({ renderer: { dispose: () => Promise.reject(new Error('device perdu')) }, isRootGone: () => true, isMountedAgain: () => false });
  t.mock.timers.tick(1000);
  releaseRendererAfterUnmount({ renderer: { dispose: () => { throw new Error('synchrone'); } }, isRootGone: () => true, isMountedAgain: () => false });
  assert.doesNotThrow(() => t.mock.timers.tick(1000));
  await new Promise((resolve) => setImmediate(resolve)); // laisse passer un éventuel rejet non géré
});
test('BORNE: la boucle de préchauffage s\'arrête avec la scène', () => {
  const src = readText(path.join(ROOT, 'src/components/interior/InteriorScene.tsx'));
  const body = (name) => {
    const start = src.indexOf(`const ${name} = `);
    assert.ok(start > 0, `${name} introuvable dans InteriorScene`);
    return src.slice(start, start + 260);
  };
  for (const name of ['finish', 'tryReady', 'warmupLoop']) {
    assert.match(body(name), /isMountedRef\.current/, `${name} doit vérifier que la scène est encore montée`);
  }
  assert.match(src, /isMountedRef\.current = true/, 'l\'effet de montage remet la ref à vrai (StrictMode la laissait à faux)');
  assert.ok(src.includes('releaseRendererAfterUnmount('), 'le démontage libère le renderer');
});
