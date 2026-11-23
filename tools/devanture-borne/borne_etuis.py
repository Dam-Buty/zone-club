"""La borne de la devanture, telle que le film de distribution la montre : étuis en carton usés dans les vitrines,
lumière douce, qualité photo, robot au repos.

blender -b --factory-startup --python-exit-code 1 -P borne_etuis.py -- <échantillons> <sortie.png>

Même rôle que la passe « borne » de borne.py (la borne sur fond transparent, à la taille de la devanture, et la mise
en page lue par le site), mais la scène est habillée par distribution_film.py (SCENE_SEULE) : la borne vue de la rue,
celle de la fin du film d'approche et celle du début du film de distribution sont ainsi la même (Rusmir, 23/11/2026).
Les passes « mur » et « masque » restent celles de borne.py : elles ne dépendent pas de l'habillage.
"""
import os
import sys
from pathlib import Path

_ICI_E = Path(__file__).resolve().parent
_arg = sys.argv[sys.argv.index('--') + 1:]
_SORTIE_E = _arg[1]
os.environ.update(SCENE_SEULE='1', QUALITE='photo', LUMIERE='douce')
os.environ.pop('TRAJET', None)
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [_arg[0], 'mixte']
exec(compile((_ICI_E / 'distribution_film.py').read_text(), str(_ICI_E / 'distribution_film.py'), 'exec'), globals())

cam_data.dof.focus_distance = -cam.location.y + Y_RACK_G          # la mise au point sur les tranches, comme dans le film
OUT = _SORTIE_E
_queue = (_ICI_E / 'borne.py').read_text().split('scene.render.filepath = OUT')[1]
exec(compile('scene.render.filepath = OUT' + _queue, str(_ICI_E / 'borne.py'), 'exec'), globals())
