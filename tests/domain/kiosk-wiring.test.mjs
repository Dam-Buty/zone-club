import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// ===== Retours de Rusmir du 16/11/2026, après la relecture =====

// « Dès que le clic est fait sur la borne on doit libérer le GPU et les chargements côté
// vidéoclub. » La scène n'est donc plus jamais gardée gelée derrière la borne : prête ou non,
// elle est démontée (son renderer libéré, voir plus haut), et ne revient qu'une fois la
// devanture de nouveau affichée.
test('BORNE: dès l\'appui sur la borne, la scène 3D est démontée — prête ou non', async () => {
  const { shouldMountInterior } = await import('../../src/utils/interior-preload-gate.ts');
  const T = true; const F = false;
  // [WebGPU, scène, devanture affichée depuis 0,8 s] → scène 3D montée ?
  const table = [
    [T, 'interior', F, T], [T, 'interior', T, T],
    [T, 'exterior', F, F], [T, 'exterior', T, T],
    [T, 'kiosk', F, F], [T, 'kiosk', T, F],
    [F, 'interior', T, F], [F, 'exterior', T, F], [F, 'kiosk', T, F],
  ];
  for (const [webgpu, scene, prewarmOpen, expected] of table) {
    assert.equal(shouldMountInterior({ webgpu, scene, prewarmOpen }), expected, JSON.stringify({ webgpu, scene, prewarmOpen }));
  }
});
test('BORNE: App applique cette règle et ne garde plus de scène gelée', () => {
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.ok(app.includes('shouldMountInterior('), 'la règle de montage est la fonction testée');
  assert.ok(!app.includes('suspended='), 'plus de scène gelée derrière la borne');
  const scene = readText(path.join(ROOT, 'src/components/interior/InteriorScene.tsx'));
  assert.ok(!scene.includes('suspended'), 'InteriorScene n\'a plus de mode gelé');
});
test('BORNE: l\'appui sur la borne coupe les téléchargements 3D, le retour devant la devanture les relance', async () => {
  setGpu({});
  const gate = await import('../../src/utils/interior-preload-gate.ts?scenario=pause');
  const signals = []; let oneShot = 0; let later = 0;
  gate.whileStorefront((signal) => { signals.push(signal); });
  gate.afterStorefront(() => { oneShot++; });
  assert.equal(signals.length, 0, 'rien ne part avant la devanture');
  gate.releaseInteriorPreload();
  assert.equal(signals.length, 1);
  assert.equal(oneShot, 1);
  assert.equal(signals[0].aborted, false);

  gate.pauseInteriorPreload();                     // la borne s'ouvre
  assert.equal(signals[0].aborted, true, 'les téléchargements en cours sont interrompus');
  gate.afterStorefront(() => { later++; });
  gate.whileStorefront((signal) => { signals.push(signal); });
  assert.equal(later, 0, 'pendant la borne, rien ne part');
  assert.equal(signals.length, 1, 'pendant la borne, rien ne part');

  gate.releaseInteriorPreload();                   // la devanture est de nouveau affichée
  assert.equal(signals.length, 3, 'les téléchargements interruptibles repartent, avec un signal neuf');
  assert.equal(signals[1].aborted, false);
  assert.equal(later, 1, 'ce qui attendait la devanture part');
  assert.equal(oneShot, 1, 'une tâche unique ne repart pas');
  gate.releaseInteriorPreload();
  assert.equal(signals.length, 3, 'rouvrir une vanne ouverte ne relance rien');
});
test('BORNE: les préchargements 3D sont interruptibles et la borne les interrompt', () => {
  const preload = readText(path.join(ROOT, 'src/utils/asset-preload.ts'));
  assert.ok(preload.includes('whileStorefront('), 'asset-preload s\'inscrit comme téléchargement interruptible');
  assert.match(preload, /signal/, 'chaque fetch reçoit le signal d\'interruption');
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.ok(app.includes('pauseInteriorPreload('), 'App coupe les préchargements à l\'ouverture de la borne');
});
// Depuis le zoom vers la borne (18/11/2026), la devanture reste montée près d'une seconde après l'appui. Le minuteur
// de 0,8 s qui monte la scène 3D derrière elle pouvait donc tomber PENDANT le zoom, et monter la scène que l'appui
// venait de libérer : il consulte la vanne, refermée dès l'appui.
test('BORNE: pendant le zoom vers la borne, la scène 3D ne se monte pas', async () => {
  setGpu({});
  const gate = await import('../../src/utils/interior-preload-gate.ts?scenario=zoom');
  assert.equal(gate.isInteriorPreloadOpen(), false, 'vanne fermée avant la devanture');
  gate.releaseInteriorPreload();
  assert.equal(gate.isInteriorPreloadOpen(), true, 'vanne ouverte devant la devanture');
  gate.pauseInteriorPreload();                     // appui sur la borne : le zoom commence
  assert.equal(gate.isInteriorPreloadOpen(), false, 'vanne refermée dès l\'appui');
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.match(app, /if \(isInteriorPreloadOpen\(\)\) setInteriorPrewarm\(true\)/, 'le minuteur du préchauffage consulte la vanne');
});
// Mesuré le 16/11/2026 sur le build de production, débit limité à 20 Mbit/s : l'écran de la borne
// mettait 14,3 s à s'afficher après l'appui (son code n'était demandé qu'à l'appui, derrière les
// fichiers 3D), sur un écran noir.
test('BORNE: pas d\'écran noir à l\'ouverture — code préchargé, repli aux couleurs de la borne, panne rattrapée', () => {
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.ok(app.includes('preloadKiosk'), 'le code de la borne est demandé dès que la devanture est affichée');
  assert.ok(!/<Suspense fallback=\{null\}>\s*<KioskView/.test(app), 'le Suspense de la borne a un repli visible');
  assert.ok(app.includes('KioskBoundary'), 'un chargement en échec ne fait pas tomber l\'application');
  const exterior = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  assert.ok(exterior.includes('onShown'), 'la devanture signale qu\'elle est affichée');
});
// Mesuré le 18/11/2026 sur le build de production : même avec son code déjà chargé, la borne montée par React.lazy
// passait par le repli « Ouverture de la borne… » pendant 320 ms (React ne remplace pas avant ~300 ms un repli qu'il
// vient d'afficher) — un carton de texte entre la fin du zoom et l'écran de la borne.
test('BORNE: son code déjà chargé, elle s\'ouvre sans passer par le repli', () => {
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.match(app, /KioskViewLoaded = m\.KioskView/, 'le code préchargé est gardé');
  assert.match(app, /useState\(\(\) => KioskViewLoaded \?\? KioskViewLazy\)/, 'le composant est choisi une fois, au montage de la borne');
  assert.match(app, /<Suspense fallback=\{<KioskOpening \/>\}>\s*<KioskMount \/>/, 'le repli reste là pour un code pas encore arrivé');
});
test('BORNE: pendant la transition de la porte, le bouton de la borne ne répond plus', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  const start = src.indexOf('const openKiosk = ');
  assert.ok(start > 0, 'openKiosk introuvable dans ExteriorView');
  assert.match(src.slice(start, start + 260), /isTransitioning/, 'un appui pendant la transition est ignoré');
  assert.ok(!/onClick=\{onOpenKiosk\}/.test(src), 'le bouton ne court-circuite pas cette garde');
});
test('BORNE: une seule garde du geste retour, qui ne quitte jamais la borne', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(src.includes('kioskBackAction('), 'le geste retour suit la table testée');
  assert.equal((src.match(/useBackGuard\(/g) || []).length, 1, 'une seule garde pour toute la borne');
  assert.ok(!/useBackGuard\([^)]*quit/.test(src), 'le geste retour ne quitte pas la borne');
  assert.match(src, /inert=\{[^}]*isPlayerOpen/, 'la borne est inerte sous le lecteur');
});
test('BORNE: la borne lance elle-même le chargement du catalogue quand il manque', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(src, /catalogState\(total, [^)]*loadFailed\)/, 'un chargement en échec est dit tout de suite');
});
test('BORNE: en paysage sur téléphone, la borne laisse la place à une invitation à redresser l\'appareil', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(src.includes('hidesKioskInLandscape('), 'la décision est la fonction testée');
  assert.ok(src.includes('KioskRotate'), 'l\'invitation est affichée à la place de la borne');
});

// ===== Audit d'ergonomie sur téléphone du 17/11/2026 =====
test('BORNE: tirer vers le bas ne recharge pas la page tant que la borne est ouverte', () => {
  // Chrome sur Android recharge la page quand on tire vers le bas en haut de page — une page
  // rechargée a quitté la borne, ce que seul « Quitter » doit faire.
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(src, /overscrollBehaviorY\s*=\s*'none'/, 'html et body : overscroll-behavior-y à none pendant la borne');
});
test('BORNE: deux appuis rapprochés ne zooment pas, l\'appui long n\'ouvre pas le menu du navigateur', () => {
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'));
  const start = css.indexOf('.root {');
  const root = css.slice(start, css.indexOf('}', start));
  assert.match(root, /touch-action:\s*manipulation/, 'double-tap sans zoom, pincement conservé');
  assert.match(root, /-webkit-touch-callout:\s*none/, 'pas de menu de l\'image sur iOS');
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(src.includes('onContextMenu'), 'menu contextuel du navigateur coupé sur la borne');
});
test('BORNE: les flèches de la bande suivent ses extrémités', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(src.includes('railEdges('), 'KioskBrowse consulte railEdges');
});

test('BORNE: « LOUER » ne loue jamais en un seul appui', () => {
  // Décision de Rusmir du 17/11/2026 : un doigt qui glisse ne doit pas dépenser de crédits, y
  // compris quand la location reprend juste après une connexion demandée par « LOUER ».
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  const press = src.slice(src.indexOf('const press = async'), src.indexOf('return (', src.indexOf('const press = async')));
  assert.ok(press.includes('confirmRentText('), 'l\'appui ouvre la confirmation');
  assert.ok(!press.includes('rentFlow('), 'l\'appui ne lance pas la location lui-même');
  assert.match(src, /const rentNow = async[\s\S]*?rentFlow\(/, 'la location part de rentNow, appelé par la confirmation');
});

test('BORNE: sous LOUER, seulement la bande de jaquettes (Rusmir, 17/11/2026)', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(!src.includes('kChip') && !src.includes('de A à Z'), 'plus de boutons de tri');
  assert.ok(!src.includes('kStripH'), 'plus d\'intitulé de rayon au-dessus de la bande');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('phoneLayout('), 'la mise en page du téléphone vient de phoneLayout');
});

test('FICHE: la jaquette ouvre la fiche détaillée, le geste retour la ferme', () => {
  const browse = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(browse.includes('onOpenDetail'), 'la jaquette de la fiche ouvre la fiche détaillée');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('detailOpen') && view.includes("'close-detail'"), 'le geste retour connaît la fiche');
  const detail = readText(path.join(ROOT, 'src/components/kiosk/KioskDetail.tsx'));
  // Aucun lecteur tiers dans la borne : YouTube peut y diffuser des publicités, le club n'en montre
  // aucune (Rusmir, 17/11/2026 : « hors de question de faire ça aux utilisateurs »).
  for (const file of walkFiles(path.join(ROOT, 'src/components/kiosk'))) {
    const text = readText(file);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // commentaires seulement, pas les adresses
    assert.ok(!/<iframe|youtube|youtu\.be|dailymotion/i.test(code), path.basename(file) + ' : pas de lecteur vidéo tiers');
  }
  assert.ok(detail.includes('DETAIL_TABS'), 'les rubriques viennent de DETAIL_TABS');
});

