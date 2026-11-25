// Les devantures : la scène calée sur l'image fabriquée (mobile, bureau), et l'approche filmée vers l'écran de la borne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stageBox, kioskScreenBox, choiceSpans, fitBox, fitInside, kioskScreenBoxDesktop, approachTransform, pickApproachFilm } from '../../src/components/exterior/storefront-layout.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
const FENETRES = [[360, 640], [390, 844], [412, 915], [412, 700], [1280, 720]];

test('SCÈNE: l\'image couvre toujours la fenêtre, sans bord vide', () => {
  for (const [vw, vh] of FENETRES) {
    const s = stageBox(L, vw, vh);
    assert.ok(s.left <= 0.5 && s.top <= 0.5 && s.left + s.width >= vw - 0.5 && s.top + s.height >= vh - 0.5, `${vw}x${vh}`);
    assert.ok(Math.abs(s.width / s.height - L.image.w / L.image.h) < 1e-6, 'proportions de l\'image');
  }
});

test('SCÈNE: sur téléphone, la borne et la porte sont visibles sur toute leur largeur', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh);
    const x = (f) => s.left + f * s.width;
    // Sur les fenêtres les plus hautes, le groupe est à peine plus large que la fenêtre : 4 px de montant tolérés.
    assert.ok(x(L.borne.x0) >= -4 && x(L.porte.x1) <= vw + 4, `${vw}x${vh} : ${x(L.borne.x0)} … ${x(L.porte.x1)}`);
  }
});

test('APPROCHE MOBILE: la formule de l\'écran suit celle de KioskView.module.css', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  assert.ok(css.includes('min(100vw - 12px, calc((100dvh - var(--kiosk-reserve)) * 5 / 9))'), 'largeur de l\'écran');
  assert.ok(css.includes('--kiosk-reserve: 84px') && css.includes('max-height: 760px'), 'réserve');
  assert.equal(kioskScreenBox(412, 915).width, 400);
  assert.equal(Math.round(kioskScreenBox(360, 640).width), Math.round((640 - 26) * 5 / 9));
});

test('DEVANTURE MOBILE: une scène porte l\'image et les zones, deux boutons en bas', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const mobile = tsx.slice(tsx.indexOf('if (isStatic) {'), tsx.indexOf('// ===== BUREAU'));
  assert.ok(mobile.includes('styles.mobileStage') && tsx.includes('stageBox('), 'scène dimensionnée par stageBox');
  assert.ok(mobile.includes('BORNE 24/7') && mobile.includes('PORTE VIDÉOCLUB'), 'les deux boutons');
  assert.ok(!mobile.includes('kioskButtonMobile') && !mobile.includes('Appuyez pour entrer'), 'plus de bouton provisoire');
  assert.ok(!mobile.includes('disabled'), 'pas de bouton désactivé');
  assert.ok(!css.includes('backdrop-filter'), 'pas de backdrop-filter');
  const barre = css.slice(css.indexOf('.mobileChoices'));
  assert.ok(barre.includes('safe-area-inset-bottom'), 'la barre respecte l\'encoche');
  assert.ok(tsx.includes("from '../../data/storefront-mobile.json'"), 'mise en page lue dans le fichier fabriqué');
});

test('APPROCHE: câblage dans la devanture — l\'intention d\'abord, jamais de minuteur à l\'appui', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  const ouvrir = tsx.slice(tsx.indexOf('const openKiosk = '), tsx.indexOf('const openKiosk = ') + 900);
  assert.ok(ouvrir.indexOf('isTransitioning') < ouvrir.indexOf('onKioskIntent'), 'le garde passe avant tout');
  assert.ok(ouvrir.indexOf('onKioskIntent') < ouvrir.indexOf('film.start()'), 'le GPU est libéré avant le film');
  assert.ok(ouvrir.indexOf('film.start()') < ouvrir.indexOf('onOpenKiosk'), 'sans film, la borne s\'ouvre aussitôt');
  // Leçon du zoom (18/11/2026) : un minuteur de garde armé à l'appui tombait avant la fin de l'animation, le rendu
  // qui la lance démontant aussi la scène 3D. Les minuteurs du film vivent dans son crochet, armés à la lecture.
  assert.ok(!ouvrir.includes('setTimeout'), 'aucun minuteur armé dans le gestionnaire de l\'appui');
  const jsx = app.slice(app.indexOf('<ExteriorView'), app.indexOf('<ExteriorView') + 400);
  assert.ok(jsx.includes('onKioskIntent='), 'App branche l\'intention');
});

