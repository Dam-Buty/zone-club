"""Pose un rendu RGBA de la borne sur fond.png (le mur attrape-ombres donne des ombres semi-transparentes),
ajoute le halo de l'enseigne néon (ce que fait l'objectif d'un appareil photo autour d'un tube très lumineux),
puis fait tomber la pluie devant la borne, comme sur le mur reconstitué (fond.py) et sur la photo.

Usage : python3 compo.py <rendu.png> <sortie.png> [<recadrage.png>]
        python3 compo.py --halo <rendu.png> <sortie.png> <rayon du tube en px> [<gain> [<x0,y0,x1,y1>]]   (un gros plan seul)
Le recadrage facultatif isole la borne (colonnes 140 à 1000, lignes 1100 à la fin), à taille réelle.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

# Couches de lumière autour du tube (le halo de l'objectif), en lumière linéaire : portée (en rayons de tube), gain,
# teinte. Réglées sur la coupe d'un vrai tube de la photo (mesure_neon.py) : une gaine violette serrée ; au-delà,
# c'est le mur lui-même, éclairé par le tube, qui porte la lueur (passe « mur »).
LAYERS = ((1.3, 2.0, (0.75, 0.12, 1.0)), (3.2, 1.1, (0.50, 0.05, 1.0)), (8.0, 0.14, (0.35, 0.03, 1.0)),
          (20.0, 0.05, (0.30, 0.03, 1.0)), (46.0, 0.02, (0.25, 0.03, 0.90)))
HALO = [0.75]            # gain du halo ; lu dans geometrie.json (enseigne_borne.halo) ou donné en 5e argument


def halo(img, core, radius):
    """Ajoute le halo des tubes (masque `core`) à une image sRGB (float 0-255)."""
    lin = (np.clip(img, 0, 255) / 255) ** 2.2
    m = core.astype(np.float32)
    for reach, gain, tint in LAYERS:
        lin += ndi.gaussian_filter(m, radius * reach)[..., None] * (gain * HALO[0]) * np.array(tint)
    return np.clip(lin, 0, 1) ** (1 / 2.2) * 255


def tube_core(rgba):
    """Les pixels du gaz : opaques, rouge et bleu forts (rose vif ; il ne sature plus jusqu'au blanc)."""
    return (rgba[..., 3] > 230) & (rgba[..., 0] > 165) & (rgba[..., 2] > 165)


if sys.argv[1] == '--halo':
    if len(sys.argv) > 5:
        HALO[0] = float(sys.argv[5])
    r_ = np.asarray(Image.open(sys.argv[2]).convert('RGBA')).astype(float)
    core_ = tube_core(r_)
    if len(sys.argv) > 6:                 # x0,y0,x1,y1 : seule l'enseigne rayonne (pas les lettres blanches du bandeau)
        bx0, by0, bx1, by1 = (int(v) for v in sys.argv[6].split(','))
        keep = np.zeros_like(core_)
        keep[by0:by1, bx0:bx1] = True
        core_ &= keep
    Image.fromarray(halo(r_[..., :3], core_, float(sys.argv[4])).astype(np.uint8)).save(sys.argv[3])
    sys.exit(0)

ICI = Path(__file__).resolve().parent
D = ICI / 'travail'                 # tout l'intermédiaire (ignoré par git)
HALO[0] = json.loads((ICI / 'geometrie.json').read_text()).get('enseigne_borne', {}).get('halo', HALO[0])
fond = Image.open(D / 'fond.png').convert('RGBA')
rendu = Image.open(sys.argv[1]).convert('RGBA')
assert rendu.size == fond.size, (rendu.size, fond.size)

# La lumière que le mur renvoie (passe « mur » de borne.py : néon et réverbère sur un mur mouillé), ajoutée au mur de
# la photo. Elle s'arrête au cadre de la porte, qui est une photo, et au bord du toit.
passe = D / 'mur-passe.npy'
if passe.exists():
    GEO = json.loads((ICI / 'geometrie.json').read_text())
    M, REP = GEO.get('mur', {}), json.loads((D / 'repere.json').read_text())
    lum = np.load(passe)                                   # lumière linéaire, lignes 1100 à 2300, colonnes 0 à 900
    hh, ww = lum.shape[:2]
    yy, xx = np.mgrid[1100:1100 + hh, 0:ww].astype(np.float32)

    def step(v, a, b):                                     # 1 avant a, 0 après b
        s_ = np.clip((b - v) / (b - a), 0, 1)
        return s_ * s_ * (3 - 2 * s_)
    pg, ph = M['porte_px']['gauche'], M['porte_px']['haut']
    masque = np.maximum(step(xx, pg - 26, pg - 6), step(yy, ph - 22, ph - 4)) * (1 - step(yy, REP['roof_y'] + 2, REP['roof_y'] + 12))
    base = np.asarray(fond.convert('RGB')).astype(np.float32)
    zone = (base[1100:1100 + hh, 0:ww] / 255) ** 2.2 + lum * masque[..., None] * M.get('gain', 1.0)
    base[1100:1100 + hh, 0:ww] = np.clip(zone, 0, 1) ** (1 / 2.2) * 255
    fond = Image.fromarray(base.astype(np.uint8)).convert('RGBA')
    print('mur : lumière ajoutée, max linéaire', round(float((lum * masque[..., None]).max()), 3))
fond.alpha_composite(rendu)
img = np.asarray(fond.convert('RGB')).astype(float)
W, H = rendu.size
ra = np.asarray(rendu).astype(float)

bbox = D / 'neon-bbox.json'
if bbox.exists():
    nb = json.loads(bbox.read_text())
    x0, x1, y0, y1 = max(0, int(nb['x0']) - 4), min(W, int(nb['x1']) + 5), max(0, int(nb['y0']) - 4), min(H, int(nb['y1']) + 5)
    core = np.zeros((H, W), bool)
    core[y0:y1, x0:x1] = tube_core(ra[y0:y1, x0:x1])
    img = halo(img, core, nb['rayon_tube_px'])
    print('halo : cœur des tubes', int(core.sum()), 'px')

opaque = (ra[..., 3] > 128)[..., None]
r = np.random.default_rng(17)
layer = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(layer)
for _ in range(int(W * H * 0.00016)):
    x, y = r.random() * W, r.random() * H
    length = r.uniform(10, 34)
    d.line([(x, y), (x + length * 0.06, y + length)], fill=int(255 * r.uniform(0.05, 0.22)), width=1)
rain = np.asarray(layer.filter(ImageFilter.GaussianBlur(0.6))).astype(float)[..., None] / 255
img = img + rain * opaque * np.array([150, 165, 190])

out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
out.save(sys.argv[2])
if len(sys.argv) > 3:
    out.crop((140, 1100, 1000, out.height)).save(sys.argv[3])
print('compo', out.size)
