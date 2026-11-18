"""L'approche filmée de la borne : assemble chaque image du trajet, comme compo.py assemble l'image fixe.

[DEVANTURE=bureau] python3 approche_compo.py [<images>]   →   <dossier de la variante>/approche/film_0000.png …

Par image : le mur de la photo, ramené au cadre de l'appareil (échelle et glissement exacts : c'est un plan) ; la
lumière que le mur renvoie (passe « mur ») ; la borne rendue ; le halo du néon ; le flou de bougé ; la pluie qui tombe.
La première image doit être l'image fixe de la devanture : c'est ce qui rend le départ du film invisible. Elle lui
est comparée ici, et un écart arrête la fabrique.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

from variante import D, G

A = D / 'approche'
AP = G['approche']
R = json.loads((D / 'repere.json').read_text())
CAM = json.loads((A / 'trajet.json').read_text())['images']
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
WV, HV = AP['film']['w'], AP['film']['h']
ECART_MAX = 2.5                                        # départ du film contre l'image fixe, en niveaux sur 255 (essai : 0,88)
if len(sys.argv) > 1:
    CHOIX = list(range(*[int(v) + k for k, v in enumerate(sys.argv[1].split('-'))])) if '-' in sys.argv[1] else [int(v) for v in sys.argv[1].split(',')]
else:
    CHOIX = list(range(len(CAM)))

LAYERS = ((1.3, 2.0, (0.75, 0.12, 1.0)), (3.2, 1.1, (0.50, 0.05, 1.0)), (8.0, 0.14, (0.35, 0.03, 1.0)),
          (20.0, 0.05, (0.30, 0.03, 1.0)), (46.0, 0.02, (0.25, 0.03, 0.90)))          # compo.py
HALO = G.get('enseigne_borne', {}).get('halo', 0.75)
M = G.get('mur', {})
ZX0, ZX1, ZY0, ZY1 = M.get('zone_px', (0, 900, 1100, 2300))
D0, OEIL, DCX, SOL = G['camera']['distance_mur_m'], G['camera']['hauteur_oeil_m'], R['door_center_x'], R['ground_y']
CAM0_X = (G['camera'].get('axe_px', DCX) - DCX) / PPM
Y_NEON = 0.046                                         # l'axe des tubes est à 4,6 cm du mur (journal de borne.py)

fond = Image.open(D / 'fond.png').convert('RGB')
NB = json.loads((D / 'neon-bbox.json').read_text())

# Le cœur des tubes, mesuré une fois sur le rendu en taille réelle : sa surface sert d'étalon, pour que le halo ait
# la même force quand les tubes ne font que deux pixels de large (début du trajet) et quand ils en font vingt.
_r = np.asarray(Image.open(D / 'borne.png').convert('RGBA'))
_y0, _y1, _x0, _x1 = int(NB['y0']) - 4, int(NB['y1']) + 5, max(0, int(NB['x0']) - 4), int(NB['x1']) + 5
_z = _r[_y0:_y1, _x0:_x1].astype(np.float32)
COEUR_M2 = float(((_z[..., 3] > 230) & (_z[..., 0] > 165) & (_z[..., 2] > 165)).sum()) / PPM ** 2 * ((D0 - Y_NEON) / D0) ** 2
del _r, _z


def step(v, a, b):                                     # 1 avant a, 0 après b
    s_ = np.clip((b - v) / (b - a), 0, 1)
    return s_ * s_ * (3 - 2 * s_)


def vers_monde(col, lig):                              # le néon, vu de l'appareil d'origine → sa place réelle
    k = (D0 - Y_NEON) / D0
    return CAM0_X + ((col - DCX) / PPM - CAM0_X) * k, OEIL + ((SOL - lig) / PPM - OEIL) * k


NEON = [vers_monde(NB['x0'], NB['y1']), vers_monde(NB['x1'], NB['y0'])]      # (gauche, bas), (droite, haut)
gain_halo = [None]


def assemble(i):
    f = CAM[i]
    c0, r0, bw, bh = f['boite']
    base = np.asarray(fond.resize((WV, HV), Image.LANCZOS, box=(c0, r0, c0 + bw, r0 + bh))).astype(np.float32)
    # La lumière du mur, limitée comme dans compo.py (cadre de la porte, bord du toit, zone de la passe).
    lum = np.load(A / f'mur_{i:04d}.npy').astype(np.float32)
    yy, xx = np.mgrid[0:HV, 0:WV].astype(np.float32)
    xx, yy = c0 + (xx + 0.5) * bw / WV, r0 + (yy + 0.5) * bh / HV                # colonnes et lignes de l'image d'origine
    pg, ph = M['porte_px']['gauche'], M['porte_px']['haut']
    masque = np.maximum(step(xx, pg - 26, pg - 6), step(yy, ph - 22, ph - 4)) * (1 - step(yy, R['roof_y'] + 2, R['roof_y'] + 12))
    masque *= (xx >= ZX0) & (xx < ZX1) & (yy >= ZY0) & (yy < ZY1)
    base = np.clip((base / 255) ** 2.2 + lum * masque[..., None] * M.get('gain', 1.0), 0, 1) ** (1 / 2.2) * 255
    ra = np.asarray(Image.open(A / f'borne_{i:04d}.png').convert('RGBA')).astype(np.float32)
    al = ra[..., 3:4] / 255
    img = base * (1 - al) + ra[..., :3] * al
    # Halo du néon : le cœur des tubes dans le rendu, dans le cadre du néon projeté par l'appareil de cette image.
    kd = f['d'] / (f['d'] - Y_NEON)
    px_m = WV / bw * PPM * kd                                                 # pixels par mètre, à la profondeur du néon
    def vers_vue(x, z):
        col = DCX + (f['cam_x'] + (x - f['cam_x']) * kd) * PPM
        lig = SOL - (f['cam_z'] + (z - f['cam_z']) * kd) * PPM
        return (col - c0) * WV / bw, (lig - r0) * HV / bh
    (nx0, ny1), (nx1, ny0) = vers_vue(*NEON[0]), vers_vue(*NEON[1])
    mrg = 0.02 * px_m
    bx0, bx1, by0, by1 = int(np.floor(nx0 - mrg)), int(np.ceil(nx1 + mrg)), int(np.floor(ny0 - mrg)), int(np.ceil(ny1 + mrg))
    cx0, cx1, cy0, cy1 = max(0, bx0), min(WV, bx1), max(0, by0), min(HV, by1)
    if cx1 > cx0 and cy1 > cy0:
        z = ra[cy0:cy1, cx0:cx1]
        coeur = np.zeros((HV, WV), np.float32)
        coeur[cy0:cy1, cx0:cx1] = np.clip((np.minimum(z[..., 0], z[..., 2]) - 120) / 60, 0, 1) * (z[..., 3] / 255)
        entier = bx0 >= 0 and bx1 <= WV and by0 >= 0 and by1 <= HV
        if entier and coeur.sum() > 0:
            gain_halo[0] = COEUR_M2 * px_m ** 2 / float(coeur.sum())          # étalonné tant que le néon est entier
        if gain_halo[0]:
            lin = (np.clip(img, 0, 255) / 255) ** 2.2
            rayon = NB['rayon_tube_px'] / PPM * (D0 - Y_NEON) / D0 * px_m
            for reach, gain, tint in LAYERS:
                lin += ndi.gaussian_filter(coeur * gain_halo[0], rayon * reach)[..., None] * (gain * HALO) * np.array(tint, np.float32)
            img = np.clip(lin, 0, 1) ** (1 / 2.2) * 255
    return np.clip(img, 0, 255)


def bouge(i, img):
    """Flou de bougé : la moyenne de ce que l'appareil voit pendant l'ouverture de l'obturateur (tout est presque dans
    le plan du mur : chaque instant est la même image, à une autre échelle)."""
    f = CAM[i]
    c0, r0, bw, bh = f['boite']
    if all(max(abs(a - b) for a, b in zip(s, f['boite'])) < 0.05 for s in f['bouge']):
        return img
    PAD = 64
    large = Image.fromarray(np.pad(img, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge').astype(np.uint8))
    somme = np.zeros((HV, WV, 3), np.float32)
    for sc0, sr0, sbw, sbh in f['bouge']:
        g, t = (sc0 - c0) * WV / bw + PAD, (sr0 - r0) * HV / bh + PAD
        d_, b = (sc0 + sbw - c0) * WV / bw + PAD, (sr0 + sbh - r0) * HV / bh + PAD
        g, t, d_, b = max(0.0, g), max(0.0, t), min(float(large.width), d_), min(float(large.height), b)
        somme += (np.asarray(large.resize((WV, HV), Image.BICUBIC, box=(g, t, d_, b))).astype(np.float32) / 255) ** 2.2
    return (somme / len(f['bouge'])) ** (1 / 2.2) * 255


def pluie(i, img):
    """La pluie tombe devant l'appareil : des traînées neuves à chaque image (à 30 images par seconde une goutte
    traverse le cadre en moins de deux images)."""
    r = np.random.default_rng(1000 + i)
    PL = AP['pluie']                                     # réglée pour une image de 1280 px de large, mise à l'échelle
    k = WV / 1280
    layer = Image.new('L', (WV, HV), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(int(WV * HV * PL['densite'] / k ** 2)):
        x, y = r.random() * WV, r.random() * HV - 30 * k
        length = r.uniform(*PL['longueur']) * k
        d.line([(x, y), (x + length * PL['pente'], y + length)], fill=int(255 * r.uniform(*PL['force'])), width=max(1, round(k)))
    rain = np.asarray(layer.filter(ImageFilter.GaussianBlur(PL['flou'] * k))).astype(np.float32)[..., None] / 255
    return img + rain * np.array([150, 165, 190], np.float32)


for i in CHOIX:
    img = assemble(i)
    if i == 0:                                         # garde-fou : le film part de l'image fixe de la devanture
        ref = np.asarray(Image.open(D / 'compo.png').convert('RGB').resize((WV, HV), Image.LANCZOS)).astype(np.float32)
        ecart = float(np.abs(img - ref).mean())
        print("première image contre l'image fixe (compo.png) : écart moyen", round(ecart, 2), '/255')
        if ecart >= ECART_MAX:
            raise SystemExit(f"approche_compo.py : la première image du film s'écarte de l'image fixe de {ecart:.2f} niveaux (maximum {ECART_MAX}) — le départ se verrait")
    Image.fromarray(np.clip(pluie(i, bouge(i, img)), 0, 255).astype(np.uint8)).save(A / f'film_{i:04d}.png')
    if i % 10 == 0:
        print('image', i, 'halo ×', None if gain_halo[0] is None else round(gain_halo[0], 2), flush=True)
print('FILM', len(CHOIX), 'images', WV, '×', HV)
