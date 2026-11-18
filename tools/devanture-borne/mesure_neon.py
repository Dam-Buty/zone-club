"""Compare la coupe d'un tube de l'essai (la barre du haut du « E ») à celle d'un vrai tube de la photo (la barre du
haut du « E » de VIDEOCLUB) : couleur moyenne selon la distance à l'axe, en montant vers le mur nu.
Usage : python3 mesure_neon.py <compo.png>"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ICI = Path(__file__).resolve().parent
D = str(ICI / 'travail')
G = json.load(open(ICI / 'geometrie.json')); R = json.load(open(D + '/repere.json')); nd = json.load(open(D + '/neon-borne.json'))
E, PPM, cam = G['enseigne_borne'], G['sortie']['px_par_m'], G['camera']


def coupe(path, x0, x1, y0, y1):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)[y0:y1, x0:x1]
    lum, out = a.sum(axis=2), {}
    for c in range(a.shape[1]):
        k = int(lum[:, c].argmax())
        if lum[k, c] < 560:
            continue
        for d in range(0, 40):
            if k - d >= 0:
                out.setdefault(d, []).append(a[k - d, c])
    return {d: np.mean(v, axis=0) for d, v in out.items()}


# la barre du haut du « E » de l'essai, dans l'image
u = nd['unites'][0]
lit = np.array([p for p, lb in zip(u['points'], u['labels']) if lb == 'L' and p[2] < 0.001])
top = lit[(lit[:, 1] > lit[:, 1].max() - 0.02) & (lit[:, 0] > lit[:, 0].max() - 0.10)]
k = cam['distance_mur_m'] / (cam['distance_mur_m'] - nd['face_m'])
KX = ((R['kiosk_left_x'] + R['kiosk_right_x']) / 2 - R['door_center_x']) / PPM
SX, SZ = KX - nd['centre_m'][0], E['hauteur_247_m'] - nd['milieu_247_m']
xs = R['door_center_x'] + (SX + top[:, 0]) * k * PPM
ys = R['ground_y'] - (cam['hauteur_oeil_m'] + (SZ + top[:, 1] - cam['hauteur_oeil_m']) * k) * PPM
x0, x1, yt = int(xs.min()) + 6, int(xs.max()) - 8, int(ys.min())
ref = coupe(ICI / 'sources' / 'storefront-mobile.jpeg', 520, 600, 300, 372)
moi = coupe(sys.argv[1], x0, x1, yt - 50, yt + 12)
print(f'barre du haut du E : colonnes {x0} à {x1}, ligne {yt}')
for d in (0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 24, 32):
    if d in ref and d in moi:
        print(f'   {d:>2} px | photo ' + ' '.join(f'{v:4.0f}' for v in ref[d]) + ' | essai ' + ' '.join(f'{v:4.0f}' for v in moi[d]))
