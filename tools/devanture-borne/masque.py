"""Le masque de reflets de la devanture animée du bureau, fabriqué avec l'image.

La scène animée du site (ExteriorScene) lit dans ce masque où faire vaciller un néon (rouge), où refléter les phares
sur une vitre (vert) et sur du métal (bleu). Il doit tomber sur l'image au pixel près : il est donc fait par les mêmes
opérations qu'elle — le masque de la photo d'origine glisse comme la photo (fond_bureau.py), puis la borne y est
posée en aplats (passe « masque » de borne.py). Le mur ajouté n'a rien : ni néon, ni vitre, ni métal.

Usage : DEVANTURE=bureau python3 masque.py   (après la passe « masque » de borne.py)   → travail-bureau/masque.png
"""
import json

import numpy as np
from PIL import Image

from variante import D, G, SOURCES

Image.MAX_IMAGE_PIXELS = None
W, H = G['sortie']['w'], G['sortie']['h']
PH, MQ = G['photo'], G['masque']
EXT = PH.get('elargissement_px', 0)
DEC, SEAM = PH['decalage_px'] + EXT, PH['couture_px']      # comme fond_bureau.py : glissement du bas, couture
HAUT_DEC = EXT // 2

M = np.asarray(Image.open(SOURCES / MQ['source']).convert('RGB')).astype(np.float32)
assert M.shape[0] == H and M.shape[1] + EXT == W, (M.shape, W, H)

# Sous la couture : le masque de la photo, glissé de DEC vers la droite ; rien sur le mur ajouté, et le même fondu de
# 140 px que la photo là où le mur de synthèse la rejoint.
bas = np.zeros((H, W, 3), np.float32)
bas[:, DEC:] = M[:, :W - DEC]
LARG = DEC + 140
bas[:, :LARG] *= np.clip((np.arange(LARG) - DEC) / 140, 0, 1)[None, :, None]
# Au-dessus : la bande de l'enseigne, restée centrée (elle ne glisse que de la moitié de l'élargissement).
haut = np.pad(M, ((0, 0), (HAUT_DEC, EXT - HAUT_DEC), (0, 0))) if EXT else M
t = np.clip((np.arange(H) - (SEAM - 6)) / 12, 0, 1)[:, None, None]
masque = haut * (1 - t) + bas * t

# La borne par-dessus, en aplats : elle remplace ce que le masque portait derrière elle.
borne = np.asarray(Image.open(D / 'borne-masque.png').convert('RGBA')).astype(np.float32)
assert borne.shape[:2] == (H, W), borne.shape
a = borne[..., 3:4] / 255
masque = masque * (1 - a) + borne[..., :3] * a
sortie = np.clip(masque + 0.5, 0, 255).astype(np.uint8)

# ----- garde-fous : un masque faux fait vaciller un mur ou refléter des phares dans le vide -----
R = json.loads((D / 'repere.json').read_text())
E = json.loads((D / 'mise-en-page.json').read_text())['ecran']
porte = int(R['door_left_x'])
rouge_gauche = int(sortie[SEAM + 6:, :porte, 0].max())
if rouge_gauche > 0:        # mur ajouté et borne : aucun néon qui vacille
    raise SystemExit(f'masque.py : du rouge ({rouge_gauche}) à gauche de la porte, sous la couture — le mur ajouté et la borne ne portent aucun néon qui vacille')
hors_borne = (borne[SEAM + 6:, :DEC, 3] == 0)
reflet_mur = int((sortie[SEAM + 6:, :DEC, 1:].max(axis=2) * hors_borne).max())
if reflet_mur > 0:
    raise SystemExit(f'masque.py : vitre ou métal ({reflet_mur}) sur le mur ajouté, hors de la borne')
ex, ey = int((E['x0'] + E['x1']) / 2 * W), int((E['y0'] + E['y1']) / 2 * H)
if sortie[ey, ex, 1] <= 200:
    raise SystemExit(f'masque.py : le centre de l\'écran de la borne ({ex}, {ey}) n\'est pas une vitre (vert {sortie[ey, ex, 1]})')
rouge_enseigne = int(sortie[:SEAM, :, 0].max())
if rouge_enseigne < 150:
    raise SystemExit(f'masque.py : l\'enseigne VIDEOCLUB a perdu son rouge (maximum {rouge_enseigne})')

Image.fromarray(sortie).save(D / 'masque.png')
print('masque', sortie.shape[1], '×', sortie.shape[0], '| rouge de l\'enseigne', rouge_enseigne, '| écran : vert', int(sortie[ey, ex, 1]),
      '| carrosserie : bleu', int(np.median(borne[..., 2][(borne[..., 3] > 250) & (borne[..., 2] > 8) & (borne[..., 1] < 8)])),
      '| couverture de la borne', round(float(a.mean()) * 100, 1), '% de l\'image')
