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
  assert.ok(view.includes('openPlayerOnTv'), '« Sur la TV »');
  const dist = readText(path.join(ROOT, 'src/components/kiosk/KioskDistribution.tsx'));
  for (const copy of ['Veuillez patienter', 'Votre K7 est prête', 'Regarder', 'Sur la TV', 'Mes locations']) {
    assert.ok(dist.includes(copy), copy);
  }
  assert.ok(dist.includes('preloadCastSdk'), 'SDK préchargé à l\'affichage du panneau');
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
  assert.ok(notice.includes('Mes locations') && notice.includes("setScene('exterior')"), 'le message mène à « Mes locations » et à « Quitter »');
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
