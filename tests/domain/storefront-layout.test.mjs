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