test('FICHE: la bande-annonce est jouée par le lecteur de la borne, depuis notre serveur', () => {
  const detail = readText(path.join(ROOT, 'src/components/kiosk/KioskDetail.tsx'));
  assert.ok(/<video[\s\S]*?\/api\/films\/\$\{[^}]+\}\/trailer/.test(detail), 'un <video> qui lit /api/films/<tmdbId>/trailer');
  assert.ok(detail.includes('getTrailerStatus'), 'la fiche demande où en est la bande-annonce (et lance sa récupération)');
});

test('BORNE: un bouton « (i) Fiche film » à côté du titre ouvre la fiche ; plus de bandeau sur la jaquette', () => {
  // « le bouton fiche du film sur la jaquette n'est pas suffisamment explicite […] placé à côté du
  // titre avec un petit bouton de type (i) fiche film » (Rusmir, 17/11/2026).
  const browse = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(/kInfoMark[\s\S]*?<\/span>\s*Fiche\s*<\/button>/.test(browse), 'le bouton « (i) Fiche » (Rusmir : « change fiche film par fiche »)');
  assert.ok(!browse.includes('kPosterCue'), 'plus de bandeau sur la jaquette');
});

test('DALLE: allumage, rémanence, cadence de 25 i/s et angle de vue sont branchés', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('kWarm') && view.includes('onAnimationEnd'), 'l\'allumage du rétroéclairage, retiré une fois joué');
  assert.ok(view.includes('deviceorientation') && view.includes('viewingAngle('), 'l\'angle de vue suit l\'inclinaison');
  assert.ok(view.includes('prefers-reduced-motion'), 'rien ne bouge pour qui a demandé moins de mouvement');
  const browse = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(browse.includes('steppedScroll(') && !browse.includes("behavior: smooth ? 'smooth'"), 'les flèches tournent la bande à 25 i/s, pas en défilement fluide');
  assert.ok(browse.includes('kRise'), 'rémanence au changement de film');
});

// ===== Distribution de la K7, livraison 1 (spec 2026-11-17) =====
test('DISTRIBUTION: la location réussie mène au panneau « prête », pas au message d\'avant', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  assert.ok(!src.includes('Location enregistrée'), 'l\'ancien message disparaît');
  const rentNow = src.slice(src.indexOf('const rentNow'), src.indexOf('const press'));
  assert.ok(rentNow.indexOf('onRenting(film.id)') !== -1 && rentNow.indexOf('onRenting(film.id)') < rentNow.indexOf('rentFlow('), 'l\'attente s\'affiche avant l\'appel');
  assert.ok(rentNow.indexOf('onRenting(null)') !== -1 && rentNow.indexOf('onRenting(null)') < rentNow.indexOf("status === 'error'"), 'l\'attente se retire avant toute erreur');
  assert.ok(rentNow.lastIndexOf('onRented(film.id)') > rentNow.indexOf("status === 'error'"), 'le panneau seulement après le cas d\'erreur');
});
test('DISTRIBUTION: pendant l\'attente la barre du haut est inerte et le panneau précharge le Cast', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /className=\{styles\.kTop\} inert=\{[^}]*distribution/, 'barre du haut inerte pendant la distribution');
  // « Sur ma télé » demande le Cast elle-même depuis la tâche 7 de la refonte du Cast (voir plus bas).
  assert.ok(view.includes('castFilm('), '« Sur ma télé »');
  const dist = readText(path.join(ROOT, 'src/components/kiosk/KioskDistribution.tsx'));
  for (const copy of ['Veuillez patienter', 'Votre K7 est prête', 'Où voulez-vous regarder ?', 'Sur ma télé', 'le film démarre ici', 'Mon compte']) {
    assert.ok(dist.includes(copy), copy);
  }
  assert.ok(dist.includes('startCast'), 'service du Cast démarré (SDK chargé) à l\'affichage du panneau');
  assert.ok(!/\bdisabled\b/.test(dist), 'aucun bouton grisé');
});
test('DISTRIBUTION: le panneau « prête » ne bloque jamais la borne', () => {
  const dist = readText(path.join(ROOT, 'src/components/kiosk/KioskDistribution.tsx'));
  assert.ok(dist.includes('Plus tard'), 'une sortie sans rien lancer');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(!/if \(!film\) return null/.test(view), 'un film absent du catalogue ne doit pas laisser une distribution invisible');
  assert.ok(view.includes("'Titre indisponible'"), 'titre de repli');
});
test('COMPTE: « Compte » ouvre l\'écran « Mon compte » à tout moment, sans avoir à louer', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAccount.tsx'));
  for (const copy of ['Mon compte', 'En cours', 'Historique', 'Se déconnecter', 'Écrire ma critique', '+1 crédit', 'Aucune location', 'Retour']) {
    assert.ok(src.includes(copy), copy);
  }
  assert.ok(src.includes('rentalRows(') && src.includes('accountHistoryRows(') && src.includes('reviewStateFor('), 'lignes tirées de la logique testée');
  assert.ok(src.includes('fetchMe'), 'données relues à l\'ouverture');
  assert.ok(!/\bdisabled\b/.test(src), 'aucun bouton grisé');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('<KioskAccount'), 'monté par la borne');
  assert.ok(!view.includes("title: 'Compte'"), 'plus de petit message « Compte »');
  assert.ok(!existsSync(path.join(ROOT, 'src/components/kiosk/KioskRentals.tsx')), '« Mes locations » est absorbé');
});
// Revue finale : l'appel au serveur n'a aucun délai maximal ; pendant l'attente « Quitter » est inerte
// et le geste retour ne fait rien. Un serveur muet ne doit pas enfermer le visiteur.
test('DISTRIBUTION: « Veuillez patienter » rend la main au bout de 30 s avec une sortie', async () => {
  const K = await import('../../src/components/kiosk/kiosk-logic.ts');
  assert.equal(K.KIOSK_RENT_TIMEOUT_MS, 30_000);
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  const guard = view.slice(view.indexOf('KIOSK_RENT_TIMEOUT_MS)'), view.indexOf('KIOSK_RENT_TIMEOUT_MS)') + 1);
  assert.ok(guard, 'un minuteur de garde sur la phase d\'attente');
  const notice = view.slice(view.indexOf('La borne ne répond pas'), view.indexOf('La borne ne répond pas') + 700);
  assert.ok(notice.includes('Mon compte') && notice.includes("setScene('exterior')"), 'le message mène à « Mon compte » et à « Quitter »');
});

// ===== « Mon compte » (spec 2026-11-17-borne-mon-compte) =====
test('COMPTE: /api/me dit ce qu\'on peut encore critiquer, et le magasin garde l\'historique complet', () => {
  const route = readText(path.join(ROOT, 'app/api/me/route.ts'));
  assert.ok(route.includes('getReviewEligibilityForUser(') && route.includes('reviewEligibility'), 'route');
  const store = readText(path.join(ROOT, 'src/store/index.ts'));
  const start = store.indexOf('fetchMe: async');
  const fetchMe = store.slice(start, store.indexOf('// User local (fallback)', start));
  // L'historique est lu par une seule fonction, que fetchMe et refreshRentals (relecture du Cast) partagent.
  const historyStart = store.indexOf('function historyFromApi(');
  assert.ok(historyStart > 0 && fetchMe.includes('rentalHistory: historyFromApi(data.rentalHistory)'), 'fetchMe lit l\'historique par historyFromApi');
  const history = store.slice(historyStart, store.indexOf('\n}\n', historyStart));
  assert.ok(fetchMe.includes('reviewEligibility'), 'fetchMe pose reviewEligibility');
  for (const k of ['rewindClaimed', 'returnedEarly', 'returnDate', 'expiredDate', 'watchProgress', 'expiresAt']) {
    assert.ok(history.includes(k), `l'historique pose ${k}`);
  }
  const catchBlock = fetchMe.slice(fetchMe.indexOf('catch'));
  assert.ok(catchBlock.includes('reviewEligibility: {}'), 'remis à zéro hors connexion');
  assert.ok(history.includes('returnedAt:'), 'le champ existant returnedAt est gardé (terminal, Michel)');
});
test('CRITIQUE (borne): le formulaire publie ou modifie, jamais grisé, et relit le compte', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskReview.tsx'));
  assert.ok(src.includes('REVIEW_MIN_LENGTH') && src.includes('REVIEW_RATING_LABELS'), 'règles partagées');
  assert.ok(src.includes('api.reviews.create(') && src.includes('api.reviews.update('), 'création ou modification');
  assert.ok(src.includes('reviewFormCheck('), 'ce qui manque vient de la logique testée');
  assert.match(src, /existing \? null : .*\+1 crédit|!existing && .*\+1 crédit/s, '« +1 crédit » seulement pour une création');
  assert.ok(src.includes('fetchMe'), 'le compte est relu après publication');
  assert.ok(!/\bdisabled\b/.test(src), 'aucun bouton grisé');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('<KioskReview'), 'monté par la borne');
});
test('PANNEAU: deux pictogrammes dessinés, et plus de « Mes locations » ni de « Sur la TV »', () => {
  const dist = readText(path.join(ROOT, 'src/components/kiosk/KioskDistribution.tsx'));
  assert.ok((dist.match(/<svg/g) || []).length >= 2, 'pictogrammes en SVG');
  assert.ok(!dist.includes('Mes locations') && !dist.includes('Sur la TV'), 'anciens libellés');
  // Le « comment » de la télé passe par tvChoiceLine depuis le correctif 1 de la refonte du Cast (« via … » ou
  // « remplace … sur … ») ; tvChoiceLine reprend tvMeansLabel (tests/domain/kiosk-logic.test.mjs).
  assert.ok(dist.includes('watchHereLabel(') && dist.includes('tvChoiceLine('), 'libellés tirés de la logique testée');
});
// Relecture finale : une critique publiée doit pouvoir se modifier depuis « Mon compte » (spec § 5), et « Compte »
// appuyé pendant la recherche ne doit pas ouvrir le compte sous elle.
test('COMPTE: une critique publiée se modifie depuis « Mon compte », sans « +1 crédit »', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAccount.tsx'));
  const pub = src.slice(src.indexOf("state.kind === 'publiée'"), src.indexOf("state.kind === 'possible'"));
  assert.ok(pub.includes('Modifier ma critique') && pub.includes('onClick={onWrite}'), 'bouton « Modifier ma critique »');
  assert.ok(!pub.includes('+1 crédit'), 'pas de crédit pour une modification');
});
test('COMPTE: « Compte » pendant la recherche ferme la recherche avant d\'ouvrir le compte', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  const fn = view.slice(view.indexOf('const openAccount'), view.indexOf('const openAccount') + 700);
  assert.ok(/closeSearch\(\)|setMode\('browse'\)/.test(fn), 'la recherche se ferme');
});