// Relecture finale (18/11/2026) : page chargée dans une fenêtre de bureau, puis fenêtre rétrécie d'un coup sous 769 px —
// la devanture passait à l'image fixe avec une scène calculée sur l'ancienne fenêtre (porte hors champ), parce que la
// fenêtre n'était suivie qu'une fois la devanture mobile affichée.
test('SCÈNE: la fenêtre est suivie avant même que la devanture mobile soit affichée', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const i = tsx.indexOf('const onResize = ');
  assert.ok(i > 0, 'écouteur de la taille de la fenêtre');
  assert.ok(!tsx.slice(i - 160, i).includes('isStatic'), 'l\'écouteur n\'attend pas l\'image fixe');
});

// Décision de Rusmir du 16/11/2026 : « pas d'écran noir à l'ouverture de la borne ». La borne apparaît en fondu sur
// la devanture, restée dessous (App) ; et ce qui entoure le film, quand sa boîte bouge, a le fond de la page de la
// borne, pas du noir.
test('APPROCHE: pas de noir entre la devanture, le film et la borne', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const kiosk = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  const autour = css.slice(css.indexOf('.containerFilm {'), css.indexOf('}', css.indexOf('.containerFilm {')));
  assert.ok(autour.includes('background: #0d0c16') && kiosk.includes('#0d0c16'), 'fond de la page de la borne autour du film');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(app, /\(currentScene === 'exterior' \|\| kioskRevealing\)/, 'la devanture reste sous la borne le temps du fondu');
});

// Rusmir, 18/11/2026, sur les captures : « ok pour les deux boutons placés en bas, mais vu qu'ils occupent tout l'espace
// horizontal, pourquoi pas les placer en dessous de l'image et relever le tout — la visibilité du ciel est secondaire » ;
// et, pour le petit écran, « réduire la taille des boutons pour correspondre à ce qu'on obtient en largeur sur la
// première image » (390 × 844, où chaque bouton a la largeur de son objet).
const BARRE = 76;

test('BARRE: l\'image se pose juste au-dessus de la barre des boutons, borne et porte entières', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh, BARRE);
    assert.ok(Math.abs(s.top + s.height - (vh - BARRE)) < 0.5, `${vw}x${vh} : bas de l'image à ${s.top + s.height}, barre à ${vh - BARRE}`);
    assert.ok(s.left <= 0.5 && s.top <= 0.5 && s.left + s.width >= vw - 0.5, `${vw}x${vh} : pas de bord vide`);
    assert.ok(Math.abs(s.width / s.height - L.image.w / L.image.h) < 1e-6, 'proportions de l\'image');
    // L'image garde sa taille (celle de la fenêtre entière) : elle remonte, elle ne rétrécit pas.
    assert.equal(s.width, stageBox(L, vw, vh).width, `${vw}x${vh} : même échelle qu'avant la barre`);
    const x = (f) => s.left + f * s.width;
    assert.ok(x(L.borne.x0) >= -4 && x(L.porte.x1) <= vw + 4, `${vw}x${vh} : ${x(L.borne.x0)} … ${x(L.porte.x1)}`);
  }
});

test('BARRE: sans réserve, rien ne change (bureau sans WebGL en paysage : cadrage centré sur le groupe)', () => {
  for (const [vw, vh] of FENETRES) assert.deepEqual(stageBox(L, vw, vh, 0), stageBox(L, vw, vh));
  const s = stageBox(L, 1280, 720, BARRE);
  assert.ok(s.top + L.porte.y0 * s.height < 80 && s.top + L.ecran.y1 * s.height < 720 - BARRE, 'paysage : haut de la porte et écran de la borne visibles');
});

