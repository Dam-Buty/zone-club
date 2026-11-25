"""L'écran de la borne, dans les images de la devanture et du film d'approche : la capture de la page, posée telle quelle.

La borne est rendue par Blender avec une conversion de couleurs contrastée (AgX) : une image émise en sort assombrie
et durcie, et ses oranges vifs glissent (mesuré le 23/11/2026 : 10 niveaux de moins que la page en moyenne ; une
correction à la source délavait le bouton). Or c'est cet écran que le visiteur regarde quand le film d'approche
s'arrête, juste avant que le vrai écran de la page ne prenne sa place : il doit être LE MÊME. L'appareil ne tournant
jamais (il reste face au mur), l'écran est un rectangle droit dans l'image : on y pose la capture de la page
(sources/<ecran_image>), avant le halo, le flou de bougé et la pluie, qui passent donc devant lui comme devant le reste.
"""
import math

import numpy as np
from PIL import Image


def pose_ecran(img, boite, capture):
    """Pose `capture` (image PIL) dans `boite` = (x0, y0, x1, y1), en points de `img` (tableau H × W × 3, 0 à 255),
    au demi-point près : les bords sont fondus sur leur part de pixel. Rend le tableau modifié."""
    x0, y0, x1, y1 = boite
    H, W = img.shape[:2]
    lw, lh = x1 - x0, y1 - y0
    if lw < 2 or lh < 2:
        return img
    # Réduite d'abord à sa taille d'arrivée (un vrai filtrage), puis glissée de sa fraction de pixel.
    petite = capture.convert('RGB').resize((max(2, math.ceil(lw)), max(2, math.ceil(lh))), Image.LANCZOS)
    X0, Y0, X1, Y1 = math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)
    ax, ay = petite.width / lw, petite.height / lh
    coeffs = (ax, 0, (X0 - x0) * ax, 0, ay, (Y0 - y0) * ay)
    taille = (X1 - X0, Y1 - Y0)
    morceau = np.asarray(petite.transform(taille, Image.AFFINE, coeffs, Image.BICUBIC), dtype=np.float32)
    plein = np.asarray(Image.new('L', petite.size, 255).transform(taille, Image.AFFINE, coeffs, Image.BILINEAR), dtype=np.float32)[..., None] / 255
    # La part de la boîte qui tombe dans l'image (elle en sort pendant les mouvements d'appareil).
    gx0, gy0, gx1, gy1 = max(0, X0), max(0, Y0), min(W, X1), min(H, Y1)
    if gx1 <= gx0 or gy1 <= gy0:
        return img
    s = (slice(gy0 - Y0, gy1 - Y0), slice(gx0 - X0, gx1 - X0))
    img[gy0:gy1, gx0:gx1] = morceau[s] * plein[s] + img[gy0:gy1, gx0:gx1] * (1 - plein[s])
    return img