// ===== Refonte du Cast, tâche 7 (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.4, § 5.5 point 6) =====
const KIOSK = (name) => readText(path.join(ROOT, 'src/components/kiosk', name));
/** Le corps d'une fonction `const name = …` du composant (indentée de deux espaces), jusqu'à son accolade fermante. */
function arrowBody(src, name) {
  // En début de ligne, à deux espaces : un `const watch` plus profond (useScreenDensity en a un) n'est pas celui-là.
  const start = src.indexOf(`\n  const ${name} = `) + 1;
  assert.ok(start > 0, `${name} introuvable`);
  const end = src.slice(start).search(/\n {2}\}[,;)]/);
  assert.ok(end > 0, `fin de ${name} introuvable`);
  return src.slice(start, start + end);
}

test('CAST BORNE: chaque reprise de film passe par « Où voulez-vous regarder ? », la TV qui a déjà le film exceptée', () => {
  const action = KIOSK('KioskAction.tsx');
  assert.ok(!action.includes('openPlayer('), 'KioskAction n\'ouvre plus le lecteur lui-même');
  assert.ok(/if \(now === 'watch'\) \{\s*onWatch\(film\.id\);/.test(action), '« REGARDER » passe la main à la borne');
  const view = KIOSK('KioskView.tsx');
  assert.ok(!view.includes('openPlayerOnTv'), 'plus d\'openPlayerOnTv');
  assert.ok(view.includes('fresh: false'), 'le panneau d\'un film déjà loué');
  const watch = arrowBody(view, 'watch');
  assert.ok(/watchEntry\(\{\s*view:\s*castView\(useStore\.getState\(\)\.cast,\s*filmId\)\s*\}\)/.test(watch), 'la décision est la fonction testée, sur la vue de CE film, lue au moment de l\'appui');
  assert.ok(watch.includes("setDistribution({ phase: 'ready', filmId, fresh: false })"), 'sinon le panneau, sans « Votre K7 est prête »');
  // Les trois entrées : la fiche du parcours, la fiche détaillée, « Mon compte ».
  assert.equal((view.match(/<KioskAction [^>]*onWatch=\{watch\}/g) || []).length, 2, 'les deux boutons d\'action');
  assert.match(view, /<KioskAccount[\s\S]*?onWatch=\{watch\}/, '« Regarder » de « Mon compte »');
  // Toute ouverture du lecteur par la borne dit d'où elle vient (« ← Retour à la borne »).
  const opens = view.match(/openPlayer\([^)]*\)/g) || [];
  assert.ok(opens.length >= 4, `ouvertures relevées : ${opens.length}`);
  for (const call of opens) assert.ok(call.includes("from: 'kiosk'"), `${call} : depuis la borne`);
  // « Sur ce téléphone » : le panneau a déjà demandé, le lecteur ne redemande pas.
  assert.ok(arrowBody(view, 'watchHere').includes("openPlayer(filmId, { from: 'kiosk', ask: false })"), '« Sur ce téléphone » sans invite');
});

