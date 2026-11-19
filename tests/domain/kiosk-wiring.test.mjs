import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
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
  for (const k of ['reviewEligibility', 'rewindClaimed', 'returnedEarly', 'returnDate', 'expiredDate', 'watchProgress', 'expiresAt']) {
    assert.ok(fetchMe.includes(k), `fetchMe pose ${k}`);
  }
  const catchBlock = fetchMe.slice(fetchMe.indexOf('catch'));
  assert.ok(catchBlock.includes('reviewEligibility: {}'), 'remis à zéro hors connexion');
  assert.ok(fetchMe.includes('returnedAt:'), 'le champ existant returnedAt est gardé (terminal, Michel)');
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
  const castAt = cast.indexOf('castFilm(filmId)');
  const openAt = cast.indexOf("openPlayer(filmId, { from: 'kiosk', ask: false })");
  assert.ok(castAt >= 0 && openAt > castAt, 'ailleurs : castFilm(filmId) puis openPlayer(…, ask: false)');
  // Un seul appel au Cast dans toute la borne : celui-là, après la sortie de la branche AirPlay.
  assert.equal((view.match(/castFilm\(/g) || []).length, 1, 'un seul castFilm( dans KioskView');
  assert.ok(view.indexOf('castFilm(') > view.indexOf("if (entry === 'airplay') {"), 'castFilm vient après la branche AirPlay');
  for (const file of walkFiles(path.join(ROOT, 'src/components/kiosk'))) {
    if (file.endsWith('KioskView.tsx')) continue;
    assert.ok(!readText(file).includes('castFilm('), `${path.basename(file)} : pas de Cast hors du gestionnaire de la borne`);
  }
  assert.match(view, /onTv=\{\(entry\) => watchOnTv\(filmId, entry\)\}/, 'le panneau passe son choix à watchOnTv');
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
  assert.ok(/onRented = useCallback\(\(filmId: number\) => setDistribution\(\{ phase: 'ready', filmId, fresh: true \}\)/.test(view), 'après une location : « Votre K7 est prête »');
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
