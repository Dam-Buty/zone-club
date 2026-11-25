"""Images de RÉFÉRENCE de la distribution : la tranche d'un film collée sur la K7 de la vidéo, comme la page doit le faire.

python3 distribution_reference.py <tmdb> <dossier de sortie> [<images, ex. 56,72,90>]      (sans liste : les 193)

Collage exact, en lumière linéaire, à partir des passes de distribution_film.py (PASSES=tout) : cache de ce qu'on voit
de la K7 et lumière qu'elle reçoit. C'est l'aperçu que Rusmir a validé le 23/11/2026 (« le rendu est bon »), et la
référence des tests de bout en bout (tests/e2e/) : la page, qui n'a droit qu'à une image, un masque et un voile noir,
doit donner la même chose à quelques niveaux près. Sorties : img_NNNN.png à la taille des images rendues, ou
ref-NNNN.jpg en 720 × 1290 quand une liste d'images est donnée.
"""
import json, sys, pathlib
import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, '.')
import sqlite3
from k7_usure_tranche import masque, niveau_du_film
TMDB, OUT = int(sys.argv[1]), pathlib.Path(sys.argv[2])
CHOIX = [int(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else None
OUT.mkdir(parents=True, exist_ok=True)
D = pathlib.Path('travail'); P = D / 'distribution/passes'
S = json.loads((D / 'distribution/suivi.json').read_text())
B = json.loads((P / 'boites.json').read_text())
GRIS, PAPIER = np.array([0.77, 0.76, 0.73], np.float32), np.array([0.975, 0.97, 0.96], np.float32)
lin = lambda a: np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
srgb = lambda a: np.where(np.clip(a, 0, 1) <= 0.0031308, np.clip(a, 0, 1) * 12.92, 1.055 * np.clip(a, 0, 1) ** (1 / 2.4) - 0.055)
t = ImageOps.mirror(Image.open(D / f'tex/tranches-site-src/{TMDB}.png').convert('RGB'))
_an = dict(sqlite3.connect('../../zone.db').execute('select tmdb_id, release_year from films')).get(TMDB)
NIVEAU = niveau_du_film(_an) if _an else 2
PASSE = {1: 0.03, 2: 0.10, 3: 0.22}[NIVEAU]
mm = np.asarray(Image.fromarray((masque(1000 + TMDB, NIVEAU) * 255).astype(np.uint8)).resize(t.size, Image.BOX), np.float32) / 255
a = np.asarray(t, np.float32) / 255
a = a * (1 - PASSE) + GRIS * PASSE
a = a * (1 - mm[..., None]) + PAPIER * mm[..., None]
DEBOUT = Image.fromarray((a * 255).astype(np.uint8)); COUCHEE = DEBOUT.rotate(90, expand=True)
for e in S:
    i = e['i']
    if CHOIX is not None and i not in CHOIX:
        continue
    im = Image.open(D / f'distribution/film/img_{i:04d}.png').convert('RGB')
    W, H = im.size
    if str(i) in B and (P / f'cache_{i:04d}.png').exists():
        cache = Image.open(P / f'cache_{i:04d}.png'); blanc = Image.open(P / f'blanc_{i:04d}.png').convert('RGB')
        bx0, by0 = round(B[str(i)][0] * W), round(B[str(i)][1] * H)          # coin de la passe dans l'image
        cw, ch = cache.size
        # la tranche du film, à sa boîte, dans le repère de la passe
        x0, y0, x1, y1 = (round(e['tranche'][0] * W) - bx0, round(e['tranche'][1] * H) - by0, round(e['tranche'][2] * W) - bx0, round(e['tranche'][3] * H) - by0)
        if x1 - x0 >= 2 and y1 - y0 >= 2:
            src = (COUCHEE if e['couchee'] else DEBOUT).resize((x1 - x0, y1 - y0), Image.LANCZOS)
            alb = Image.new('RGB', (cw, ch)); dans = Image.new('L', (cw, ch), 0)
            alb.paste(src, (x0, y0)); dans.paste(255, (max(0, x0), max(0, y0), min(cw, x1), min(ch, y1)))
            lum = lin(np.asarray(blanc.resize((cw, ch)), np.float32) / 255) / 0.8
            lit = srgb(lin(np.asarray(alb, np.float32) / 255) * lum)
            alpha = np.asarray(cache.split()[-1], np.float32) / 255 * (np.asarray(dans, np.float32) / 255)
            zone = np.asarray(im.crop((bx0, by0, bx0 + cw, by0 + ch)), np.float32) / 255
            mel = zone * (1 - alpha[..., None]) + lit * alpha[..., None]
            im.paste(Image.fromarray((np.clip(mel, 0, 1) * 255).astype(np.uint8)), (bx0, by0))
    if CHOIX is None:
        im.save(OUT / f'img_{i:04d}.png')
    else:
        im.resize((720, 1290), Image.LANCZOS).save(OUT / f'ref-{i:04d}.jpg', quality=93)
print('collé', len(S) if CHOIX is None else len(CHOIX))
