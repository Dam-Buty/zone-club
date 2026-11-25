"""Essai : l'atlas des tranches refait avec les VRAIES tranches du vidéoclub.

python3 distribution_tranches.py   → <dossier de la variante>/tex/tranches-etui.png (même découpage que tranches.png)

Les tranches viennent de l'application elle-même : pour chaque film de sources/tranches.json, on ouvre sa K7 dans la
boutique (store.selectFilm), on relève la toile 1536 × 1536 que dessine src/utils/VHSCoverGenerator.ts et on en découpe
la tranche (SPINE2 : x 512, y 117, 102 × 712, à l'échelle 1,5), en couleur (tex/tranches-reelles/<tmdb>.png) et en
relief (tex/tranches-relief/<tmdb>.png : la seconde toile du générateur, celle qui donne leur relief aux titres).
Ne touche pas à tranches.png, donc pas à l'image validée de la devanture.
"""
import json

from PIL import Image, ImageOps

from variante import D, SOURCES

N, LW, LH = 96, 1068, 153          # pleine finesse de la toile du générateur (aucune réduction)
films = json.loads((SOURCES / 'tranches.json').read_text())
for dossier, mode, sortie in (('tranches-reelles', 'RGB', 'tranches-etui.png'), ('tranches-relief', 'L', 'tranches-etui-relief.png')):
    src = D / 'tex' / dossier
    atlas = Image.new(mode, (LW, N * LH))
    for i in range(N):
        f = src / f"{films[i % len(films)]['tmdb_id']}.png"
        assert f.exists(), f'{dossier} : découpe absente, {f.name}'
        # La toile est dessinée en miroir (sens des coordonnées de texture du modèle) : on la redresse, puis on la
        # couche, le haut de l'étui à gauche, comme dans tranches.png.
        atlas.paste(ImageOps.mirror(Image.open(f).convert(mode)).rotate(90, expand=True), (0, i * LH))
    atlas.save(D / 'tex' / sortie)
    print('ATLAS', sortie, atlas.size)


# ----- l'usure, d'après la K7 de référence validée par Rusmir le 22/11/2026 (k7_reference.py, k7_usure_tranche.py) -----
# Trois niveaux selon l'année du film (base du vidéoclub), cuits dans l'atlas : couleurs passées, papier à nu sur les
# bords et dans les cassures de l'encre. Le masque seul sort à part : la matière s'en sert pour la rugosité.
import sqlite3

import numpy as np

from k7_usure_tranche import masque, niveau_du_film

BASE = D.parents[2] / 'zone.db'
assert BASE.exists(), f'base du vidéoclub introuvable : {BASE}'
ANNEE = dict(sqlite3.connect(BASE).execute('select tmdb_id, release_year from films'))
PASSE = {1: 0.03, 2: 0.10, 3: 0.22}                  # les mêmes parts que k7_reference.py
GRIS, PAPIER = np.array([0.77, 0.76, 0.73], np.float32), np.array([0.975, 0.97, 0.96], np.float32)


def use(image, m, niveau):
    """Passe les couleurs puis met le papier à nu là où le masque le dit (image et masque de même taille)."""
    a = np.asarray(image.convert('RGB'), dtype=np.float32) / 255
    a = a * (1 - PASSE[niveau]) + GRIS * PASSE[niveau]
    a = a * (1 - m[..., None]) + PAPIER * m[..., None]
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def masque_a(taille, graine, niveau, couche=False):
    """Le masque d'une tranche ramené à une taille en points (largeur, hauteur) ; couché = le haut de l'étui à gauche."""
    m = Image.fromarray((masque(graine, niveau) * 255).astype(np.uint8))
    if couche:
        m = m.rotate(90, expand=True)
    return np.asarray(m.resize(taille, Image.BOX), dtype=np.float32) / 255


atlas = Image.open(D / 'tex' / 'tranches-etui.png').convert('RGB')
usees, usure = Image.new('RGB', atlas.size), Image.new('L', atlas.size)
compte = {1: 0, 2: 0, 3: 0}
for i in range(N):
    tmdb = films[i % len(films)]['tmdb_id']
    nv = niveau_du_film(ANNEE[tmdb])
    compte[nv] += 1
    m = masque_a((LW, LH), 1000 + tmdb, nv, couche=True)
    usees.paste(use(atlas.crop((0, i * LH, LW, (i + 1) * LH)), m, nv), (0, i * LH))
    usure.paste(Image.fromarray((m * 255).astype(np.uint8)), (0, i * LH))
usees.save(D / 'tex' / 'tranches-etui-usees.png')
usure.save(D / 'tex' / 'tranches-etui-usure.png')
print('ATLAS USÉ', usees.size, 'niveaux', compte)

# La K7 servie (« La Mouche », 1986 : niveau 2) : la même usure sur les deux tranches de sa jaquette (SPINE1 et SPINE2
# du générateur, x 15 et 512, y 117, 102 × 712, à l'échelle de la toile capturée).
jaq = Image.open(D / 'tex' / 'jaquette-servie.png').convert('RGB')
e = jaq.width / 1024
mj = np.zeros((jaq.height, jaq.width), np.float32)
for k, x in enumerate((15, 512)):
    bx = (round(x * e), round(117 * e), round((x + 102) * e), round((117 + 712) * e))
    mj[bx[1]:bx[3], bx[0]:bx[2]] = masque_a((bx[2] - bx[0], bx[3] - bx[1]), 11 + k, 2)
use(jaq, mj, 2).save(D / 'tex' / 'jaquette-servie-usee.png')
Image.fromarray((mj * 255).astype(np.uint8)).save(D / 'tex' / 'jaquette-servie-usure.png')
print('JAQUETTE SERVIE USÉE', jaq.size)

# ----- la K7 du film : tranche NEUTRE (Rusmir, 22/11/2026) — une seule vidéo sert à tous les films, la page pose la
# tranche du film loué pendant l'arrêt sur la fente. La K7 servie et la case que le robot saisit (ligne 25 de l'atlas)
# sont donc sombres et sans titre ; les autres K7 de la vitrine gardent le leur. -----
TRANCHE_NEUTRE = (0.035, 0.035, 0.04)          # couleur linéaire
LIGNE_SERVIE = 25                              # la case saisie : distribution_poses.py vérifie la même valeur
_srgb = tuple(round(255 * (1.055 * c ** (1 / 2.4) - 0.055)) for c in TRANCHE_NEUTRE)
neutre = use(Image.new('RGB', jaq.size, _srgb), mj, 2)
neutre.save(D / 'tex' / 'jaquette-neutre.png')
Image.fromarray((mj * 255).astype(np.uint8)).save(D / 'tex' / 'jaquette-neutre-usure.png')
Image.new('L', jaq.size, 0).save(D / 'tex' / 'jaquette-neutre-relief.png')
ligne = (0, LIGNE_SERVIE * LH, LW, (LIGNE_SERVIE + 1) * LH)
m25 = np.asarray(usure.crop(ligne), dtype=np.float32) / 255
usees.paste(use(Image.new('RGB', (LW, LH), _srgb), m25, 2), ligne[:2])
usees.save(D / 'tex' / 'tranches-etui-film.png')
relief = Image.open(D / 'tex' / 'tranches-etui-relief.png').convert('L')
relief.paste(0, ligne)
relief.save(D / 'tex' / 'tranches-etui-relief-film.png')
print('K7 NEUTRE : jaquette-neutre.png, tranches-etui-film.png (ligne', LIGNE_SERVIE, 'sans titre)')
