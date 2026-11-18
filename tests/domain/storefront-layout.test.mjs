// La devanture mobile : la scène calée sur l'image fabriquée, et le zoom vers l'écran de la borne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stageBox, kioskScreenBox, zoomTransform, choiceSpans } from '../../src/components/exterior/storefront-layout.ts';

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

test('ZOOM: l\'écran de la borne arrive sur celui de l\'interface', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh), k = kioskScreenBox(vw, vh), z = zoomTransform(L, vw, vh);
    const gauche = s.left + z.x + z.scale * L.ecran.x0 * s.width;
    const haut = s.top + z.y + z.scale * L.ecran.y0 * s.height;
    const largeur = z.scale * (L.ecran.x1 - L.ecran.x0) * s.width;
    assert.ok(Math.abs(gauche - k.left) < 0.5 && Math.abs(haut - k.top) < 0.5 && Math.abs(largeur - k.width) < 0.5, `${vw}x${vh}`);
    assert.ok(z.scale > 3, 'c\'est bien un zoom');
  }
});

test('ZOOM: la formule de l\'écran suit celle de KioskView.module.css', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  assert.ok(css.includes('min(100vw - 12px, calc((100dvh - var(--kiosk-reserve)) * 5 / 9))'), 'largeur de l\'écran');
  assert.ok(css.includes('--kiosk-reserve: 84px') && css.includes('max-height: 760px'), 'réserve');
  assert.equal(kioskScreenBox(412, 915).width, 400);
  assert.equal(Math.round(kioskScreenBox(360, 640).width), Math.round((640 - 26) * 5 / 9));
});

test('DEVANTURE MOBILE: une scène porte l\'image et les zones, deux boutons en bas', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const mobile = tsx.slice(tsx.indexOf('if (isStatic) {'), tsx.indexOf('// ===== DESKTOP'));
  assert.ok(mobile.includes('styles.mobileStage') && tsx.includes('stageBox('), 'scène dimensionnée par stageBox');
  assert.ok(mobile.includes('BORNE 24/7') && mobile.includes('PORTE VIDÉOCLUB'), 'les deux boutons');
  assert.ok(!mobile.includes('kioskButtonMobile') && !mobile.includes('Appuyez pour entrer'), 'plus de bouton provisoire');
  assert.ok(!mobile.includes('disabled'), 'pas de bouton désactivé');
  assert.ok(!css.includes('backdrop-filter'), 'pas de backdrop-filter');
  const barre = css.slice(css.indexOf('.mobileChoices'));
  assert.ok(barre.includes('safe-area-inset-bottom'), 'la barre respecte l\'encoche');
  assert.ok(tsx.includes("from '../../data/storefront-mobile.json'"), 'mise en page lue dans le fichier fabriqué');
});

test('ZOOM: câblage dans la devanture', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(tsx.includes('onKioskIntent') && tsx.includes('zoomTransform('), 'intention à l\'appui, puis zoom');
  assert.ok(tsx.includes('prefers-reduced-motion'), 'animations réduites');
  assert.ok(tsx.includes('/storefront-borne-zoom.webp'), 'vue rapprochée');
  const ouvrir = tsx.slice(tsx.indexOf('const openKiosk = '), tsx.indexOf('const openKiosk = ') + 900);
  assert.ok(ouvrir.indexOf('isTransitioning') < ouvrir.indexOf('onKioskIntent'), 'le garde passe avant tout');
  assert.ok(ouvrir.indexOf('onKioskIntent') < ouvrir.indexOf('onOpenKiosk'), 'le GPU est libéré avant l\'ouverture');
  const jsx = app.slice(app.indexOf('<ExteriorView'), app.indexOf('<ExteriorView') + 400);
  assert.ok(jsx.includes('onKioskIntent='), 'App branche l\'intention');
});

// Constaté à la vérification à l'écran (18/11/2026) : le rendu qui lance le zoom démonte aussi la scène 3D quand elle
// était montée, ce qui prend plusieurs centaines de millisecondes. Compté depuis l'appui, le minuteur de garde tombait
// avant la fin du zoom et le coupait.
test('ZOOM: le minuteur de garde part avec le zoom, pas avec l\'appui', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const ouvrir = tsx.slice(tsx.indexOf('const openKiosk = '), tsx.indexOf('const openKiosk = ') + 900);
  assert.ok(!ouvrir.includes('setTimeout'), 'aucun minuteur armé dans le gestionnaire de l\'appui');
  assert.match(tsx, /useEffect\(\(\) => \{\s*if \(!kioskZoom\) return;[\s\S]{0,400}KIOSK_ZOOM_GUARD_MS/, 'armé dans un effet, une fois le zoom affiché');
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

// Décision de Rusmir du 16/11/2026 : « pas d'écran noir à l'ouverture de la borne ». Le voile qui termine le zoom
// prend donc le fond de la borne (celui de KioskView et de son repli), pas du noir.
test('ZOOM: le voile final est au fond de la borne, pas noir', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const kiosk = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  const fond = 'linear-gradient(180deg, #23213a 0%, #191827 40%, #14131f 100%)';
  assert.ok(kiosk.includes(`background: ${fond};`), 'fond de la borne (KioskView.module.css, .root)');
  const voile = css.slice(css.indexOf('.kioskVeil {'), css.indexOf('}', css.indexOf('.kioskVeil {')));
  assert.ok(voile.includes(`background: ${fond};`), 'le voile reprend ce fond');
  assert.ok(!voile.includes('#000'), 'pas de noir');
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

test('BARRE: le zoom part de l\'image relevée et arrive toujours sur l\'écran de l\'interface', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh, BARRE), k = kioskScreenBox(vw, vh), z = zoomTransform(L, vw, vh, BARRE);
    const gauche = s.left + z.x + z.scale * L.ecran.x0 * s.width;
    const haut = s.top + z.y + z.scale * L.ecran.y0 * s.height;
    const largeur = z.scale * (L.ecran.x1 - L.ecran.x0) * s.width;
    assert.ok(Math.abs(gauche - k.left) < 0.5 && Math.abs(haut - k.top) < 0.5 && Math.abs(largeur - k.width) < 0.5, `${vw}x${vh}`);
  }
});

test('BARRE: câblage — bande opaque sous l\'image, sa hauteur réservée à la scène et au zoom', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  assert.ok(tsx.includes(`CHOICES_BAR_HEIGHT = ${BARRE}`), 'hauteur de la barre côté code');
  assert.ok(css.includes(`height: calc(${BARRE}px + env(safe-area-inset-bottom))`), 'même hauteur côté feuille de style, encoche en plus');
  assert.match(tsx, /stageBox\(LAYOUT, viewport\.w, viewport\.h, reserve\)/, 'la scène laisse la place de la barre');
  assert.match(tsx, /zoomTransform\(LAYOUT, viewport\.w, viewport\.h, reserve\)/, 'le zoom part de la même scène');
  assert.ok(tsx.includes('choiceSpans('), 'boutons placés sous leurs objets');
  const barre = css.slice(css.indexOf('.mobileChoices {'), css.indexOf('}', css.indexOf('.mobileChoices {')));
  assert.ok(/background: #[0-9a-f]{6};/.test(barre) && !barre.includes('gradient') && !barre.includes('rgba'), 'bande opaque, plus de dégradé sur l\'image');
});
