"""Devanture du bureau avec la borne : le fond (sans la borne).

La photo d'origine (5632 × 3072) garde son format. Le bas de l'image (porte, vitrine) glisse vers la droite de
`decalage_px` : ce qui sort à droite est coupé, et le mur est reconstitué à gauche pour loger la borne. Le haut de
l'image (l'enseigne VIDEOCLUB, son rebord et le mur qu'elle éclaire) ne bouge pas : l'enseigne reste centrée sur
l'image, donc au-dessus de l'ensemble borne + porte + vitrine. La lumière que l'enseigne jette sur le mur, sous le
rebord, est reportée là où le mur a glissé.

Usage : DEVANTURE=bureau python3 fond_bureau.py   → travail-bureau/fond.png, travail-bureau/repere.json
"""
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

from variante import D, G, SOURCES  # la variante en cours : sa géométrie, son dossier d'intermédiaire

W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
PH = G['photo']
EXT = PH.get('elargissement_px', 0)                        # mur ajouté à gauche : l'image est plus large que la photo
DEC, SEAM = PH['decalage_px'] + EXT, PH['couture_px']     # glissement du bas ; ligne sous laquelle l'image glisse
HAUT_DEC = EXT // 2                                        # la bande de l'enseigne glisse de moitié : elle reste centrée
rng = np.random.default_rng(1984)

P = np.asarray(Image.open(SOURCES / PH['fichier']).convert('RGB')).astype(float)
WP = P.shape[1]                                            # largeur de la photo d'origine
assert P.shape[0] == H and WP + EXT == W, (P.shape, W)

# ----- le mur de la photo, à gauche de la porte : son profil vertical, son grain -----
bande = P[:, 200:440]                                      # mur nu (ni le montant de la porte, ni la poubelle du bas)
profil = ndi.gaussian_filter1d(np.median(bande, axis=1), 5, axis=0)   # (H, 3)


