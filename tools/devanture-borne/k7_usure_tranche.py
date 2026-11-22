"""L'usure de la TRANCHE d'un étui carton, d'après deux tranches réelles fournies par Rusmir (22/11/2026).

python3 k7_usure_tranche.py <graine> <sortie-masque.png> <niveau 1|2|3> [<tranche.png> <sortie-aperçu.png>]

Trois niveaux selon l'âge du film (Rusmir, 22/11/2026 : « un film de 1970 est plus usé qu'un film de 2010 ») :
1 = récent (2005 et après), 2 = moyen (1985 à 2004), 3 = ancien (avant 1985). Voir niveau_du_film().

Ce que montrent les références : le pelliculage brillant est parti (surface mate), le papier blanc affleure le long
des deux grandes arêtes en franges DÉCHIQUETÉES de largeur très variable, plus fortes aux coins, et l'encre a craqué
en fines lignes blanches là où le carton a plié — des cassures, pas des plaques.

Les cassures viennent d'un vrai papier froissé photographié (ambientCG « Paper003 », CC0) : ce sont ses crêtes.
Le masque sort en niveaux de gris, dans le repère de la tranche (largeur = épaisseur de l'étui, hauteur = longueur) :
0 = encre intacte, 1 = papier à nu.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ICI = Path(__file__).resolve().parent
FROISSE = ICI / 'travail' / 'matieres' / 'Paper003' / 'Paper003_2K-JPG_Displacement.jpg'
L_MM, H_MM = 28.6, 200.0          # la tranche de l'étui
PX_MM = 20                        # finesse du masque : 20 points par millimètre → 572 × 4000
W, H = int(L_MM * PX_MM), int(H_MM * PX_MM)


# (Rusmir, 22/11 au soir : l'usure des BORDS était trop forte, « notamment Pirates des Caraïbes » — franges et coins
# réduits de plus de moitié ; les cassures de l'encre, elles, n'ont pas bougé.)
# Par niveau : largeur des franges, fréquence des morsures, part de la tranche où l'encre a craqué, force des cassures,
# taille des coins arrachés (mm).
NIVEAUX = {
    1: dict(frange=0.35, morsure=0.62, quant=0.968, zone=0.47, force=0.9, coin=(0.4, 1.2)),
    2: dict(frange=0.6, morsure=0.58, quant=0.955, zone=0.30, force=1.4, coin=(0.8, 2.2)),
    3: dict(frange=1.0, morsure=0.52, quant=0.940, zone=0.12, force=1.8, coin=(1.2, 3.2)),
}


def niveau_du_film(annee):
    return 3 if annee < 1985 else 2 if annee < 2005 else 1


def bruit(rng, forme, grain):
    """Bruit lisse entre 0 et 1, de taille de grain donnée (en points)."""
    b = ndi.gaussian_filter(rng.standard_normal(forme), grain, mode='wrap')
    b -= b.min()
    return b / b.max()


def cassures(rng, nv):
    """Les crêtes d'un papier froissé réel : fines lignes où l'encre a craqué."""
    src = np.asarray(Image.open(FROISSE).convert('L'), dtype=np.float32) / 255
    if rng.random() < 0.5:
        src = src[:, ::-1]
    src = np.rot90(src, int(rng.integers(4)))
    # Une fenêtre de 512 × 2048 points du papier, étirée à la tranche : des plis de l'ordre du centimètre.
    x0 = int(rng.integers(0, src.shape[1] - 512))
    fen = src[:, x0:x0 + 512]
    fen = np.asarray(Image.fromarray((fen * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255
    lisse = ndi.gaussian_filter(fen, 1.3)
    # Crête = courbure principale fortement négative (plus grande valeur propre du hessien, changée de signe).
    hxx, hyy = ndi.sobel(ndi.sobel(lisse, 1), 1), ndi.sobel(ndi.sobel(lisse, 0), 0)
    hxy = ndi.sobel(ndi.sobel(lisse, 1), 0)
    courb = -((hxx + hyy) / 2 - np.sqrt(((hxx - hyy) / 2) ** 2 + hxy ** 2))
    courb = np.clip(courb, 0, None)
    seuil = np.quantile(courb, nv['quant'])
    lignes = np.clip((courb - seuil) / (np.quantile(courb, 0.997) - seuil), 0, 1) ** 1.2
    # Des fils de cheveu : toutes les cassures ne blanchissent pas, elles apparaissent par zones, et leur blanc n'est
    # jamais plein — l'encre est fendue, pas arrachée.
    zones = bruit(rng, (H, W), 170)
    force = 0.55 + 0.45 * bruit(rng, (H, W), 25)
    lignes *= np.clip((zones - nv['zone']) * 3.5, 0, 1) * force
    return np.clip(lignes * nv['force'], 0, 1)


def franges(rng, nv):
    """Le papier à nu le long des deux grandes arêtes et aux deux bouts : déchiqueté, de largeur très variable."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    fibres = bruit(rng, (H, W), 1.6)                       # le déchiqueté fin
    moyen = bruit(rng, (H, W), 9)                          # les morsures de quelques dixièmes de millimètre
    m = np.zeros((H, W), np.float32)
    for dist, n in ((xx, H), (W - 1 - xx, H), (yy, W), (H - 1 - yy, W)):
        long_ = n == H
        # Largeur de la frange le long de l'arête, en mm : presque rien sur de longs passages, puis des morsures.
        t = ndi.gaussian_filter1d(rng.standard_normal(n), 60 if long_ else 40, mode='wrap')
        t = (t - t.min()) / (t.max() - t.min())
        fin = ndi.gaussian_filter1d(rng.standard_normal(n), 6, mode='wrap')
        fin = (fin - fin.min()) / (fin.max() - fin.min())
        larg = nv['frange'] * (0.18 + 2.2 * np.clip(t - nv['morsure'], 0, 1) ** 1.5 * 3 + 0.35 * fin)   # mm
        larg = (larg * PX_MM)[:, None] if long_ else (larg * PX_MM)[None, :]
        prof = dist / larg                                                         # 0 sur l'arête, 1 au bout de la frange
        # Striée dans le sens de l'arête (le frottement), et tachetée : le blanc n'est plein qu'au ras du bord.
        stries = ndi.gaussian_filter(rng.standard_normal((H, W)), (14, 0.8) if long_ else (0.8, 14), mode='wrap')
        stries = (stries - stries.min()) / (stries.max() - stries.min())
        f = np.clip((1.0 - prof - 0.75 * stries - 0.30 * fibres + 0.30) * 2.6, 0, 1) * (prof < 1.6)
        m = np.maximum(m, f * (0.55 + 0.45 * moyen))
    # Les coins : émoussés, le papier arraché sur quelques millimètres.
    for cx, cy in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        r = np.hypot(xx - cx, (yy - cy) * 0.8) / (PX_MM * float(rng.uniform(*nv['coin'])))
        m = np.maximum(m, np.clip((1.0 - r - 0.6 * moyen - 0.3 * fibres) * 3.5 + 0.4, 0, 1) * (r < 1.5))
    return m


