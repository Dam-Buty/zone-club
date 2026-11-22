"""La tranche du film loué suit la K7 : ce que la page doit savoir à chaque image. python3 distribution_planches.py

Après distribution_film.py lancé avec SUIVI=1 (boîtes de la tranche et de l'écran à chaque image, sans rendu) et
PASSES=tout (deux petits rendus par image, recadrés sur la K7 : cache_NNNN.png = ce qu'on voit réellement de la K7,
blanc_NNNN.png = la lumière qu'elle reçoit). Fabrique, dans travail/distribution/site/ :

  suivi.json   les boîtes par image et le plan des planches ;
  caches.webp  une cellule par image : l'alpha de ce qu'on voit de la tranche (la pince, l'autocollant, la tôle la
               trouent) — la page s'en sert comme masque ;
  ombres.webp  une cellule par image : un voile noir dont l'opacité reproduit la lumière — la page le pose sur la
               tranche, elle-même préparée à la lumière la plus forte (lmax) par distribution_tranches_site.py.

Les images où la K7 est debout (vitrine) et celles où elle est couchée (fente) forment deux blocs de cellules, de
formats différents, l'un sous l'autre. Conception : spec 2026-11-17, § 13.
"""
import json

import numpy as np
from PIL import Image, ImageFilter

from variante import D

P = D / 'distribution' / 'passes'
OUT = D / 'distribution' / 'site'
OUT.mkdir(exist_ok=True)
IPS = 24
CELLULE = {0: (48, 336), 1: (448, 64)}            # debout, couchée : largeur × hauteur d'une cellule
COLONNES = {0: 16, 1: 4}
ALBEDO = 0.8                                       # la K7 blanche des passes « blanc »
ARRET = (141, 168)                                 # images de l'arrêt sur la fente (K7 immobile, appareil fixe : 5,85 à 7,00 s)
S = json.loads((D / 'distribution' / 'suivi.json').read_text())
B = json.loads((P / 'boites.json').read_text())
N = len(S)
lin = lambda a: np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)  # noqa: E731
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
srgb = lambda a: np.where(a <= 0.0031308, a * 12.92, 1.055 * np.clip(a, 0, 1) ** (1 / 2.4) - 0.055)  # noqa: E731
TON = 0.16                                         # teinte moyenne d'une tranche éclairée, en lumière linéaire

bascule = next(e['i'] for e in S if e['couchee'])
blocs = {0: (0, bascule - 1), 1: (bascule, N - 1)}
assert all(not e['couchee'] for e in S[:bascule]) and all(e['couchee'] for e in S[bascule:]), 'la K7 se couche une seule fois'


def cellules(i):
    """Le cache (alpha) et la lumière (luminance linéaire) de l'image i, recadrés sur la boîte de la tranche."""
    e = S[i]
    c = 1 if e['couchee'] else 0
    w, h = CELLULE[c]
    vide = np.zeros((h, w), np.float32)
    vide3 = np.zeros((h, w, 3), np.float32)
    if str(i) not in B:
        return c, vide, vide3
    cache = Image.open(P / f'cache_{i:04d}.png')
    blanc = Image.open(P / f'blanc_{i:04d}.png').convert('RGB').resize(cache.size)
    cw, ch = cache.size
    b = B[str(i)]
    # la boîte de la tranche (fractions de l'image) → points de la passe
    px = lambda v, k: (v - b[k]) / (b[k + 2] - b[k]) * (cw if k == 0 else ch)  # noqa: E731
    t = e['tranche']
    boite = (px(t[0], 0), px(t[1], 1), px(t[2], 0), px(t[3], 1))
    # La boîte peut déborder de la passe (K7 au bord de l'image) : on la remplit de vide autour de la passe.
    bx = [round(v) for v in boite]
    if bx[2] - bx[0] < 1 or bx[3] - bx[1] < 1:
        return c, vide, vide3

    def recadre(image):
        toile = Image.new(image.mode, (bx[2] - bx[0], bx[3] - bx[1]), 0)
        toile.paste(image, (-bx[0], -bx[1]))
        return toile.resize((w, h), Image.BILINEAR)

    def adouci(image):          # le grain du rendu n'a rien à faire dans l'ombre (et pèserait dans la planche)
        return recadre(image).filter(ImageFilter.GaussianBlur(0.8))

    a = recadre(cache.split()[-1])
    lu = adouci(Image.fromarray((np.clip(lin(np.asarray(blanc, np.float32) / 255) / ALBEDO, 0, 4) * 60).astype(np.uint8)))
    return c, np.asarray(a, np.float32) / 255, np.asarray(lu, np.float32) / 60


