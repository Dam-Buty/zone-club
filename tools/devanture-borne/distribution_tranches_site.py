"""Les tranches des films pour la borne : ce que la page pose sur la K7 servie pendant l'arrêt sur la fente.

python3 distribution_tranches_site.py [<tmdb> …]        (sans identifiant : toutes les tranches capturées)

La borne ne dessine pas de jaquette (ni canvas ni 3D sous src/components/kiosk/) : ses tranches sont préparées ici.
Pour chaque tranche capturée dans l'application par capture_jaquettes.cjs (travail/tex/tranches-site-src/<tmdb>.png),
on la couche comme la K7 dans la fente, on y cuit l'usure de l'année du film (k7_usure_tranche.py, les trois niveaux
validés par Rusmir le 22/11/2026) puis la lumière de l'arrêt (travail/distribution/lumiere-tranche.png, rendue par
distribution_film.py avec une tranche blanche), et on écrit public/kiosk-tranches/<tmdb>.webp, au format exact de la
boîte « tranche » de l'arrêt.

Repli d'un film sans tranche préparée : repli-<niveau>.webp (la tranche neutre, éclairée) sur laquelle la page écrit
le titre, et usure-<niveau>.webp (le seul papier à nu, sur fond transparent) qu'elle pose par-dessus.
"""
import json
import sqlite3
import sys

import numpy as np
from PIL import Image, ImageOps

from k7_usure_tranche import masque, niveau_du_film
from variante import D, ICI

RACINE = ICI.parents[1]
SOURCES = D / 'tex' / 'tranches-site-src'
SORTIE = RACINE / 'public' / 'kiosk-tranches'
LARGEUR = 900                         # points : la tranche fait ~300 points CSS de large sur un téléphone, ×3 de densité
ALBEDO_LUMIERE = 0.8                  # la tranche blanche de lumiere-tranche.png
GAIN = float(__import__('os').environ.get('GAIN', 1.0))     # réglé en comparant à une tranche rendue par Blender
PASSE = {1: 0.03, 2: 0.10, 3: 0.22}   # couleurs passées, comme k7_reference.py
GRIS, PAPIER = np.array([0.77, 0.76, 0.73], np.float32), np.array([0.975, 0.97, 0.96], np.float32)
NEUTRE = (0.035, 0.035, 0.04)         # couleur linéaire de la tranche neutre (distribution_tranches.py)

arret = json.loads((D / 'distribution' / 'arret.json').read_text())
b = arret['tranche']
HAUTEUR = round(LARGEUR * ((b['y1'] - b['y0']) * 1290) / ((b['x1'] - b['x0']) * 720))
SORTIE.mkdir(parents=True, exist_ok=True)


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


LUMIERE = lin(np.asarray(Image.open(D / 'distribution' / 'lumiere-tranche.png').convert('RGB').resize((LARGEUR, HAUTEUR), Image.LANCZOS), dtype=np.float32) / 255) / ALBEDO_LUMIERE * GAIN


def couche(m):
    """Un masque d'usure (vertical, 572 × 4000) ramené à la tranche couchée."""
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).rotate(90, expand=True).resize((LARGEUR, HAUTEUR), Image.BOX), dtype=np.float32) / 255


def use(a, m, niveau):
    """Couleurs passées puis papier à nu (a : image sRGB en flottants, m : masque)."""
    a = a * (1 - PASSE[niveau]) + GRIS * PASSE[niveau]
    return a * (1 - m[..., None]) + PAPIER * m[..., None]


def eclaire(a):
    return srgb(lin(a) * LUMIERE)


def ecris(a, nom, alpha=None):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if alpha is not None:
        im.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)))
    im.save(SORTIE / nom, 'WEBP', quality=82, method=6)


base = RACINE / 'zone.db'
assert base.exists(), f'base du vidéoclub introuvable : {base}'
ANNEE = dict(sqlite3.connect(base).execute('select tmdb_id, release_year from films'))
ids = [int(v) for v in sys.argv[1:]] or sorted(int(f.stem) for f in SOURCES.glob('*.png'))
compte = {1: 0, 2: 0, 3: 0}
for tmdb in ids:
    nv = niveau_du_film(ANNEE[tmdb]) if ANNEE.get(tmdb) else 2
    compte[nv] += 1
    # La découpe est en miroir et debout : on la redresse, puis on la couche, le haut de l'étui à gauche.
    t = ImageOps.mirror(Image.open(SOURCES / f'{tmdb}.png').convert('RGB')).rotate(90, expand=True).resize((LARGEUR, HAUTEUR), Image.LANCZOS)
    a = np.asarray(t, dtype=np.float32) / 255
    ecris(eclaire(use(a, couche(masque(1000 + tmdb, nv)), nv)), f'{tmdb}.webp')
print('TRANCHES', len(ids), 'niveaux', compte, f'{LARGEUR} × {HAUTEUR}')

if not sys.argv[1:]:
    neutre = np.broadcast_to(srgb(np.array(NEUTRE, np.float32)), (HAUTEUR, LARGEUR, 3)).astype(np.float32)
    for nv in (1, 2, 3):
        m = couche(masque(7000 + nv, nv))
        ecris(eclaire(use(neutre, np.zeros_like(m), nv)), f'repli-{nv}.webp')        # le titre s'écrit dessus, l'usure vient après
        ecris(eclaire(np.broadcast_to(PAPIER, (HAUTEUR, LARGEUR, 3)).astype(np.float32)), f'usure-{nv}.webp', alpha=m)
    print('REPLI : repli-1..3.webp, usure-1..3.webp')