def bruit(h, w, echelle, octaves=3, graine=0):
    r = np.random.default_rng(graine)
    out, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(echelle / 2 ** o))
        g = r.random((h // s + 2, w // s + 2))
        out += amp * np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize(((w // s + 2) * s, (h // s + 2) * s), Image.BICUBIC)).astype(float)[:h, :w] / 255
        tot += amp
        amp *= 0.5
    return out / tot


def pluie(h, w, densite, graine):
    """Traînées de pluie claires, presque verticales, à l'échelle de la photo du bureau."""
    r = np.random.default_rng(graine)
    couche = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(couche)
    for _ in range(int(w * h * densite)):
        x, y = r.random() * w, r.random() * h
        L = r.uniform(22, 80)
        d.line([(x, y), (x + L * 0.05, y + L)], fill=int(255 * r.uniform(0.08, 0.42)), width=int(r.choice([2, 2, 3])))
    return np.asarray(couche.filter(ImageFilter.GaussianBlur(1.1))).astype(float)[..., None] / 255


LARG = DEC + 140                                           # mur reconstitué, plus un fondu de 140 px sur la photo
# Sous la borne (cachée) : un mur de synthèse suffit. Profil vertical de la photo, taches lentes, grain, pluie.
mur = profil[:, None, :] * (0.86 + 0.28 * bruit(H, LARG, 520, 3, 7))[..., None]
mur += rng.normal(0, 2.6, (H, LARG, 1)) + rng.normal(0, 1.0, (H, LARG, 3))
mur += pluie(H, LARG, 0.00006, 11) * np.array([150.0, 165.0, 190.0])

# Au-dessus de la borne, le mur se voit : il est fait de VRAIS morceaux du mur de la photo (sa matière, ses traînées
# de pluie), pris plus bas sur le même mur et ramenés à la luminosité de leur nouvelle hauteur. Trois morceaux, pris
# à des hauteurs différentes et retournés une fois sur deux, pour qu'aucun motif ne se répète côte à côte.
HAUT_VISIBLE = int(PH['barre_de_poussee_px'] + PH['hauteur_barre_m'] * PPM - G['borne']['hauteur_m'] * PPM) + 160   # un peu sous le haut de la borne
x_src0, x_src1 = 190, 560                                  # mur nu de la photo (ni poubelle, ni montant de la porte)
lw = x_src1 - x_src0
y0v, y1v = SEAM - 60, HAUT_VISIBLE
recouvrement = 70
pos, k = LARG - lw, 0
couche = np.zeros((y1v - y0v, LARG, 3))
poids = np.zeros((y1v - y0v, LARG, 1))
decalages = [620, 1150, 880, 1400]
while pos > -lw:
    dy = decalages[k % len(decalages)]
    src = P[y0v + dy:y1v + dy, x_src0:x_src1].copy()
    ratio = profil[y0v:y1v] / np.maximum(profil[y0v + dy:y1v + dy], 1.0)
    src = src * np.clip(ratio, 0.4, 2.5)[:, None, :]
    if k % 2:
        src = src[:, ::-1]
    w_ = np.minimum(np.minimum(np.arange(lw) + 1, lw - np.arange(lw)) / recouvrement, 1.0)[None, :, None]
    a_, b_ = max(pos, 0), min(pos + lw, LARG)
    couche[:, a_:b_] += (src * w_)[:, a_ - pos:b_ - pos]
    poids[:, a_:b_] += np.broadcast_to(w_, (y1v - y0v, lw, 1))[:, a_ - pos:b_ - pos]
    pos -= lw - recouvrement
    k += 1
vrai = couche / np.maximum(poids, 1e-6)
fondu_bas = np.clip((y1v - np.arange(y0v, y1v)) / 120, 0, 1)[:, None, None]     # vers le mur de synthèse, sous la borne
mur[y0v:y1v] = vrai * fondu_bas + mur[y0v:y1v] * (1 - fondu_bas)

canvas = np.zeros((H, W, 3))
canvas[:, DEC:] = P[:, :W - DEC]                           # la photo, glissée de DEC vers la droite
rampe = np.clip((np.arange(LARG) - DEC) / 140, 0, 1)[None, :, None]
canvas[:, :LARG] = mur * (1 - rampe) + canvas[:, :LARG] * rampe

# ----- la lumière de l'enseigne sur le mur, sous le rebord : elle reste sous l'enseigne -----
# Sous le rebord, le mur est plus clair sous les lettres que plus à gauche. Profil horizontal h(x) de cet éclairage
# (0 = mur nu, 1 = sous les lettres), relevé juste sous le rebord ; décroissance verticale S(y) relevée au-dessus de
# la porte. Là où le mur a glissé, on ajoute ce qui manque : S(y) × (h(x) − h(x − DEC)).
ref = ndi.gaussian_filter1d(P[840:864].mean(axis=0), 40, axis=0)            # (W, 3)
nu = ref[120:480].mean(axis=0)
plein = ref[900:1700].mean(axis=0)
h = np.clip(((ref - nu) / np.maximum(plein - nu, 1e-3)).mean(axis=1), 0, 1.2)
haut_porte = PH['porte_px'][2]
S = np.zeros((H, 3))
lit = ndi.gaussian_filter1d(P[:, 800:1700].mean(axis=1), 4, axis=0)
for y in range(SEAM - 40, H):
    if y < haut_porte - 12:
        S[y] = np.clip(lit[y] - profil[y], 0, None)
    else:                                                     # sous le haut de la porte : décroissance douce
        S[y] = S[haut_porte - 13] * np.exp(-(y - (haut_porte - 13)) / 420.0)
def glisse(v, n):                                            # le profil de la photo, vu dans l'image après un glissement de n
    out = np.zeros(W)
    out[n:n + min(len(v), W - n)] = v[:W - n]
    return out


manque = np.clip(glisse(h, HAUT_DEC) - glisse(h, DEC), 0, None)               # (W,)
manque[LARG + 900:] = 0                                      # au-delà, la photo glissée porte déjà sa lumière
canvas += S[:, None, :] * manque[None, :, None]

# ----- le haut : la bande de l'enseigne, inchangée -----
# Élargie, l'image a besoin d'un peu de mur de chaque côté de cette bande : ses bords, loin de l'enseigne, sont du mur
# nu — ils sont prolongés en miroir.
bande_haut = np.pad(P, ((0, 0), (HAUT_DEC, EXT - HAUT_DEC), (0, 0)), mode='reflect') if EXT else P
t = np.clip((np.arange(H) - (SEAM - 6)) / 12, 0, 1)[:, None, None]           # fondu de 12 lignes sur la couture
canvas = bande_haut * (1 - t) + canvas * t

Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).save(D / 'fond.png')
x0p, x1p = PH['porte_px'][0] + DEC, PH['porte_px'][1] + DEC
B = G['borne']
kr = x0p - B['ecart_porte_m'] * PPM
kl = kr - B['largeur_m'] * PPM
vif = (P[:800, :, 0] > 200) & (P[:800, :, 2] > 200)
cols, rows = np.where(vif.sum(axis=0) > 0)[0], np.where(vif.sum(axis=1) > 0)[0]
repere = {'ground_y': PH['barre_de_poussee_px'] + PH['hauteur_barre_m'] * PPM, 'door_left_x': x0p, 'door_right_x': x1p, 'door_center_x': (x0p + x1p) / 2,
          'kiosk_left_x': kl, 'kiosk_right_x': kr, 'roof_y': SEAM, 'photo_x0': DEC, 'photo_y0': 0,
          'sign_center_x': float(cols.min() + cols.max()) / 2 + HAUT_DEC, 'sign_center_y': float(rows.min() + rows.max()) / 2, 'sign_w': float(cols.max() - cols.min())}
(D / 'repere.json').write_text(json.dumps(repere, indent=1))
print(json.dumps({k: round(v, 1) for k, v in repere.items()}))