test('BARRE: chaque bouton est sous son objet, à sa largeur', () => {
  for (const [vw, vh] of FENETRES) {
    const s = stageBox(L, vw, vh, BARRE), c = choiceSpans(L, s, vw);
    const x = (f) => s.left + f * s.width;
    for (const [nom, b, z] of [['borne', c.borne, L.borne], ['porte', c.porte, L.porte]]) {
      assert.ok(b.left >= 6 - 1e-9 && b.left + b.width <= vw - 6 + 1e-9, `${vw}x${vh} ${nom} : dans la fenêtre`);
      assert.ok(b.left >= x(z.x0) - 0.5 && b.left + b.width <= x(z.x1) + 0.5, `${vw}x${vh} ${nom} : pas plus large que son objet`);
      assert.ok(b.width >= 120, `${vw}x${vh} ${nom} : ${b.width} px, trop étroit pour son libellé`);
    }
    assert.ok(c.borne.left + c.borne.width < c.porte.left, `${vw}x${vh} : les deux boutons ne se touchent pas`);
  }
  // Petit écran : la largeur de la borne, pas la moitié de la fenêtre (168 px avant).
  const s = stageBox(L, 360, 640, BARRE), c = choiceSpans(L, s, 360);
  assert.ok(Math.abs(c.borne.width - (L.borne.x1 - L.borne.x0) * s.width) < 0.5, `borne ${c.borne.width}`);
  assert.ok(Math.abs(c.porte.width - (L.porte.x1 - L.porte.x0) * s.width) < 0.5, `porte ${c.porte.width}`);
});

test('BARRE: câblage — bande opaque sous l\'image, sa hauteur réservée à la scène', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  assert.ok(tsx.includes(`CHOICES_BAR_HEIGHT = ${BARRE}`), 'hauteur de la barre côté code');
  assert.ok(css.includes(`height: calc(${BARRE}px + env(safe-area-inset-bottom))`), 'même hauteur côté feuille de style, encoche en plus');
  assert.match(tsx, /stageBox\(LAYOUT, viewport\.w, viewport\.h, reserve\)/, 'la scène laisse la place de la barre');
  assert.ok(tsx.includes('choiceSpans('), 'boutons placés sous leurs objets');
  const barre = css.slice(css.indexOf('.mobileChoices {'), css.indexOf('}', css.indexOf('.mobileChoices {')));
  assert.ok(/background: #[0-9a-f]{6};/.test(barre) && !barre.includes('gradient') && !barre.includes('rgba'), 'bande opaque, plus de dégradé sur l\'image');
});

// ----- La devanture du bureau (livraison B, 18/11/2026) -----
// Son image (5782 × 3072) et ses zones viennent de la même fabrique que le mobile : src/data/storefront-desktop.json.
const LD = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));

test('BUREAU: l\'image tient entière dans la fenêtre, centrée', () => {
  assert.deepEqual(fitBox(LD.image, 1920, 1080), { left: 0, top: (1080 - 1920 * 3072 / 5782) / 2, width: 1920, height: 1920 * 3072 / 5782 });
  const large = fitBox(LD.image, 2560, 1080);
  assert.equal(large.height, 1080);
  assert.ok(Math.abs(large.left - (2560 - 1080 * 5782 / 3072) / 2) < 1e-9 && large.top === 0);
});