def masque(graine, niveau):
    rng = np.random.default_rng(graine)
    nv = NIVEAUX[niveau]
    c, f = cassures(rng, nv), franges(rng, nv)
    # Près d'une frange, les cassures s'élargissent un peu : l'encre s'écaille à partir du bord.
    return np.clip(np.maximum(f, c), 0, 1)


if __name__ == '__main__':
    graine, sortie, niveau = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
    m = masque(graine, niveau)
    Image.fromarray((m * 255).astype(np.uint8)).save(sortie)
    print('MASQUE', sortie, 'niveau', niveau, m.shape, 'papier à nu : %.1f %%' % (100 * float((m > 0.5).mean())))
    if len(sys.argv) > 5:                                   # aperçu à plat, pour le juger à côté des références
        tr = Image.open(sys.argv[4]).convert('RGB').transpose(Image.FLIP_LEFT_RIGHT).resize((W, H), Image.LANCZOS)   # les tranches capturées sont en miroir
        a = np.asarray(tr, dtype=np.float32) / 255
        gris = a.mean(axis=2, keepdims=True)
        a = a * 0.86 + gris * 0.06 + 0.035                  # le pelliculage parti : noirs relevés, couleurs un peu passées
        papier = np.array([0.93, 0.91, 0.86], np.float32)
        a = a * (1 - m[..., None]) + papier * m[..., None]
        Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(sys.argv[5])
        print('APERÇU', sys.argv[5])
