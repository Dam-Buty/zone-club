"""Écart entre une capture de la page et une image de référence, dans une boîte. python3 ecart.py <capture> <référence> x0 y0 x1 y1

Les deux images couvrent la même part du cadre de la vidéo (tailles quelconques) ; la boîte est en fractions de cette
part. Chacune est recadrée sur la boîte puis ramenée à une grille grossière (un quart de la boîte en points de
référence, par moyenne) : on compare ainsi la lumière, la couleur et la place des masses, sans que le crénelage d'un
titre de quelques points ni un demi-point de décalage ne comptent. Imprime : l'écart moyen absolu (niveaux sur 255)
puis le biais moyen signé (capture − référence ; négatif = la page est plus sombre)."""
import sys

import numpy as np
from PIL import Image

x0, y0, x1, y1 = (float(v) for v in sys.argv[3:7])
ref = Image.open(sys.argv[2]).convert('RGB')
cap = Image.open(sys.argv[1]).convert('RGB')


def zone(im):
    w, h = im.size
    return im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))


zr = zone(ref)
grille = (max(3, zr.width // 4), max(3, zr.height // 4))
a, b = (np.asarray(z.resize(grille, Image.BOX), dtype=np.float32) for z in (zone(cap), zr))
print(round(float(np.abs(a - b).mean()), 2), round(float((a - b).mean()), 2))