test('BUREAU: câblage de la devanture', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const scene = readFileSync(path.join(ROOT, 'src/components/exterior/scene/ExteriorScene.ts'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  assert.ok(!tsx.includes('5632') && !scene.includes('5632'), 'plus de format écrit en dur');
  assert.ok(tsx.includes('storefront-desktop.json') && tsx.includes('fitBox('));
  assert.ok(tsx.includes('zoneStyle(LAYOUT_DESKTOP.borne)') && tsx.includes('zoneStyle(LAYOUT_DESKTOP.porte)'), 'borne et porte entières');
  assert.ok(tsx.includes('BORNE LOCATION'), 'indicateur de la borne');
  assert.ok(!tsx.includes('kioskButton') && !css.includes('.kioskButton'), 'le bouton provisoire a disparu');
});

// ----- L'approche filmée de la borne (livraison B) -----
// Rusmir, 18/11/2026 : plutôt qu'un zoom, un film de 3 s où l'on avance jusqu'à la borne ; à la dernière image
// l'écran filmé est là où se trouve l'écran de l'interface, qui apparaît en fondu par-dessus.

test('APPROCHE: l\'écran de l\'interface du bureau, aux positions mesurées à l\'écran le 18/11/2026', () => {
  const cas = [[1280, 720, 341.7, 21.6, 451.2, 676.8], [1440, 900, 411.7, 27, 564, 846], [1920, 1080, 481.6, 32.4, 676.8, 1015.2],
    [1024, 768, 360.4, 23, 481.3, 721.9],
    // Fenêtres plus larges que le décor (batterie de tests du 25/11/2026) : la borne se décale pour que le décor soit
    // centré dans la fenêtre, au lieu de laisser une bande noire à droite. Écran = milieu de la fenêtre − 0,71 × sa largeur.
    [2560, 1080, 799.4, 32.4, 676.8, 1015.2], [2560, 1440, 759.2, 170, 733.3, 1100], [1920, 950, 537.2, 28.5, 595.3, 893]];
  for (const [vw, vh, left, top, width, height] of cas) {
    const b = kioskScreenBoxDesktop(vw, vh);
    for (const [k, v] of [['left', left], ['top', top], ['width', width], ['height', height]]) assert.ok(Math.abs(b[k] - v) < 0.6, `${vw}×${vh} ${k} : ${b[k]} au lieu de ${v}`);
  }
});

test('APPROCHE: sur une fenêtre large, le décor du PC est centré — plus de bande noire d\'un seul côté', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  const decor = JSON.parse(readFileSync(path.join(ROOT, 'src/data/kiosk-distribution.json'), 'utf8')).pc.decor;
  const [x0, , x1] = decor.ecran, parEcran = 1 / (x1 - x0);                  // largeur du décor, en largeurs d'écran
  // Décalage du corps : moitié de fenêtre − (demi-décor − ce qui dépasse à gauche de la vitrine) − bordure, marge, écart, cadre.
  const k = parEcran / 2 - (x0 * parEcran - 0.62);
  const ecrit = /margin-left: max\(0px, calc\(50vw - var\(--ks-w\) \* ([0-9.]+) - 62px\)\);/.exec(css);
  assert.ok(ecrit, 'la feuille décale le corps de la borne sur les fenêtres larges');
  assert.ok(Math.abs(Number(ecrit[1]) - k) < 0.002, `le coefficient suit la boîte de l'écran dans le décor (${k.toFixed(4)})`);
  for (const [vw, vh] of [[1920, 950], [2560, 1080], [3440, 1440], [1536, 730], [1366, 657]]) {
    const b = kioskScreenBoxDesktop(vw, vh), largeur = b.width * parEcran, gauche = b.left - x0 * largeur;
    assert.ok(Math.abs(gauche - (vw - (gauche + largeur))) < 1.5, `${vw}×${vh} : marges égales (${gauche.toFixed(1)} à gauche)`);
  }
  // Fenêtres où le décor couvrait déjà tout : rien ne bouge.
  for (const [vw, vh, left] of [[1440, 900, 411.7], [1920, 1080, 481.6], [1280, 720, 341.7]]) assert.ok(Math.abs(kioskScreenBoxDesktop(vw, vh).left - left) < 0.6);
  // Les bords du décor se fondent dans le noir : là où il ne couvre pas la fenêtre, pas de coupure nette.
  assert.match(css, /\.decorFade \{[^}]*linear-gradient\(90deg, #05050a 0%/, 'bords fondus');
  assert.ok(readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'), 'utf8').includes('styles.decorFade'), 'le fondu est posé sur le décor');
});

test('APPROCHE: la formule du bureau suit KioskView.module.css', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  for (const morceau of ['calc(min(94dvh, 1100px) * 2 / 3)', 'width: calc(var(--ks-w) * 0.62)', 'padding: 0 26px', 'gap: 20px', 'padding: 13px', 'border-left: 3px solid']) assert.ok(css.includes(morceau), morceau);
});

test('APPROCHE: l\'écran filmé arrive sur l\'écran de l\'interface (bureau)', () => {
  for (const [vw, vh] of [[1920, 1080], [2560, 1440], [1280, 720], [2560, 1080]]) {
    const stage = fitBox(LD.image, vw, vh), cible = kioskScreenBoxDesktop(vw, vh), e = LD.approche.ecran, z = approachTransform(stage, e, cible);
    assert.ok(Math.abs(stage.left + z.x + z.scale * e.x0 * stage.width - cible.left) < 0.01);
    assert.ok(Math.abs(stage.top + z.y + z.scale * e.y0 * stage.height - cible.top) < 0.01);
    assert.ok(Math.abs(z.scale * (e.x1 - e.x0) * stage.width - cible.width) < 0.01);
    assert.ok(Math.abs(z.scale * (e.y1 - e.y0) * stage.height - cible.height) / cible.height < 0.03, `${vw}×${vh} : même proportion d'écran`);
  }
  const z = approachTransform(fitBox(LD.image, 1920, 1080), LD.approche.ecran, kioskScreenBoxDesktop(1920, 1080));
  assert.ok(z.scale > 1 && z.scale < 1.12, `sur 1920 × 1080 le film ne fait qu'un petit ajustement (${z.scale})`);
});

test('APPROCHE: le crochet du film ne fait jamais attendre', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/exterior/useApproachFilm.ts'), 'utf8');
  for (const m of ['prefers-reduced-motion', 'APPROACH_START_TIMEOUT_MS', 'APPROACH_GUARD_MARGIN_MS', 'createObjectURL', 'revokeObjectURL', "'ended'", "'error'", 'requestVideoFrameCallback']) assert.ok(src.includes(m), m);
  assert.ok(!/youtube|dailymotion|vimeo/i.test(src));
});

// Un double clic (habitude du bureau) ou un double appui ne doit pas escamoter le film : le second clic tombait sur
// le conteneur, qui « passe le film ». On ne peut le passer qu'une fois qu'il joue depuis un instant.
test('APPROCHE: un double clic ne passe pas le film', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/exterior/useApproachFilm.ts'), 'utf8');
  assert.match(src, /export const APPROACH_SKIP_AFTER_MS = \d+/, 'délai avant de pouvoir passer le film');
  const passer = src.slice(src.indexOf('const skip = '), src.indexOf('const skip = ') + 400);
  assert.ok(passer.includes("'playing'") && passer.includes('APPROACH_SKIP_AFTER_MS'), 'passer : seulement pendant la lecture, après le délai');
});