tout = [cellules(i) for i in range(N)]
# La lumière a une couleur — blanche sous le tube de la vitrine, bleutée à la fente — et un voile noir ne sait
# qu'assombrir. Chaque régime (debout, couchée) a donc sa TEINTE (de luminance 1) et sa lumière la plus forte : la
# fabrique des tranches les cuit dans l'image du film (une image par régime), et l'ombre ne porte que la variation.
LUMIERE = {}
for c in (0, 1):
    vis = np.concatenate([lu[a > 0.5] for cc, a, lu in tout if cc == c and (a > 0.5).any()])
    # La teinte se prend là où l'œil s'attarde : pour la K7 couchée, pendant l'arrêt sur la fente (elle sort de l'ombre
    # avant, et sa lumière y est moins bleue) ; debout, sur tout le trajet dans la vitrine.
    ref = np.concatenate([lu[a > 0.5] for i, (cc, a, lu) in enumerate(tout) if cc == c and (a > 0.5).any() and (c == 0 or ARRET[0] <= i <= ARRET[1])])
    teinte = ref.mean(axis=0)
    teinte = teinte / float(teinte @ LUM)
    LUMIERE[c] = {'teinte': teinte, 'lmax': float(np.quantile((vis / teinte) @ LUM, 0.98))}     # hors éclats : l'ombre garde sa finesse
hauteurs = {c: -(-(blocs[c][1] - blocs[c][0] + 1) // COLONNES[c]) * CELLULE[c][1] for c in (0, 1)}
W, H = max(COLONNES[c] * CELLULE[c][0] for c in (0, 1)), hauteurs[0] + hauteurs[1]
assert W <= 4096 and H <= 4096, (W, H)
caches = np.zeros((H, W), np.float32)
ombres = np.zeros((H, W), np.float32)
for i, (c, a, lu) in enumerate(tout):
    k = i - blocs[c][0]
    w, h = CELLULE[c]
    x, y = (k % COLONNES[c]) * w, (0 if c == 0 else hauteurs[0]) + (k // COLONNES[c]) * h
    caches[y:y + h, x:x + w] = a
    # L'opacité du voile : ce qu'il faut retirer à une teinte moyenne (TON, en lumière linéaire) pour qu'elle reçoive
    # cette fraction de la lumière. La courbe sRGB n'est pas une simple puissance dans les tons sombres : calculée ainsi,
    # l'ombre est juste là où sont les tranches (un calcul en puissance 1/2,4 les laissait trop claires de 3 à 6 niveaux).
    part = np.clip(((lu / LUMIERE[c]['teinte']) @ LUM) / LUMIERE[c]['lmax'], 0, 1)
    ombres[y:y + h, x:x + w] = 1 - srgb(TON * part) / srgb(TON)


def planche(alpha, nom, gris, reduction=1):
    im = Image.new('RGBA', (W, H), (gris, gris, gris, 0))
    im.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)))
    if reduction > 1:           # la page place les cellules en pourcentages : une planche réduite se lit pareil
        im = im.resize((W // reduction, H // reduction), Image.LANCZOS)
    im.save(OUT / nom, 'WEBP', quality=60, alpha_quality=78, method=6, exact=False)
    return (OUT / nom).stat().st_size


# L'ombre est douce : à demi-taille elle pèse trois fois moins, sans différence visible.
o1, o2 = planche(caches, 'caches.webp', 255), planche(ombres, 'ombres.webp', 0, reduction=2)
arr = lambda b: [round(v, 4) for v in b]  # noqa: E731
dans = lambda b: b[2] > -0.45 and b[0] < 1.45 and b[3] > -0.45 and b[1] < 1.45 and b[2] - b[0] > 0.002 and b[3] - b[1] > 0.002  # noqa: E731
suivi = {
    'images': N, 'ips': IPS, 'planche': [W, H],
    'lumiere': {nom: {'lmax': round(LUMIERE[c]['lmax'], 4), 'teinte': [round(float(v), 4) for v in LUMIERE[c]['teinte']]} for c, nom in ((0, 'debout'), (1, 'couchee'))},
    'debout': {'cellule': list(CELLULE[0]), 'colonnes': COLONNES[0], 'de': blocs[0][0], 'a': blocs[0][1]},
    'couchee': {'cellule': list(CELLULE[1]), 'colonnes': COLONNES[1], 'de': blocs[1][0], 'a': blocs[1][1]},
    'pas': [{'t': arr(e['tranche']) if str(e['i']) in B and dans(e['tranche']) else None, 'c': 1 if e['couchee'] else 0, 'e': arr(e['ecran'])} for e in S],
}
(OUT / 'suivi.json').write_text(json.dumps(suivi, separators=(',', ':')) + '\n')
print(f'PLANCHES {W} × {H} | caches {o1} o, ombres {o2} o | lumière {suivi["lumiere"]} | bascule à l\'image {bascule} | suivi {(OUT / "suivi.json").stat().st_size} o')
