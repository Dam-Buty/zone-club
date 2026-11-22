"""Les jaquettes des K7 voisines de la K7 de référence (pour k7_reference.py, vue « vitrine »). python3 k7_voisines.py

On n'a capturé que la tranche de ces films (tex/tranches-reelles, tex/tranches-relief). On la repose à sa place sur
une toile de 1536 points, aux deux emplacements de tranche du modèle ; les faces prennent la couleur moyenne de la
tranche (on ne les voit que de biais, entre deux étuis).
"""
import numpy as np
from PIL import Image

from variante import D

VOISINES = (22, 1100988, 194662, 550, 134, 335)      # Pirates des Caraïbes, 28 ans plus tard, Birdman, Fight Club, O'Brother, Il était une fois dans l'Ouest
for tmdb in VOISINES:
    for dossier, mode, suffixe in (('tranches-reelles', 'RGB', ''), ('tranches-relief', 'L', '-relief')):
        t = Image.open(D / 'tex' / dossier / f'{tmdb}.png').convert(mode)
        fond = tuple(int(v) for v in np.asarray(t).reshape(-1, len(mode)).mean(0)) if mode == 'RGB' else 0
        toile = Image.new(mode, (1536, 1536), fond)
        toile.paste(t, (768, 175))
        toile.paste(t, (22, 175))
        toile.save(D / 'tex' / f'voisine-{tmdb}{suffixe}.png')
print('VOISINES', len(VOISINES))