test('APPROCHE: câblage du bureau et apparition de la borne', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(tsx.includes('useApproachFilm(') && tsx.includes('approachTransform(') && tsx.includes('kioskScreenBoxDesktop('));
  assert.match(tsx, /<video[\s\S]{0,300}muted[\s\S]{0,200}playsInline/);
  assert.match(tsx, /onKioskIntent\?\.\(\);[\s\S]{0,600}film\.start\(\)/, 'l\'intention part avant le film');
  assert.ok(tsx.includes('.pause()') && tsx.includes('film.skip'));
  assert.ok(app.includes('KIOSK_REVEAL_MS') && app.includes('kiosk-reveal'));
});

// ----- Le film d'approche sur la devanture mobile : il remplace le zoom (Rusmir, 18/11/2026) -----

test('APPROCHE MOBILE: l\'écran filmé arrive sur l\'écran de l\'interface', () => {
  for (const [vw, vh] of [[360, 640], [390, 844], [412, 915], [412, 700]]) {
    const s = stageBox(L, vw, vh, 76), k = kioskScreenBox(vw, vh), e = L.approche.ecran, z = approachTransform(s, e, k);
    assert.ok(Math.abs(s.left + z.x + z.scale * e.x0 * s.width - k.left) < 0.01 && Math.abs(s.top + z.y + z.scale * e.y0 * s.height - k.top) < 0.01);
    assert.ok(Math.abs(z.scale * (e.y1 - e.y0) * s.height - k.height) / k.height < 0.03, `${vw}×${vh} : écran 5:9`);
    assert.ok(z.scale > 0.75 && z.scale < 1.35, `${vw}×${vh} : petit ajustement (${z.scale})`);
  }
});

