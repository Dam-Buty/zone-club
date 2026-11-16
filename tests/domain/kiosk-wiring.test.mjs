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

// ===== Relecture finale du 16/11/2026 =====

// I1 — Scène démontée PENDANT l'initialisation de son renderer. R3F n'annule pas sa configuration
// au démontage : si la fabrique `gl` lui rend le renderer, il termine `configure()` et monte toute
// la scène dans la racine qu'il vient de démonter, qui n'est jamais retirée (constat du relecteur,
// reproduit avec le R3F du dépôt). Le test rejoue la séquence avec le vrai R3F, sans navigateur.
test('BORNE: une scène démontée pendant l\'initialisation du renderer n\'est jamais montée', async () => {
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 16);
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
  const React = (await import('react')).default;
  const { createRoot, unmountComponentAtNode, _roots, useFrame } = await import('@react-three/fiber');
  const { abandonRendererDuringInit } = await import('../../src/components/interior/release-renderer.ts');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const canvas = { style: {}, addEventListener() {}, removeEventListener() {}, width: 300, height: 150, parentElement: null };
  const counters = { mounts: 0, frames: 0, disposed: 0 };
  function Child() {
    React.useEffect(() => { counters.mounts++; }, []);
    useFrame(() => { counters.frames++; });
    return null;
  }
  const renderer = { render() {}, setPixelRatio() {}, setSize() {}, shadowMap: {}, domElement: canvas, dispose() { counters.disposed++; } };
  let mounted = true;
  let resolveInit;
  const root = createRoot(canvas);
  void (async () => {
    await root.configure({
      // Même forme que la fabrique d'InteriorScene : init asynchrone, puis la garde de démontage.
      gl: async () => {
        await new Promise((resolve) => { resolveInit = resolve; });
        if (!mounted) return abandonRendererDuringInit({ renderer, forgetRoot: () => { _roots.delete(canvas); } });
        return renderer;
      },
      size: { width: 300, height: 150, top: 0, left: 0 },
      frameloop: 'always',
    });
    root.render(React.createElement(Child));
  })();

  await delay(50);
  mounted = false;                 // la borne s'ouvre : la scène est démontée…
  unmountComponentAtNode(canvas);
  await delay(100);
  resolveInit();                   // …puis l'initialisation du renderer se termine
  await delay(900);                // au-delà des 500 ms du nettoyage différé de R3F

  assert.equal(counters.mounts, 0, 'la scène ne doit pas être montée dans la racine démontée');
  assert.equal(counters.frames, 0, 'aucune image ne doit tourner');
  assert.equal(counters.disposed, 1, 'le renderer orphelin est libéré');
  assert.equal(_roots.has(canvas), false, 'la racine R3F est retirée');
});
test('BORNE: InteriorScene ne rend pas à R3F le renderer d\'une scène déjà démontée', () => {
  const src = readText(path.join(ROOT, 'src/components/interior/InteriorScene.tsx'));
  const start = src.indexOf('await renderer.init()');
  assert.ok(start > 0);
  const branch = src.slice(start, start + 900);
  assert.match(branch, /abandonRendererDuringInit(<[^>]*>)?\(/, 'la branche « démontée pendant l\'init » passe par abandonRendererDuringInit');
});

// D12 — La phrase de récupération reste en mémoire jusqu'à ce que le visiteur confirme l'avoir
// notée ; une déconnexion doit donc l'effacer, sinon la personne suivante sur le même appareil
// la verrait à l'ouverture de la borne.
test('BORNE: la déconnexion efface une phrase de récupération restée en mémoire', () => {
  const src = readText(path.join(ROOT, 'src/store/index.ts'));
  const start = src.indexOf('logout: async () => {');
  assert.ok(start > 0, 'logout introuvable dans le magasin');
  const body = src.slice(start, src.indexOf('clearAuthError:', start));
  assert.match(body, /recoveryPhrase: null/, 'logout doit remettre recoveryPhrase à null');
});
