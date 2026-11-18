// La devanture mobile : la scène calée sur l'image fabriquée, et le zoom vers l'écran de la borne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stageBox, kioskScreenBox, zoomTransform } from '../../src/components/exterior/storefront-layout.ts';

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