test('APPROCHE MOBILE: câblage — le film remplace le zoom', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const lay = readFileSync(path.join(ROOT, 'src/components/exterior/storefront-layout.ts'), 'utf8');
  for (const mort of ['kioskZoom', 'closeUpReady', 'CLOSE_UP_SRC', 'storefront-borne-zoom', 'KIOSK_ZOOM_GUARD_MS', 'kioskVeil']) assert.ok(!tsx.includes(mort), mort);
  assert.ok(!css.includes('.mobileCloseUp') && !css.includes('.kioskVeil') && !css.includes('.mobileStageZoom'));
  assert.ok(!lay.includes('zoomTransform'));
  assert.ok(tsx.includes('approachTransform(stage, LAYOUT.approche.ecran, kioskTarget)'));
  assert.match(tsx, /\(min-width: 769px\) and \(pointer: fine\)[\s\S]{0,200}fitInside\(kioskScreenBoxDesktop\([\s\S]{0,160}kioskScreenBox\(/, 'sans WebGL sur un bureau, la cible est l\'écran PC de l\'interface');
  assert.ok(tsx.includes('mobileChoicesLeaving'), 'la barre des boutons s\'efface pendant le film');
});

// Constaté à la vérification à l'écran (18/11/2026), bureau sans WebGL (devanture fixe dans une fenêtre en paysage) :
// 1. le clic sur la borne — dont la zone dépasse le bas de la fenêtre — faisait défiler le conteneur de 203 px (le
//    navigateur amène dans le champ le bouton qui prend le focus, même dans un conteneur « overflow: hidden ») ;
// 2. l'écran 5:9 du film mobile ne peut pas recouvrir l'écran 2:3 de l'interface PC : calé en largeur, il débordait de
//    135 px en bas. Il se loge désormais dedans, centré, à sa hauteur.
test('DEVANTURE: le conteneur ne défile jamais, même quand un bouton hors champ prend le focus', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const bloc = css.slice(css.indexOf('.container {'), css.indexOf('}', css.indexOf('.container {')));
  assert.ok(bloc.includes('overflow: clip'), 'overflow: clip interdit tout défilement, programmé compris');
});

test('APPROCHE: un écran d\'un autre format se loge dans la cible, centré', () => {
  const pc = kioskScreenBoxDesktop(1280, 720);                        // 451,2 × 676,8 (2:3)
  const b = fitInside(pc, 5 / 9);
  assert.ok(Math.abs(b.height - pc.height) < 1e-9 && Math.abs(b.top - pc.top) < 1e-9, 'même hauteur');
  assert.ok(Math.abs(b.width - pc.height * 5 / 9) < 1e-9 && Math.abs(b.left + b.width / 2 - (pc.left + pc.width / 2)) < 1e-9, 'centré en largeur');
  const large = fitInside({ left: 10, top: 20, width: 100, height: 300 }, 2);    // plus large que la cible : calé en largeur
  assert.deepEqual(large, { left: 10, top: 20 + (300 - 50) / 2, width: 100, height: 50 });
  assert.deepEqual(fitInside(pc, 2 / 3), pc);
});

// Relecture finale (18/11/2026) : « Quitter » cliqué dans les 280 ms où la borne apparaît laissait la devanture montée
// sans interruption (elle l'est pendant le fondu) — figée sur la dernière image du film, sa phase jamais revenue au
// repos : ni la borne ni la porte ne répondaient plus. Chaque retour de la borne monte une devanture neuve.
test('APPROCHE: chaque retour de la borne monte une devanture neuve', () => {
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(app, /<ExteriorView\s+key=\{exteriorVisit\}/, 'la devanture porte une clé de visite');
  assert.match(app, /currentScene === 'kiosk'[\s\S]{0,400}setExteriorVisit\(/, 'la clé change quand on quitte la borne');
});

// Deux films pour la devanture mobile (Rusmir, 18/11/2026) : le site prend la haute définition quand l'écran en tire
// parti, le film léger sinon — et toujours le léger quand le visiteur a demandé d'économiser ses données.
test('APPROCHE: le film est choisi selon la définition de l\'écran', () => {
  const a = { src: '/leger.mp4', w: 720, h: 1290, duree: 3, images: 91, octets: 1, ecran: { x0: 0, y0: 0, x1: 1, y1: 1 }, hd: { src: '/hd.mp4', w: 1080, h: 1935, octets: 2 } };
  assert.equal(pickApproachFilm(a, 451, 2.625).src, '/hd.mp4', 'Pixel 9a : la scène fait 451 points logiques, soit 1184 points d\'écran');
  assert.equal(pickApproachFilm(a, 471, 3).src, '/hd.mp4', 'téléphone récent');
  assert.equal(pickApproachFilm(a, 360, 2).src, '/leger.mp4', 'petit écran : 720 points, le film léger suffit');
  assert.equal(pickApproachFilm(a, 375, 2).src, '/leger.mp4', '750 points : à peine plus que le film léger');
  assert.equal(pickApproachFilm(a, 451, 2.625, true).src, '/leger.mp4', 'économie de données demandée');
  assert.equal(pickApproachFilm({ ...a, hd: undefined }, 1920, 2).src, '/leger.mp4', 'un seul film : c\'est lui');
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  assert.ok(tsx.includes('pickApproachFilm(') && tsx.includes('devicePixelRatio'), 'la devanture choisit son film');
});
