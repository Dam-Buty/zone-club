"""Les tranches des films pour la borne : ce que la page pose sur la K7 de la vidéo, à chaque image.

python3 distribution_tranches_site.py [<tmdb> …]        (sans identifiant : toutes les tranches capturées)

La borne ne dessine pas de jaquette (ni canvas ni 3D sous src/components/kiosk/) : ses tranches sont préparées ici.
Pour chaque tranche capturée dans l'application par capture_jaquettes.cjs (travail/tex/tranches-site-src/<tmdb>.png),
on la redresse, on y cuit l'usure de l'année du film (k7_usure_tranche.py, les trois niveaux validés par Rusmir le
22/11/2026) et on écrit DEUX images, DEBOUT, au format du générateur (153 × 1068) : public/kiosk-tranches/<tmdb>.webp
pour la vitrine, <tmdb>-c.webp pour la fente (« couchée » : la page la tourne d'un quart de tour).

La tranche n'est PAS éclairée pour un instant donné : elle suit la K7 de la vitrine à la fente (spec § 13), et c'est
l'ombre de chaque image (distribution_planches.py) qui lui donne sa lumière. Mais cette ombre est un voile noir : elle
ne sait ni éclaircir ni teinter. Chaque image est donc préparée à la lumière la plus forte de son régime, et à sa
teinte (blanche sous le tube de la vitrine, bleutée à la fente).

Repli d'un film sans tranche préparée : repli-<niveau>.webp, la tranche neutre de la vidéo, usée à ce niveau ; la
page écrit le titre dessus.
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
LARGEUR, HAUTEUR = 153, 1068          # la tranche du générateur à son échelle (SPINE2, 102 × 712 × 1,5)
PASSE = {1: 0.03, 2: 0.10, 3: 0.22}   # couleurs passées, comme k7_reference.py
GRIS, PAPIER = np.array([0.77, 0.76, 0.73], np.float32), np.array([0.975, 0.97, 0.96], np.float32)
NEUTRE = (0.035, 0.035, 0.04)         # couleur linéaire de la tranche neutre (distribution_tranches.py)
# La lumière de chaque régime (distribution_planches.py) : sa teinte et sa valeur la plus forte, cuites dans l'image.
LUMIERE = json.loads((D / 'distribution' / 'site' / 'suivi.json').read_text())['lumiere']
SORTIE.mkdir(parents=True, exist_ok=True)


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def prepare(a, graine, niveau):
    """Couleurs passées, papier à nu, puis mise à la lumière de chaque régime — dans la vitrine, à la fente (a : image
    sRGB en flottants). Rend les deux images."""
    m = np.asarray(Image.fromarray((masque(graine, niveau) * 255).astype(np.uint8)).resize((LARGEUR, HAUTEUR), Image.BOX), dtype=np.float32) / 255
    a = a * (1 - PASSE[niveau]) + GRIS * PASSE[niveau]
    a = a * (1 - m[..., None]) + PAPIER * m[..., None]
    return [srgb(lin(a) * np.array(LUMIERE[r]['teinte'], np.float32) * LUMIERE[r]['lmax']) for r in ('debout', 'couchee')]


def ecris(a, nom):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(SORTIE / nom, 'WEBP', quality=84, method=6)


base = RACINE / 'zone.db'
assert base.exists(), f'base du vidéoclub introuvable : {base}'
ANNEE = dict(sqlite3.connect(base).execute('select tmdb_id, release_year from films'))
ids = [int(v) for v in sys.argv[1:]] or sorted(int(f.stem) for f in SOURCES.glob('*.png'))
compte = {1: 0, 2: 0, 3: 0}
for tmdb in ids:
    nv = niveau_du_film(ANNEE[tmdb]) if ANNEE.get(tmdb) else 2
    compte[nv] += 1
    # La découpe est en miroir (comme la toile du générateur) : on la redresse, le haut de l'étui en haut.
    t = ImageOps.mirror(Image.open(SOURCES / f'{tmdb}.png').convert('RGB')).resize((LARGEUR, HAUTEUR), Image.LANCZOS)
    debout, couchee = prepare(np.asarray(t, dtype=np.float32) / 255, 1000 + tmdb, nv)
    ecris(debout, f'{tmdb}.webp')
    ecris(couchee, f'{tmdb}-c.webp')
print('TRANCHES', len(ids), 'niveaux', compte, f'{LARGEUR} × {HAUTEUR}')

if not sys.argv[1:]:
    neutre = np.broadcast_to(srgb(np.array(NEUTRE, np.float32)), (HAUTEUR, LARGEUR, 3)).astype(np.float32)
    for nv in (1, 2, 3):
        debout, couchee = prepare(neutre, 7000 + nv, nv)
        ecris(debout, f'repli-{nv}.webp')
        ecris(couchee, f'repli-{nv}-c.webp')
    for vieux in SORTIE.glob('usure-*.webp'):
        vieux.unlink()
    print('REPLI : repli-1..3.webp')