test('CAST BORNE: « Sur ma télé » — le Cast part dans l\'appui, jamais sur la branche AirPlay', () => {
  const view = KIOSK('KioskView.tsx');
  const fn = arrowBody(view, 'watchOnTv');
  // Aucune attente : le sélecteur d'appareils exige l'activation de l'appui.
  assert.ok(!/\bawait\b|\basync\b|\.then\(|setTimeout|requestAnimationFrame/.test(fn), 'aucune attente dans le gestionnaire');
  const branchStart = fn.indexOf("if (entry === 'airplay') {");
  assert.ok(branchStart >= 0, 'une branche AirPlay');
  const branchEnd = fn.indexOf('return;', branchStart);
  const airplay = fn.slice(branchStart, branchEnd);
  assert.ok(airplay.includes("openPlayer(filmId, { from: 'kiosk', ask: true })"), 'AirPlay : le lecteur s\'ouvre avec son invite, qui porte AirPlay');
  assert.ok(!airplay.includes('castFilm('), 'AirPlay : jamais le Cast de Google');
  const cast = fn.slice(branchEnd);
  // Versions, tâche 7 : le Cast part dans la version décidée par le panneau (spec 2026-11-19, § 4.4).
  const castAt = cast.indexOf('castFilm(filmId, { version })');
  const openAt = cast.indexOf("openPlayer(filmId, { from: 'kiosk', ask: false })");
  assert.ok(castAt >= 0 && openAt > castAt, 'ailleurs : castFilm(filmId, { version }) puis openPlayer(…, ask: false)');
  // Un seul appel au Cast dans toute la borne : celui-là, après la sortie de la branche AirPlay.
  assert.equal((view.match(/castFilm\(/g) || []).length, 1, 'un seul castFilm( dans KioskView');
  assert.ok(view.indexOf('castFilm(') > view.indexOf("if (entry === 'airplay') {"), 'castFilm vient après la branche AirPlay');
  for (const file of walkFiles(path.join(ROOT, 'src/components/kiosk'))) {
    if (file.endsWith('KioskView.tsx')) continue;
    assert.ok(!readText(file).includes('castFilm('), `${path.basename(file)} : pas de Cast hors du gestionnaire de la borne`);
  }
  // Versions, tâche 7 : le choix du panneau passe d'abord par la décision de version (question des sous-titres), qui
  // mène à watchOnTv (tests « PANNEAU VERSION » plus bas).
  assert.match(view, /onTv=\{\(entry\) => launchFromReady\(filmId, entry\)\}/, 'le panneau passe son choix à launchFromReady');
  // Le choix AirPlay / Cast est la fonction testée, sur la détection lue sur l'élément vidéo.
  const dist = KIOSK('KioskDistribution.tsx');
  assert.ok(dist.includes('tvEntry(') && dist.includes('appleAirPlay('), 'KioskReady choisit par tvEntry(appleAirPlay(…))');
});

test('CAST BORNE: le panneau d\'un film déjà loué demande « Où voulez-vous regarder ? » en titre, sans doublon', () => {
  const dist = KIOSK('KioskDistribution.tsx');
  assert.ok(/fresh \? 'Votre K7 est prête' : 'Où voulez-vous regarder \?'/.test(dist), 'titre selon `fresh`');
  assert.match(dist, /\{fresh && <p className=\{styles\.kReadyQuestion\}>Où voulez-vous regarder \?<\/p>\}/, 'la ligne de question, seulement après une location');
  assert.ok(!/\bdisabled\b/.test(dist), 'aucun bouton grisé');
  const view = KIOSK('KioskView.tsx');
  assert.ok(view.includes('fresh={fresh}'), 'KioskView transmet `fresh`');
  assert.ok(view.includes("setDistribution({ phase: playing ? 'film' : 'ready', filmId, fresh: true })") && view.includes("{ phase: 'ready', filmId: d.filmId, fresh: true }"), 'après une location : « Votre K7 est prête »');
});

test('CAST BORNE: la barre du Cast est dessinée par la borne, dans son écran, au-dessus de la bande', () => {
  const bar = KIOSK('KioskCastBar.tsx');
  for (const name of ['castChipLabel(', 'castChipLook(', 'kioskLabelCase(']) assert.ok(bar.includes(name), name);
  assert.ok(bar.includes("openPlayer(filmId, { from: 'kiosk', ask: false })"), 'l\'appui rouvre le lecteur depuis la borne, sans invite');
  assert.ok(!/position:\s*['"]?fixed/.test(bar) && !/style=\{\{/.test(bar), 'ni position fixe ni style en ligne : la feuille de la borne');
  assert.ok(!/\p{Extended_Pictographic}/u.test(bar), 'aucun emoji');
  // Sa feuille à elle (correctif 1) : KioskBrowse.module.css approchait du budget de 1000 lignes.
  assert.ok(bar.includes("from './KioskCastBar.module.css'"), 'styles dans la feuille de la barre');
  assert.ok(!readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.module.css')).includes('.kCast'), 'plus rien de la barre dans la feuille du parcours');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskCastBar.module.css'));
  const rule = css.slice(css.indexOf('.kCastBar {'), css.indexOf('}', css.indexOf('.kCastBar {')));
  assert.ok(css.includes('.kCastBar {') && rule.length > 0, '.kCastBar est dans KioskCastBar.module.css');
  for (const name of new Set([...bar.matchAll(/styles\.(\w+)/g)].map((m) => m[1]))) assert.ok(new RegExp(`\\.${name}\\b`).test(css), `.${name} manque dans KioskCastBar.module.css`);
  // Un lecteur d'écran entend ce que fait l'appui (castBarLabel, testée), pas « Dune Télécommande ».
  assert.match(bar, /aria-label=\{castBarLabel\(phase, title\) \?\? undefined\}/, 'nom accessible par état');
  assert.ok(/position:\s*absolute/.test(rule) && /top:\s*var\(--k-cast-top/.test(rule) && /height:\s*var\(--k-cast-h/.test(rule), 'la barre prend la place que phoneLayout lui réserve');
  assert.ok(/var\(--k-skin-teal\)/.test(rule) && /var\(--k-edge-teal\)/.test(rule), 'l\'aplat et le filet des boutons de la borne');
  assert.ok(/\.screen\[data-cast-bar\][\s\S]*?--k-strip-top/.test(readText(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'))), 'l\'écran 2:3 du PC lui fait aussi sa place');
  const view = KIOSK('KioskView.tsx');
  const pane = view.slice(view.indexOf('className={styles.kPane}'), view.indexOf('{detailOpen && catalog'));
  assert.ok(pane.includes('<KioskCastBar'), 'dans le volet du parcours, avec la bande');
  // Montrée exactement quand la machine désigne un film (la TV le joue, ne répond plus, ou vient de le finir) et que le
  // lecteur est fermé ; le titre vient du catalogue de la borne.
  assert.ok(view.includes('useStore((state) => castOwnsFilm(state.cast))'), 'le film vient de la machine');
  assert.ok(/const castBarFilm = isPlayerOpen \? null : castFilmId;/.test(view), 'lecteur fermé seulement');
  assert.ok(/\{castBarFilm !== null && \(\s*<KioskCastBar filmId=\{castBarFilm\}/.test(view), 'rendue sur cette seule condition');
  assert.ok(view.includes("'Film en cours'"), 'titre de repli');
  assert.ok(view.includes('usePhoneLayoutVars(screenRef, castBarFilm !== null)') && view.includes('data-cast-bar='), 'sa place est réservée dans l\'écran');
  // La puce flottante reste au vidéoclub 3D, seule.
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  const kiosk = app.slice(app.indexOf('{isKiosk && ('), app.indexOf('{isInterior && ('));
  assert.ok(kiosk.length > 0 && !kiosk.includes('ActiveCastIndicator'), 'la borne ne monte plus la puce flottante');
  assert.equal((app.match(/<ActiveCastIndicator \/>/g) || []).length, 1, 'le vidéoclub la garde');
  assert.ok(!readText(path.join(ROOT, 'src/components/player/ActiveCastIndicator.tsx')).includes('variant'), 'plus de variante « kiosk »');
});

test('CAST BORNE: la TV joue un autre film — « Sur ma télé » dit qu\'il le remplacera, sans second appui (correctif 1)', () => {
  const dist = KIOSK('KioskDistribution.tsx');
  // La vue de CE film, lue en continu tant que le panneau est ouvert (sélecteurs du magasin, pas une lecture unique).
  assert.match(dist, /useStore\(\(state\) => \(castView\(state\.cast, filmId\) === 'other-on-tv' \? state\.cast\.filmId : null\)\)/, 'le film qui occupe la TV, d\'après castView');
  assert.ok(dist.includes('castDeviceLabel(state.cast.deviceName)'), 'le nom de la télé, « la télé » s\'il est inconnu');
  assert.ok(dist.includes('allFilms(state.films)'), 'le titre vient du catalogue de la borne');
  assert.ok(/tvChoiceLine\(\{/.test(dist) && dist.includes('<small>{tvLine}</small>'), 'la seconde ligne du bouton est celle de tvChoiceLine');
  // Toujours un seul appui : le bouton ne change pas de gestionnaire (la confirmation en deux temps perdrait l'activation).
  assert.ok(dist.includes('onClick={() => onTv(labels.entry)}'), 'même gestionnaire, rien de plus');
  const view = KIOSK('KioskView.tsx');
  assert.match(view, /<KioskReady\s+filmId=\{filmId\}/, 'le panneau sait de quel film il parle');
});

test('CAST BORNE: « Location terminée » est dit par la borne, et le fermer efface le message du Cast', () => {
  const view = KIOSK('KioskView.tsx');
  assert.ok(view.includes("castNotice?.code === 'rental_over'"), 'le message du service');
  assert.ok(view.includes("title: 'Location terminée'"), 'texte exact');
  assert.ok(view.includes('rentalOverStep('), 'la décision est la fonction testée');
  assert.match(view, /title: 'Location terminée'[\s\S]{0,200}onPress: castDismiss/, '« Fermer » appelle castDismiss');
  assert.match(view, /action === 'close-notice'[\s\S]{0,80}castDismiss\(\)/, 'le geste retour aussi');
  assert.match(view, /rentalStep === 'close-player'\) closePlayer\(\)/, 'un lecteur resté ouvert sans location se ferme');
});

// ===== Versions, tâche 6 (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.2, § 4.3) =====
// La liste des versions est la même partout ; « Mon compte » l'ouvre depuis la ligne « Version préférée ».
const VERSION_LIST = path.join(ROOT, 'src/components/version/VersionList.tsx');

test('VERSION PRÉFÉRÉE: « Mon compte » porte la ligne « Version préférée », qui ouvre la liste partagée', () => {
  const src = KIOSK('KioskAccount.tsx');
  assert.ok(src.includes('Version préférée'), '« Version préférée »');
  assert.ok(src.includes("import { VersionList } from '../version/VersionList'"), 'la liste partagée, pas une copie');
  assert.match(src, /<VersionList[\s\S]*?title="Version préférée"/, 'la liste a pour titre « Version préférée »');
  assert.ok(src.includes('versionRows({ offer: FULL_OFFER, current: versionPref, expanded, withAuto: true })'), 'ses lignes : tout est offert, « Automatique » en tête');
  assert.ok(src.includes("versionPref === null ? 'Automatique' : versionName(versionPref)"), 'la valeur de la ligne');
  assert.ok(/prefOpen: boolean;/.test(src) && /onPrefOpen: \(open: boolean\) => void;/.test(src), 'la liste ouverte est tenue par la borne (geste retour)');
  // La ligne est sous le solde, hors de la zone qui défile.
  const who = src.indexOf('styles.kAccountWho');
  const line = src.indexOf('styles.kPrefLine');
  assert.ok(who > 0 && line > who && line < src.indexOf('styles.kSearchResults'), 'sous le solde, avant les locations');
});

test('VERSION PRÉFÉRÉE: un choix attend le oui du serveur — « Enregistré » 2 s, ou la liste reste avec le message', () => {
  const src = KIOSK('KioskAccount.tsx');
  const pick = arrowBody(src, 'pickPref');
  const saveAt = pick.indexOf('await setVersionPref(pref)');
  assert.ok(saveAt > 0, 'le choix part au serveur et on attend sa réponse');
  const closeAt = pick.indexOf('onPrefOpen(false)');
  assert.ok(closeAt > saveAt, 'la liste ne se ferme qu\'après la réponse');
  assert.match(pick.slice(saveAt), /if \(ok\) \{[^}]*setSavedTick[^}]*onPrefOpen\(false\)[^}]*\} else setFailed\(true\)/, 'oui → « Enregistré » et fermeture ; non → le message, la liste reste');
  assert.ok(src.includes('const PREF_SAVED_MS = 2000;') && src.includes('Enregistré'), '« Enregistré » pendant 2 s');
  assert.match(src, /setTimeout\(\(\) => setSavedTick\(0\), PREF_SAVED_MS\)/, '« Enregistré » s\'efface au bout de ce délai');
  assert.match(src, /role="alert">\s*L'enregistrement n'a pas abouti\. Réessayez\./, 'le message d\'échec, exact');
  assert.ok(src.includes('busy={saving}'), 'pendant l\'appel, la liste est en attente');
});

test('VERSION PRÉFÉRÉE: aucun bouton grisé, ni dans « Mon compte » ni dans la liste partagée', () => {
  for (const file of [path.join(ROOT, 'src/components/kiosk/KioskAccount.tsx'), VERSION_LIST]) {
    assert.ok(!/\bdisabled\b/.test(readText(file)), `${path.basename(file)} : aucun disabled`);
  }
});

test('VERSION PRÉFÉRÉE: la liste partagée n\'a pas de feuille de style à elle', () => {
  const src = readText(VERSION_LIST);
  assert.ok(!/\.css['"]/.test(src), 'aucune feuille importée : chaque écran passe ses classes');
  for (const key of ['list', 'title', 'row', 'rowSelected', 'absent', 'name', 'sub', 'more', 'back']) {
    assert.ok(src.includes(`classes.${key}`), `classes.${key} est utilisée`);
  }
});

test('VERSION PRÉFÉRÉE: la borne tient la liste ouverte et le geste retour la ferme avant le compte', () => {
  const view = KIOSK('KioskView.tsx');
  const back = view.slice(view.indexOf('const action = kioskBackAction({'), view.indexOf('});', view.indexOf('const action = kioskBackAction({')));
  assert.ok(/\bprefOpen\b/.test(back), 'kioskBackAction sait que la liste est ouverte');
  assert.match(view, /action === 'close-pref'\) setPrefOpen\(false\)/, '« close-pref » referme la liste, le compte reste');
  const account = view.slice(view.indexOf('<KioskAccount'), view.indexOf('/>', view.indexOf('<KioskAccount')));
  assert.ok(account.includes('prefOpen={prefOpen}') && account.includes('onPrefOpen={setPrefOpen}'), 'la borne passe l\'état de la liste à « Mon compte »');
});

// VersionList n'a ni état ni crochet : on la transpile (TypeScript, JSX classique sur le React du dépôt) et on l'appelle
// comme une fonction. L'arbre rendu se lit, et ses gestionnaires d'appui se déclenchent, sans navigateur.
async function loadVersionList() {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  globalThis.React = require('react');
  const { outputText } = ts.transpileModule(readText(VERSION_LIST), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}
/** Les éléments de l'arbre, dans l'ordre du document. */
function treeElements(node, out = []) {
  if (Array.isArray(node)) for (const child of node) treeElements(child, out);
  else if (node && typeof node === 'object' && 'props' in node) {
    out.push(node);
    treeElements(node.props.children, out);
  }
  return out;
}
/** Le texte d'un élément, enfants compris. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
const LIST_CLASSES = { list: 'L', title: 'T', row: 'R', rowSelected: 'RS', absent: 'A', name: 'N', sub: 'S', more: 'M', back: 'B' };
const partOf = (el, cls) => textOf(treeElements(el.props.children).find((e) => e.props.className === cls));
const noop = () => {};

test('LISTE DES VERSIONS: une ligne par entrée de versionRows — versions en boutons pressés, l\'absente en texte, « Retour » en pied', async () => {
  const VC = await import('../../src/utils/version-choice.ts');
  const { VersionList } = await loadVersionList();
  const rows = VC.versionRows({ offer: VC.FULL_OFFER, current: VC.VOSTFR, expanded: false, withAuto: true });
  const tree = VersionList({ title: 'Version préférée', rows, classes: LIST_CLASSES, onPick: noop, onMore: noop, onBack: noop });
  assert.equal(tree.props.className, 'L');
  assert.equal(tree.props['aria-busy'], undefined, 'pas en attente : pas d\'aria-busy');
  const all = treeElements(tree);
  assert.equal(textOf(all.find((e) => e.props.className === 'T')), 'Version préférée');
  const buttons = all.filter((e) => e.type === 'button');
  const versions = buttons.filter((b) => 'aria-pressed' in b.props);
  assert.deepEqual(versions.map((b) => partOf(b, 'N')), ['Automatique', 'VF', 'VOSTFR', 'VO']);
  assert.deepEqual(versions.map((b) => partOf(b, 'S')), ['VF quand elle existe, sinon VOSTFR', 'version française', 'version originale, sous-titres français', 'version originale, sans sous-titres']);
  assert.deepEqual(versions.map((b) => b.props['aria-pressed']), [false, false, true, false], 'la version courante est pressée');
  assert.deepEqual(versions.map((b) => b.props.className.split(' ')), [['R'], ['R'], ['R', 'RS'], ['R']], 'la classe de la ligne choisie, sur elle seule');
  const more = buttons.find((b) => b.props.className === 'M');
  assert.equal(textOf(more), 'Autres versions');
  assert.equal(buttons.at(-1).props.className, 'B');
  assert.equal(textOf(buttons.at(-1)), 'Retour', '« Retour » ferme la liste, en pied');

  // Un film sans VF : la VF est une ligne de texte avec sa raison, jamais un bouton ; sans « Automatique » demandée, pas de ligne auto.
  const film = VersionList({
    title: 'Version',
    rows: VC.versionRows({ offer: { vf: false, vo: true, fr: true, en: false }, current: null, expanded: false, withAuto: false }),
    classes: LIST_CLASSES, onPick: noop, onMore: noop, onBack: noop,
  });
  const filmAll = treeElements(film);
  const absent = filmAll.filter((e) => e.props.className === 'A');
  assert.equal(absent.length, 1);
  assert.equal(absent[0].type, 'p');
  assert.equal(textOf(absent[0]), 'VF · indisponible pour ce film');
  assert.deepEqual(filmAll.filter((e) => e.type === 'button' && 'aria-pressed' in e.props).map((b) => partOf(b, 'N')), ['VOSTFR', 'VO']);
});

test('LISTE DES VERSIONS: un appui choisit la version (« Automatique » = null), ouvre les autres versions ou revient', async () => {
  const VC = await import('../../src/utils/version-choice.ts');
  const { VersionList } = await loadVersionList();
  const picks = []; let more = 0; let back = 0;
  const tree = VersionList({
    title: 'Version préférée',
    rows: VC.versionRows({ offer: VC.FULL_OFFER, current: null, expanded: false, withAuto: true }),
    classes: LIST_CLASSES, onPick: (v) => picks.push(v), onMore: () => { more++; }, onBack: () => { back++; },
  });
  const buttons = treeElements(tree).filter((e) => e.type === 'button');
  const byName = (name) => buttons.find((b) => partOf(b, 'N') === name);
  byName('Automatique').props.onClick();
  byName('VOSTFR').props.onClick();
  assert.equal(picks.length, 2);
  assert.equal(picks[0], null, '« Automatique » efface la préférence');
  assert.equal(picks[1], VC.VOSTFR, 'le couple de la ligne, tel quel');
  buttons.find((b) => b.props.className === 'M').props.onClick();
  assert.equal(more, 1);
  buttons.find((b) => b.props.className === 'B').props.onClick();
  assert.equal(back, 1);
});

// Relecture d'ensemble de la partie A (point 12) : « Autres versions » avalait l'appui pendant l'enregistrement sans rien
// montrer, alors que déplier la liste n'envoie rien. Il répond désormais, comme « Retour » ; seuls les choix attendent.
test('LISTE DES VERSIONS: en attente, aria-busy et les appuis sur les versions ignorés ; « Autres versions » et « Retour » répondent', async () => {
  const VC = await import('../../src/utils/version-choice.ts');
  const { VersionList } = await loadVersionList();
  const picks = []; let more = 0; let back = 0;
  const tree = VersionList({
    title: 'Version préférée',
    rows: VC.versionRows({ offer: VC.FULL_OFFER, current: VC.VF, expanded: false, withAuto: true }),
    classes: LIST_CLASSES, busy: true, onPick: (v) => picks.push(v), onMore: () => { more++; }, onBack: () => { back++; },
  });
  assert.equal(tree.props['aria-busy'], true);
  const buttons = treeElements(tree).filter((e) => e.type === 'button');
  const versions = buttons.filter((b) => 'aria-pressed' in b.props);
  assert.equal(versions.length, 4);
  for (const b of versions) {
    assert.equal(b.props['aria-busy'], true, `${partOf(b, 'N')} : en attente`);
    b.props.onClick();
  }
  buttons.find((b) => b.props.className === 'M').props.onClick();
  assert.deepEqual(picks, [], 'aucun choix pendant l\'enregistrement');
  assert.equal(more, 1, '« Autres versions » déplie la liste : rien ne part au serveur');
  buttons.find((b) => b.props.className === 'B').props.onClick();
  assert.equal(back, 1, 'la liste n\'enferme jamais le visiteur');
});

// ===== Versions, tâche 7 (spec 2026-11-19, § 4.1, 4.3 a et 4.4) : la ligne « Version » du panneau, la question des
// sous-titres, et le lancement qui part de la même décision que tout le reste =====
/** Le corps du composant KioskReady, jusqu'à la fin du fichier. */
const readySrc = () => {
  const dist = KIOSK('KioskDistribution.tsx');
  return dist.slice(dist.indexOf('export function KioskReady'));
};

test('PANNEAU VERSION: la ligne « Version » est entre l\'échéance et les deux boutons, la note dessous', () => {
  const ready = readySrc();
  const until = ready.indexOf('readyUntilText(expiresAt)');
  const line = ready.indexOf('<span>Version</span>');
  const note = ready.indexOf('{version.note}');
  const here = ready.indexOf('{labels.here}');
  assert.ok(until > 0, 'échéance');
  assert.ok(line > until, 'la ligne vient après l\'échéance');
  assert.ok(note > line, 'la note de substitution s\'écrit sous la ligne');
  assert.ok(here > note, 'les deux boutons viennent après');
  assert.match(ready, /\{version\.note && <p className=\{styles\.kReadyVersionNote\}>\{version\.note\}<\/p>\}/, 'la note seulement quand il y en a une');
  assert.ok(ready.includes('{version.text}'), 'la valeur de la ligne vient de la logique (readyVersionRow)');
});

test('PANNEAU VERSION: la ligne s\'ouvre seulement quand le film a plusieurs versions — sinon du texte, sans chevron', () => {
  const ready = readySrc();
  const branch = ready.slice(ready.indexOf('{version.openable ? ('), ready.indexOf('{version.note &&'));
  const [openable, fixed] = branch.split(') : (');
  assert.ok(fixed !== undefined, 'deux branches');
  assert.match(openable, /<button type="button" className=\{`\$\{styles\.kPrefLine\} \$\{styles\.kReadyVersion\}`\} onClick=\{onOpenVersions\}>/, 'un bouton, avec le chevron de .kPrefLine, qui ouvre la liste');
  assert.ok(!fixed.includes('<button') && !fixed.includes('onClick'), 'film à un seul couple : pas un bouton');
  assert.ok(!fixed.includes('kPrefLine'), 'ni le cadre ni le chevron de .kPrefLine');
  assert.ok(fixed.includes('styles.kReadyVersionFixed'), 'une ligne de texte');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskPanels.module.css'));
  assert.ok(!/\.kReadyVersionFixed::after/.test(css), 'aucun chevron dessiné sur la ligne fixe');
});

test('PANNEAU VERSION: un appui sur la ligne remplace le contenu par la liste partagée, titrée « Version »', () => {
  const ready = readySrc();
  assert.ok(KIOSK('KioskDistribution.tsx').includes("import { VersionList } from '../version/VersionList'"), 'la liste partagée, pas une copie');
  assert.match(ready, /view === 'versions' \? \(\s*<VersionList\s+title="Version"\s+rows=\{rows\}/, 'la liste, ses lignes viennent de KioskView');
  const list = ready.slice(ready.indexOf('<VersionList'), ready.indexOf('/>', ready.indexOf('<VersionList')));
  for (const cls of ['list: styles.kVersionList', 'row: styles.kVersionRow', 'rowSelected: styles.kVersionRowOn', 'absent: styles.kVersionAbsent', 'more: styles.kVersionMore', 'back: `${styles.kAuthBack} ${styles.kVersionBack}`']) {
    assert.ok(list.includes(cls), `classes de la borne : ${cls}`);
  }
  assert.ok(list.includes('onMore={onMoreVersions}') && list.includes('onBack={onCloseSub}'), '« Autres versions » et « Retour »');
  assert.match(list, /onPick=\{\(v\) => \{\s*if \(v\) onPickVersion\(v\);\s*\}\}/, 'un appui choisit la version de ce film');
});

test('PANNEAU VERSION: la question remplace le contenu — titre, texte, et les deux réponses de la décision', () => {
  const ready = readySrc();
  const q = ready.slice(ready.indexOf("view === 'question' && question ? ("), ready.indexOf('/* Le panneau */'));
  assert.ok(q.length > 0, 'une branche « question »');
  assert.ok(q.includes('{question.title}') && q.includes('{question.body}'), 'titre et texte de la décision, tels quels');
  assert.match(q, /onClick=\{\(\) => onAnswer\(question\.keep\.version\)\}>\s*\{question\.keep\.label\}/, '« Continuer en … »');
  assert.match(q, /onClick=\{\(\) => onAnswer\(question\.other\.version\)\}>\s*\{question\.other\.label\}/, '« Passer en VF »');
  assert.ok(!/\bdisabled\b/.test(KIOSK('KioskDistribution.tsx')), 'aucun bouton grisé');
});

// Décision de Rusmir du 20/11/2026 : la question a une troisième ligne, plus discrète que les deux réponses, « Retour »,
// qui referme la question sans lancer le film ni rien retenir — le panneau « Votre K7 est prête » revient.
test('PANNEAU VERSION: « Retour » sous les deux réponses ramène au panneau, sans rien lancer ni retenir', () => {
  const ready = readySrc();
  const q = ready.slice(ready.indexOf("view === 'question' && question ? ("), ready.indexOf('/* Le panneau */'));
  const answers = q.indexOf('onAnswer(question.other.version)');
  const back = q.indexOf('Retour');
  assert.ok(answers > 0 && back > answers, '« Retour » après les deux réponses');
  // Le retour discret des panneaux de la borne, celui de la liste (zone d'appui de 44 px au moins), sur le rappel qui
  // ramène au panneau — le même que le geste retour : ni onAnswer, ni lancement.
  assert.match(q, /<button type="button" className=\{`\$\{styles\.kAuthBack\} \$\{styles\.kVersionBack\}`\} onClick=\{onCloseSub\}>\s*Retour\s*<\/button>/, '« Retour » = onCloseSub');
  const view = KIOSK('KioskView.tsx');
  assert.match(view, /onCloseSub=\{\(\) => setReadySub\(READY_PANEL\)\}/, 'onCloseSub ramène au panneau, rien d\'autre');
});

test('PANNEAU VERSION: KioskView calcule la ligne, la liste et la question à partir de la décision unique, hors sélecteur', () => {
  const view = KIOSK('KioskView.tsx');
  // versionDecisionFor rend un objet neuf à chaque appel : jamais en sélecteur du magasin (boucle de rendu).
  assert.ok(!/useStore\(\(state\) => [^)]*versionDecisionFor\(/.test(view), 'pas de sélecteur sur la décision');
  assert.match(view, /versionDecisionFor\(useStore\.getState\(\), readyFilmId\)/, 'la décision, lue sur l\'état du magasin');
  assert.ok(view.includes('readyVersionRow(readyOffer, readyDecision)'), 'la ligne vient de readyVersionRow (testée)');
  assert.ok(view.includes('versionRows({ offer: readyOffer, current: resolvedVersion(readyDecision), expanded: readySub.expanded, withAuto: false })'), 'la liste : versions du film, sans « Automatique »');
  const ready = view.slice(view.indexOf('<KioskReady'), view.indexOf('/>', view.indexOf('onCloseSub=')));
  for (const prop of ['version={', 'view={readySub.view}', 'rows={', 'question={', 'onOpenVersions=', 'onPickVersion=', 'onMoreVersions=', 'onAnswer=', 'onCloseSub=']) {
    assert.ok(ready.includes(prop), `KioskReady reçoit ${prop}`);
  }
  assert.match(ready, /onWatch=\{\(\) => launchFromReady\(filmId, 'here'\)\}/, '« Sur ce téléphone » passe par la décision');
});

test('PANNEAU VERSION: « Sur ce téléphone » / « Sur ma télé » — lancer, demander, ou dire qu\'aucune version n\'est lisible', () => {
  const view = KIOSK('KioskView.tsx');
  const fn = arrowBody(view, 'launchFromReady');
  assert.match(fn, /const decision = versionDecisionFor\(useStore\.getState\(\), filmId\);[\s\S]*readyLaunchStep\(decision, useStore\.getState\(\)\.getRental\(filmId\) !== undefined\)/, 'la décision et la location lues au moment de l\'appui, puis readyLaunchStep');
  // Location disparue (relecture d'ensemble de la partie A, m9) : le panneau se ferme, avant tout message de version.
  assert.match(fn, /if \(step === 'close'\) \{\s*closeReady\(\);\s*return;\s*\}/, 'location disparue : le panneau se ferme');
  assert.ok(fn.indexOf("step === 'close'") < fn.indexOf('NO_PLAYABLE_VERSION'), 'avant le refus « aucune version lisible »');
  assert.match(fn, /if \(step === 'ask'\) \{\s*setReadySub\(\{ view: 'question', target \}\);\s*return;/, 'la question remplace le panneau, la cible est retenue');
  assert.match(fn, /title: NO_PLAYABLE_VERSION/, 'refus : le message exact (kiosk-logic)');
  assert.ok(fn.includes('launch(filmId, target, version)'), 'sinon le lancement, dans la version décidée');
  assert.ok(!/\bawait\b|\basync\b|\.then\(|setTimeout|requestAnimationFrame/.test(fn), 'rien n\'attend : le sélecteur d\'appareils exige l\'activation de l\'appui');
  const launch = arrowBody(view, 'launch');
  assert.match(launch, /if \(target === 'here'\) watchHere\(filmId\);\s*else watchOnTv\(filmId, target, version\);/, 'ici, ou la télé avec la version');
});

test('PANNEAU VERSION: la réponse devient le choix de ce film et lance le film dans le même appui, sans toucher à la préférence', () => {
  const view = KIOSK('KioskView.tsx');
  const answer = arrowBody(view, 'answerQuestion');
  const choose = answer.indexOf('chooseFilmVersion(filmId, v)');
  const go = answer.indexOf('launch(filmId, target, v)');
  assert.ok(choose >= 0 && go > choose, 'chooseFilmVersion puis le lancement vers la cible retenue');
  assert.ok(!/\bawait\b|\basync\b|\.then\(|setTimeout|requestAnimationFrame/.test(answer), 'dans le gestionnaire de l\'appui, sans attente');
  assert.match(view, /onAnswer=\{\(v\) => \{\s*if \(readySub\.view === 'question'\) answerQuestion\(filmId, readySub\.target, v\);\s*\}\}/, 'la cible retenue à la question');
  assert.ok(!view.includes('setVersionPref'), 'la borne ne change jamais la version préférée hors de « Mon compte »');
  const pick = arrowBody(view, 'pickVersion');
  assert.ok(pick.indexOf('chooseFilmVersion(filmId, v)') >= 0 && pick.indexOf("setReadySub(READY_PANEL)") > pick.indexOf('chooseFilmVersion(filmId, v)'), 'un choix dans la liste : ce film, puis retour au panneau');
});

test('PANNEAU VERSION: le geste retour ferme la question ou la liste avant le panneau', () => {
  const view = KIOSK('KioskView.tsx');
  const back = view.slice(view.indexOf('const action = kioskBackAction({'), view.indexOf('});', view.indexOf('const action = kioskBackAction({')));
  assert.match(back, /questionOpen: readyOpen && readySub\.view === 'question'/, 'la question est ouverte');
  assert.match(back, /versionOpen: readyOpen && readySub\.view === 'versions'/, 'la liste est ouverte');
  assert.match(view, /else if \(action === 'close-question' \|\| action === 'close-version'\) setReadySub\(READY_PANEL\);/, 'retour au panneau, rien n\'est lancé');
  // Chaque ouverture du panneau repart de son contenu (ni liste ni question d'une ouverture précédente).
  assert.ok(view.includes("setDistribution({ phase: 'ready', filmId, fresh: false })") && view.includes("setDistribution({ phase: playing ? 'film' : 'ready', filmId, fresh: true })") && view.includes("{ phase: 'ready', filmId: d.filmId, fresh: true }"), 'les ouvertures ne portent pas de sous-vue');
});

// ===== Distribution de la K7, livraison 2 : la vidéo (spec 2026-11-17, § 12 ; plan 2026-11-22) =====
test('DISTRIBUTION FILMÉE: le crochet ne fait jamais attendre et retombe sur le muet si le son est refusé', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/useDistributionFilm.ts'));
  assert.ok(src.includes("'(prefers-reduced-motion: reduce)'"), 'rien ne bouge pour qui demande moins de mouvement');
  const start = src.slice(src.indexOf('const start'), src.indexOf('const skip'));
  assert.ok(start.includes('if (!video || !srcRef.current'), 'vidéo pas téléchargée : start rend false');
  // Constaté à l'écran le 22/11/2026 : le bouton « Louer » de la confirmation garde le onRented du rendu où la
  // confirmation s'est ouverte — la vidéo n'était pas encore téléchargée, et un start() qui lisait l'adresse de CE
  // rendu répondait toujours « pas prête » : la vidéo ne jouait jamais. L'adresse se lit donc au moment de l'appel.
  assert.match(src, /\}, \[durationMs, done, clearTimers\]\);\n\n  const skip/, 'start ne dépend pas de l\'adresse du rendu qui l\'a créé');
  const refus = start.slice(start.indexOf('.catch('));
  assert.ok(refus.includes('video.muted = true') && refus.includes('setMuted(true)'), 'son refusé : la vidéo repart muette et le dit');
  assert.ok(refus.lastIndexOf('done') > refus.indexOf('video.muted = true'), 'muet refusé aussi : on passe au panneau');
  const skip = src.slice(src.indexOf('const skip'));
  assert.ok(skip.includes('.pause()'), 'un appui coupe le son avec l\'image');
  assert.ok(!skip.includes('SKIP_AFTER'), 'pas de délai avant de pouvoir passer : l\'appui ne vient pas d\'ouvrir ce film');
  assert.ok(src.includes('URL.revokeObjectURL'), 'l\'adresse locale est libérée');
  assert.ok(src.includes('doneRef.current') && src.includes("phaseRef.current = 'idle'"), 'une seule fin par lancement, et la location suivante peut rejouer');
});
test('DISTRIBUTION FILMÉE: la vidéo s\'insère entre l\'attente et le panneau, et ne joue que si elle peut partir', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /phase: 'waiting' \| 'film' \| 'ready'/, 'une phase de plus');
  const rented = view.slice(view.indexOf('const onRented'), view.indexOf('const closeReady'));
  const rented2 = view.slice(view.indexOf('const onRented'), view.indexOf('const closeReady'));
  assert.ok(rented2.includes('distributionFilm.start()') && rented2.includes("'film'") && rented2.includes("'ready'"), 'start() décide : la vidéo, ou le panneau tout de suite');
  assert.ok(view.includes("action === 'skip-film'") && view.includes('distributionFilm.skip()'), 'le geste retour passe la vidéo');
  assert.ok(view.includes("filmPlaying: distribution?.phase === 'film'"), 'le geste retour sait que la vidéo joue');
  const horsEcran = view.slice(view.lastIndexOf('<KioskRotate'));
  assert.ok(horsEcran.length > 0);
  const action = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  const press = action.slice(action.indexOf('const press'));
  assert.ok(press.indexOf('onConfirmOpen?.(film.id)') !== -1 && press.indexOf('onConfirmOpen?.(film.id)') < press.indexOf("label: 'Louer'"), 'la vidéo se télécharge dès que la confirmation s\'ouvre');
  assert.ok(view.includes('onConfirmOpen={'), 'câblé dans la borne');
});
// La tranche suit la K7 pendant tout le trajet, et l'écran filmé est le vrai écran (spec § 13, plan 2026-11-23).
test('DISTRIBUTION FILMÉE: la tranche du film loué suit la K7, découpée par le cache et assombrie par l\'ombre de chaque image', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskDistributionFilm.tsx'));
  assert.ok(src.includes('useImperativeHandle') && src.includes('place('), 'les calques se placent par appel direct, image par image');
  assert.ok(src.includes('sheetPosition(') && src.includes('boxStyle(') && src.includes('spineSrc('), 'positions tirées de la logique testée');
  assert.ok(/maskPosition|WebkitMaskPosition/.test(src) && src.includes('backgroundPosition'), 'cache en masque, ombre en fond');
  assert.ok(!/useState<number>\(0\)|setTimeMs|timeMs/.test(src), 'aucun état React alimenté par image');
  assert.ok(src.includes('onError') && src.includes('fallbackSpineSrc('), 'tranche absente : repli avec le titre');
  assert.ok(src.includes('aria-label="Son coupé"'), 'le son refusé se signale');
  assert.ok(src.includes('onClick={') && src.includes('.skip'), 'un appui passe la vidéo');
  assert.ok(src.includes('playsInline') && !/\bautoPlay\b/.test(src), 'vidéo du site, lancée par le crochet');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskDistributionFilm.module.css'));
  assert.ok(css.includes('mask-image') && !/mix-blend-mode|[^-]filter\s*:/.test(css), 'un masque, mais ni mode de fusion ni filtre');
});
test('DISTRIBUTION FILMÉE: le crochet attend la vidéo, le suivi et les deux planches, et prévient à chaque image présentée', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/useDistributionFilm.ts'));
  const start = src.slice(src.indexOf('const start'), src.indexOf('const skip'));
  assert.ok(start.includes('!suiviRef.current') && start.includes('sheetsRef.current < 2'), 'sans suivi ou sans planches, pas de vidéo : jamais une K7 sans sa tranche');
  assert.ok(src.includes('frameAt(frame.mediaTime'), 'l\'image suivie est celle que la vidéo présente, pas l\'horloge');
  assert.ok(src.includes('onFrameRef.current('), 'la borne est prévenue à chaque image');
  assert.ok(!src.includes('setTimeMs'), 'plus d\'état par image');
});
test('DISTRIBUTION FILMÉE: l\'écran filmé est le vrai écran de la borne, remis exactement à sa place à la fin', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('stageFor(') && view.includes('screenTransform(') && view.includes('screenClip('), 'cadre calé sur le vrai écran, écran placé et rogné au cadre');
  assert.ok(view.includes("style.transform = ''") && view.includes("style.clipPath = ''"), 'aucune transformation ne reste après la vidéo');
  assert.ok(/addEventListener\('resize', [^)]*\)/.test(view) && view.includes('distributionFilm.skip'), 'fenêtre redimensionnée pendant la vidéo : on passe au panneau');
  assert.ok(view.indexOf('<KioskDistributionFilm') < view.indexOf('className={styles.sign}'), 'la vidéo est dans la borne, sous son écran et au-dessus du reste');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'));
  assert.ok(css.includes('.ksLifted'), 'l\'écran passe au-dessus de la vidéo le temps du film');
});
test('ACCUEIL: la borne s\'ouvre sur son écran d\'accueil, et un appui ouvre le catalogue', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(/const \[welcome, setWelcome\] = useState\(true\)/.test(view), 'à l\'ouverture, personne n\'a encore touché la borne');
  assert.ok(!view.includes("has('accueil')"), 'plus de paramètre d\'adresse de maquette');
  assert.ok(view.includes('<KioskWelcome') && view.includes('onEnter={() => setWelcome(false)}'), 'un appui ouvre le catalogue');
  assert.ok(/className=\{styles\.kTop\} inert=\{welcome \|\|/.test(view) && /inert=\{welcome \|\| overlay !== null \|\| distribution !== null \|\| authVisible \|\| mode === 'search'/.test(view), 'sous l\'accueil, la barre et le parcours ne reçoivent ni appui ni clavier');
  assert.ok(view.includes('hint={quitHint}'), 'le geste retour éclaire « Quitter » sur l\'accueil aussi');
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskWelcome.tsx'));
  assert.ok(src.includes('Club LaZone') && src.includes('Touchez l\'écran') && src.includes('pour louer une K7'), 'le nom du vidéoclub et l\'invitation');
  assert.ok(src.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'animations réduites : les jaquettes ne défilent pas');
  assert.ok(!src.includes('LAZONE.EXE') && !src.includes('ticker'), 'ni ligne de commande ni bandeau défilant (retirés par Rusmir le 23/11/2026)');
  assert.ok(!src.includes('yearOf') && !src.includes('release_date'), 'pas de date sous la jaquette (Rusmir, 23/11/2026)');
  assert.ok(readText(path.join(ROOT, 'lib/films.ts')).includes('is_nouveaute = 1 AND is_available = 1 ORDER BY created_at DESC, id DESC'), 'les nouveautés vont de la plus récemment arrivée à la plus ancienne');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskWelcome.module.css'));
  assert.ok(css.includes('radial-gradient(86% 47% at 58% 30%, var(--k-bg-stops))'), 'le même fond que l\'écran de la borne');
  assert.ok(css.includes('var(--k-skin-orange)') && css.includes('border-radius: var(--k-radius)') && !css.includes('welcome-pulse'), 'l\'invitation est un bouton de la borne, sans halo qui pulse');
  assert.ok(css.includes('"VT323"') && !/mix-blend-mode|backdrop-filter|[^-]filter\s*:/.test(css), 'police d\'ordinateur des années 90 ; ni filtre ni mode de fusion');
});
test('BORNE: changer de rayon affiche le premier film de ce rayon', () => {
  // Rusmir, 23/11/2026 : « un changement de catégorie via le bouton sur le côté gauche devrait afficher un film de la catégorie ».
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(/const pickTab = \(id: KioskTab\) => \{[\s\S]{0,260}filmsForTab\(films, id, 'rayon'\)\[0\][\s\S]{0,120}onSelect\(/.test(src), 'le rayon choisi donne son premier film à la fiche');
  assert.ok(src.includes('onClick={() => pickTab(id)}') && !src.includes('onClick={() => setTab(id)}'), 'les boutons de rayon passent par pickTab');
});
test('DISTRIBUTION PC: la borne du PC a son film, ses relevés et son décor modélisé derrière l\'écran', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('useIsPc()') && /const variant = isPc && PC_DISTRIBUTION \? PC_DISTRIBUTION : MOBILE_DISTRIBUTION/.test(view), 'le PC prend son film quand il existe, le téléphone garde le sien');
  assert.ok(view.includes('url: variant.film.src') && view.includes('film={variant.film}'), 'le crochet et le calque reçoivent le film de la variante');
  assert.ok(view.includes('className={styles.decor}') && view.includes('decorStyle('), 'le décor est posé d\'après la boîte de l\'écran filmé');
  assert.ok(view.indexOf('className={styles.decor}') < view.indexOf('ref={screenRef}'), 'le décor est sous l\'écran');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'));
  assert.ok(css.includes('.root[data-decor]') && css.includes('.decor'), 'avec le décor, les bandes de couleur et le cadre dessiné s\'effacent');
  assert.ok(!/\.root\[data-decor\][^}]*\{[^}]*(padding|gap|width)\s*:/.test(css), 'le décor ne change aucune cote : l\'écran reste où le film d\'approche l\'attend');
});
test('DISTRIBUTION FILMÉE: corrections de la relecture du 25/11/2026', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  const hook = readText(path.join(ROOT, 'src/components/kiosk/useDistributionFilm.ts'));
  const welcome = readText(path.join(ROOT, 'src/components/kiosk/KioskWelcome.tsx'));
  // L'écran de la borne passe au-dessus de la vidéo : un appui sur lui doit la passer aussi.
  assert.ok(/ref=\{screenRef\}[^>]*onClick=\{filmPlaying \? tapFilm : undefined\}/.test(view) && view.includes('const tapFilm = useFilmTap(filmPlaying, distributionFilm.skip);') && /if \(filmTapSkips\(startedAtRef\.current, performance\.now\(\)\)\) skip\(\);/.test(readText(path.join(ROOT, 'src/components/kiosk/kiosk-hooks.ts'))), 'un appui sur l\'écran passe la vidéo (hors double appui de « Louer »)');
  // Quelle que soit la fin, la vidéo s'arrête : pas de son sous le panneau.
  const done = hook.slice(hook.indexOf('const done = useCallback'), hook.indexOf('const start = useCallback'));
  assert.ok(done.includes('videoRef.current?.pause()'), 'done() met la vidéo en pause');
  // Un suivi mal formé ne doit pas faire disparaître le panneau.
  const start = hook.slice(hook.indexOf('const start = useCallback'), hook.indexOf('const skip = useCallback'));
  assert.ok(/try \{\s*onFrameRef\.current\(0, suivi\);\s*\} catch/.test(start) && start.includes('return false'), 'la première mise en place est gardée : en cas d\'erreur, pas de vidéo, le panneau s\'ouvre');
  // Le décor ne remplace la borne dessinée qu'une fois chargé ; changer de variante en cours de vidéo la passe.
  assert.ok(view.includes('onLoad={() => setDecorLoaded(true)}') && /data-decor=\{decor && decorLoaded \? '' : undefined\}/.test(view), 'le décor attend son image');
  assert.ok(/useEffect\(\(\) => \{\s*skipFilmRef\.current\(\);\s*\}, \[variant\]\)/.test(view), 'changement de variante : la vidéo est passée');
  // L'accueil : pas de cadre « Les nouveautés » vide, pas de jaquette cassée.
  assert.ok(welcome.includes('list.length > 0 &&') && welcome.includes('onError={() => drop(film.id)}'), 'cadre masqué sans nouveauté, affiche en échec retirée');
});
test('BORNE: le mot de passe peut s\'afficher en clair pendant la saisie', () => {
  // Rusmir, 25/11/2026 : « on devrait pouvoir afficher le mdp en clair pendant qu'on le tape ».
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAuth.tsx'));
  assert.ok(src.includes("const [passwordShown, setPasswordShown] = useState(false)"), 'caché par défaut');
  assert.equal(src.split("type={passwordShown ? 'text' : 'password'}").length - 1, 2, 'le mot de passe et sa confirmation suivent le même réglage');
  assert.ok(/<button\s+type="button"[^>]*aria-pressed=\{passwordShown\}[^>]*onClick=\{\(\) => setPasswordShown\(\(shown\) => !shown\)\}/.test(src.replace(/\n\s*/g, ' ')), 'un bouton, jamais de type submit, dit son état');
  assert.ok(src.includes("{passwordShown ? 'Cacher' : 'Voir'}"), 'libellé en clair');
  const switchMode = src.slice(src.indexOf('const switchMode'), src.indexOf('const submit'));
  assert.ok(switchMode.includes('setPasswordShown(false)'), 'changer de formulaire recache le mot de passe');
  assert.ok(!/type=\{passwordShown[^}]*\}[^>]*autoCorrect="on"/.test(src) && src.includes('spellCheck={false}'), 'un mot de passe affiché n\'est ni corrigé ni mis en majuscule');
});
test('CONNEXION: une session que le navigateur ne garde pas se dit, au lieu de ne rien faire', () => {
  // Rusmir, 25/11/2026 : bon pseudo, bon mot de passe, « il ne se passe rien, pas d'erreur ». Le serveur acceptait la
  // connexion, le navigateur refusait le cookie de session, et le panneau se rouvrait sans un mot.
  const src = readText(path.join(ROOT, 'src/store/index.ts'));
  const login = src.slice(src.indexOf('login: async (username, password)'), src.indexOf('register: async (username, password)'));
  assert.ok(/await get\(\)\.fetchMe\(\);\s*if \(!get\(\)\.isAuthenticated\) \{[\s\S]{0,600}authError: SESSION_NOT_KEPT[\s\S]{0,80}return false;/.test(login), 'après la connexion, la session est relue ; absente, c\'est une erreur affichée');
  assert.ok(/SESSION_NOT_KEPT = '[^']*cookies[^']*'/.test(src), 'le message parle des cookies');
});
test('SESSION (batterie du 25/11/2026): une panne ne déconnecte personne, et une session perdue se dit', () => {
  const store = readText(path.join(ROOT, 'src/store/index.ts'));
  const debut = store.indexOf('fetchMe: async () => {');
  const fetchMe = store.slice(debut, store.indexOf('// User local (fallback)', debut));
  const failure = fetchMe.slice(fetchMe.indexOf('catch'));
  // I1 / I3 : seul un 401 dit « non connecté ». Un 500 ou une coupure laisse le compte tel qu'il est à l'écran.
  assert.match(failure, /if \(status !== 401\) return;/, 'une panne (réseau, 5xx) ne touche pas à la session');
  assert.match(failure, /rentals: \[\]/, 'un vrai 401 vide aussi les locations en cours (plus de « Regarder » sans compte)');
  // I2 : l'inscription vérifie que la session tient, comme la connexion.
  const register = store.slice(store.indexOf('register: async (username, password)'), store.indexOf('logout: async'));
  assert.match(register, /await api\.me\.get\(\);[\s\S]{0,300}status === 401[\s\S]{0,120}isAuthenticated: false/, 'compte créé mais cookie refusé : la borne le sait');
  // I6 : une déconnexion qui n'a pas atteint le serveur n'est pas annoncée comme faite.
  const debutLogout = store.indexOf('logout: async');
  const logout = store.slice(debutLogout, store.indexOf('clearAuthError: ()', debutLogout));
  assert.match(logout, /catch \(error\) \{[\s\S]{0,800}return false;/, 'échec de la déconnexion : on reste connecté, et on le dit');
  assert.ok(logout.trimEnd().includes('return true;'), 'succès : true');
  // I8 : la phrase de récupération survit à un rechargement tant qu'elle n'est pas notée.
  const partialize = store.slice(store.indexOf('partialize: (state) => ({'));
  assert.match(partialize.slice(0, 1600), /recoveryPhrase: state\.recoveryPhrase/, 'la phrase est gardée sur l\'appareil jusqu\'à « J\'ai noté ma phrase »');

  const auth = readText(path.join(ROOT, 'src/components/kiosk/KioskAuth.tsx'));
  const ack = auth.slice(auth.indexOf('const acknowledgePhrase'), auth.indexOf('// ----- Écran final'));
  assert.match(ack, /if \(!useStore\.getState\(\)\.isAuthenticated\) \{[\s\S]{0,600}setFormError\(SESSION_NOT_KEPT\)/, 'phrase notée mais session absente : retour à la connexion, avec le message');
  // I9 : après une récupération, la phrase est NOUVELLE et l'ancienne ne marche plus.
  assert.ok(auth.includes('Votre nouvelle phrase de récupération') && auth.includes('ancienne ne fonctionne plus'), 'la nouvelle phrase s\'annonce comme telle');

  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /if \(accountOpen && !isAuthenticated\) \{[\s\S]{0,400}requestAuth\(/, '« Mon compte » ouvert sans session : la connexion est redemandée, pas de compte fantôme');
  assert.match(view, /logout\(\)\.then\(\(ok\) => \{[\s\S]{0,600}Déconnexion impossible/, 'déconnexion ratée : un message, et le compte reste ouvert');
});
test('DISTRIBUTION FILMÉE (batterie du 25/11/2026): fin sans image parasite, planches à la demande, réponse perdue', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  // À la fin, l'écran reste au-dessus du calque de la vidéo pendant son fondu : plus de fiche d'un autre film un instant.
  const hooks = readText(path.join(ROOT, 'src/components/kiosk/kiosk-hooks.ts'));
  assert.match(hooks, /window\.setTimeout\(\(\) => setHeld\(false\), FILM_FADE_HOLD_MS\)/, 'l\'écran ne redescend qu\'après le fondu');
  assert.ok(view.includes('const screenLifted = useLiftHold(filmPlaying);'), 'la coque s\'en sert');
  assert.match(view, /\$\{screenLifted \? styles\.ksLifted : ''\}/, 'la classe suit ce délai, pas la phase seule');
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskDistributionFilm.module.css'));
  const fondu = Number(/transition: opacity (\d+)ms linear, visibility/.exec(css)[1]);
  assert.ok(Number(/FILM_FADE_HOLD_MS = (\d+)/.exec(hooks)[1]) > fondu, 'le délai dépasse la durée du fondu');
  const film = readText(path.join(ROOT, 'src/components/kiosk/KioskDistributionFilm.tsx'));
  assert.ok(film.includes('rented !== null ? { maskImage:') && film.includes('rented !== null ? { backgroundImage:'), 'les planches ne sont demandées qu\'avec un film en vue');
  assert.ok(film.includes('fallbackTitleSize(fallbackTitle(rented.title))'), 'le titre de repli est ajusté à la tranche');
  const action = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  assert.match(action, /landed: async \(\) => \{[\s\S]{0,200}fetchMe\(\)[\s\S]{0,160}rentals\.some/, 'réponse perdue : le compte est relu pour savoir si la location existe');
  assert.match(readText(path.join(ROOT, 'src/api/index.ts')), /api\/rentals\/\$\{filmId\}`, \{ method: 'POST', signal: AbortSignal\.timeout\(90_000\) \}/, 'la location garde un délai plus long que celui de la borne');
  assert.ok(!readText(path.join(ROOT, 'src/components/kiosk/KioskAccount.tsx')).includes('styles.kAccount}'), 'plus de classe « undefined »');
});
test('LECTEUR (batterie du 25/11/2026): sur téléphone, « NO SIGNAL » ne couvre plus les commandes et le titre ne couvre plus le retour', () => {
  const portrait = (css) => css.slice(css.indexOf('@media (orientation: portrait) and (max-width: 900px)'));
  const controls = portrait(readText(path.join(ROOT, 'src/components/player/VHSControls.module.css')));
  // En portrait les commandes sont dans le flux : sans position, leur z-index ne valait rien et l'écran bleu (absolu,
  // z-index 5) passait devant PLAY, STOP et EJECT.
  assert.match(controls, /\.controls \{[^}]*position: relative;[^}]*z-index: 10;/, 'les commandes restent au-dessus de l\'écran bleu');
  assert.ok(!/\.controls \{[^}]*position: static;/.test(controls), 'plus de position statique en portrait');
  const player = portrait(readText(path.join(ROOT, 'src/components/player/VHSPlayer.module.css')));
  assert.match(player, /\.header \{[^}]*position: relative;[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/, 'le bouton de retour garde sa largeur, le titre prend ce qui reste');
  assert.match(player, /\.headerCenter \{[^}]*min-width: 0;/, 'le titre se tronque au lieu de déborder sur le bouton');
});
test('BORNE (batterie du 25/11/2026): la fin d\'une location, borne ouverte, se dit', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  const hooks = readText(path.join(ROOT, 'src/components/kiosk/kiosk-hooks.ts'));
  assert.match(hooks, /const next = nextRentalEnd\(rentals, Date\.now\(\)\);/, 'la borne surveille la prochaine échéance');
  assert.match(hooks, /fetchMe\(\)\.then\(\(\) => \{[\s\S]{0,400}onEndedRef\.current\(next\.filmId/, 'à l\'échéance le compte est relu, puis la borne est prévenue');
  assert.match(hooks, /if \(useStore\.getState\(\)\.getRental\(next\.filmId\)\) return;/, 'une location prolongée entre-temps ne déclenche rien');
  assert.match(view, /useRentalEnd\(\(filmId, title\) => \{[\s\S]{0,500}title: 'Location terminée'/, 'le visiteur est prévenu');
});
test('BONUS: le bonus de la semaine se reçoit dans la borne — « Mon compte », « Crédits insuffisants », bouton « Compte »', () => {
  const bonus = readText(path.join(ROOT, 'lib/bonus.ts'));
  assert.ok(bonus.includes("code: 'enough'") && bonus.includes("code: 'claimed'") && bonus.includes("code: 'available'"), 'le serveur dit POURQUOI le bonus n\'est pas disponible, par un code');
  const account = readText(path.join(ROOT, 'src/components/kiosk/KioskAccount.tsx'));
  assert.ok(account.includes('Bonus de la semaine') && account.includes('bonusLine(') && account.includes('claimWeeklyBonus') && account.includes('bonusLineText(bonus)'), 'la ligne est dans « Mon compte », toujours présente');
  // Dans l'écran lui-même (les commentaires du fichier citent aussi ces deux noms) : le solde, le bonus, puis la version.
  const solde = account.indexOf('styles.kAccountCredits');
  const ligne = account.indexOf('<span>Bonus de la semaine</span>');
  assert.ok(solde > 0 && solde < ligne && ligne < account.indexOf('<span>Version préférée</span>'), 'sous le solde, au même endroit');
  const action = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  assert.match(action, /if \(now === 'insufficient'\) \{[\s\S]{0,900}insufficientText\([\s\S]{0,900}claimWeeklyBonus\(\)[\s\S]{0,300}press\(\)/, 'crédits insuffisants : le bonus est proposé, puis la location reprend');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('styles.kNavBonus') && view.includes('const waitingBonus = useWaitingBonus();'), 'le bouton « Compte » rappelle le bonus qui attend');
  assert.match(readText(path.join(ROOT, 'src/components/kiosk/kiosk-hooks.ts')), /\[isAuthenticated, credits, refreshWeeklyBonus\]/, 'l\'état du bonus est relu quand le solde bouge');
});
test('FICHE (batterie du 25/11/2026): la bande-annonce se tait dès qu\'autre chose passe devant, et dit quand elle ne se lit pas', () => {
  const detail = readText(path.join(ROOT, 'src/components/kiosk/KioskDetail.tsx'));
  assert.match(detail, /if \(covered\) videoRef\.current\?\.pause\(\);/, 'recouverte (message, connexion, location, lecteur, paysage) : en pause');
  assert.match(detail, /<video ref=\{videoRef\}[^>]*onError=\{\(\) => setBroken\(true\)\}/, 'fichier illisible : un message, pas un lecteur gris');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /covered=\{overlay !== null \|\| distribution !== null \|\| authVisible \|\| isPlayerOpen \|\| hidden\}/, 'la borne dit à la fiche quand elle est recouverte');
  // En paysage la borne doit vraiment disparaître : `.rootHidden` perdait contre `.root { display: flex }`.
  assert.match(readText(path.join(ROOT, 'src/components/kiosk/KioskStates.module.css')), /\.rootHidden \{\s*display: none !important;/, 'la borne cachée est vraiment cachée');
});

test('FICHE (batterie du 25/11/2026): un détail qui n\'arrive pas se dit, et se redemande', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /setDetailFailed\(displayedId\)/, 'l\'échec est retenu, pour ce film');
  assert.match(view, /\[displayedId, displayedTmdbId, detailRetry\]/, 'le détail est redemandé à la réouverture de la fiche');
  assert.match(view, /if \(!film\?\.rental_status\) throw/, 'une réponse sans contenu est un échec, pas une exception');
  const detail = readText(path.join(ROOT, 'src/components/kiosk/KioskDetail.tsx'));
  assert.match(detail, /if \(!detail\) return <Pending what=\{failed \? 'error' : 'loading'\} \/>;/, '« Chargement… » ne reste pas pour toujours');
});

test('CATALOGUE (batterie du 25/11/2026): un rayon qui n\'a pas pu être chargé ne se dit pas vide', () => {
  const store = readText(path.join(ROOT, 'src/store/index.ts'));
  assert.match(store, /failedAisles: failed/, 'le magasin retient les rayons en échec');
  assert.match(store, /failed\.includes\(aisle as AisleType\) \? get\(\)\.films\[aisle as AisleType\]/, 'un rayon en échec garde ses films déjà connus');
  const browse = readText(path.join(ROOT, 'src/components/kiosk/KioskBrowse.tsx'));
  assert.ok(browse.includes('Ce rayon n’a pas pu être chargé.') && browse.includes('Réessayer'), 'le rayon dit l\'échec et propose de réessayer');
  assert.ok(browse.includes('Aucun film dans ce rayon.'), 'un rayon vraiment vide le dit toujours');
});

test('BORNE (batterie du 25/11/2026): sur PC, Échap fait ce que fait le geste retour', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return;[\s\S]{0,300}onBackRef\.current\(\)/, 'Échap ferme le message, le panneau, la fiche… comme le geste retour');
});
test('PANNEAUX (batterie du 25/11/2026): sur PC les formulaires tiennent dans l\'écran 2:3, et les liens gardent la taille d\'un appui', () => {
  const css = readText(path.join(ROOT, 'src/components/kiosk/KioskPanels.module.css'));
  const pc = css.slice(css.indexOf('@media (min-width: 769px) and (pointer: fine)'));
  // Le panneau devient son propre conteneur, plus étroit : tout ce qu'il contient (en cqw) rétrécit d'autant.
  assert.match(pc, /\.kAuth \{[^}]*container-type: inline-size;[^}]*padding-left: 9cqw;[^}]*padding-right: 9cqw;/, 'formulaires réduits sur l\'écran 2:3 du PC');
  assert.match(css, /\.kAuthLink \{[^}]*min-height: max\(40px, 10cqw\);/, 'liens du panneau de connexion : 40 px au moins');
  assert.match(css, /\.kBonusLine > span:first-child \{[^}]*white-space: nowrap;/, 'le nom de la ligne du bonus ne se coupe pas');
});
test('CATALOGUE: le préchargement de la page retient lui aussi les rayons en échec', () => {
  // Vu dans le navigateur le 25/11/2026 : le catalogue arrive d'abord par le préchargement d'App.tsx, pas par le magasin ;
  // un rayon en échec y était simplement sauté, et la borne le disait « vide ».
  const app = readText(path.join(ROOT, 'src/App.tsx'));
  assert.match(app, /useStore\.setState\(\{ failedAisles: AISLES\.filter\(\(_, i\) => !results\[i\]\) \}\);/, 'les rayons que le préchargement n\'a pas rapportés sont retenus');
});
test('LECTEUR: sur téléphone l\'écran bleu de STOP reste dans la zone de la vidéo', () => {
  const css = readText(path.join(ROOT, 'src/components/player/VHSControls.module.css'));
  const portrait = css.slice(css.indexOf('@media (orientation: portrait) and (max-width: 900px)'));
  assert.match(portrait, /box-shadow: inset 0 6px 18px rgba\(0, 255, 247, 0\.06\), 0 100vh 0 100vh #0a0a10;/, 'sous les commandes, le fond du lecteur et non l\'écran bleu');
  const player = readText(path.join(ROOT, 'src/components/player/VHSPlayer.module.css'));
  assert.match(player.slice(player.indexOf('@media (orientation: portrait) and (max-width: 900px)')), /\.blueScreen \{[^}]*align-items: flex-start;/, '« NO SIGNAL » est écrit dans la zone de la vidéo, pas derrière les commandes');
});
