"""L'approche filmée de la borne : Blender rend la borne (ou la lumière du mur) pour chaque image du trajet.

blender -b --factory-startup --python-exit-code 1 -P approche_rendu.py -- <borne|mur> [<images>]
<images> : « 0,45,90 » ou « 0-90 » (toutes par défaut). Sorties : approche/borne_0000.png, approche/mur_0000.npy,
et, à la dernière image de la passe « borne », approche/ecran-arrivee.json (où est l'écran dans cette image).

La scène est celle de borne.py, sans une ligne changée : ce script exécute borne.py jusqu'à son rendu, puis déplace
l'appareil d'après approche/trajet.json (approche_trajet.py).
"""
import json
import os
import sys
from pathlib import Path

_ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(_ICI))
from variante import D as _D, G as _G  # noqa: E402

_a = sys.argv[sys.argv.index('--') + 1:]
_PASSE = _a[0]
_AP = _G['approche']
_RENDU = _AP.get('film_hd', _AP['film'])          # les images sont rendues à la taille du plus grand film
_WV, _HV = _RENDU['w'], _RENDU['h']
_WV, _HV = _WV * int(os.environ.get('ECHELLE_COMPO', 1)), _HV * int(os.environ.get('ECHELLE_COMPO', 1))    # le décor du PC (approche_compo.py)
# ANIM=<sous-dossier> : un autre trajet que celui de l'approche (la distribution sur PC : distribution/pc), pour la passe « mur ».
_ANIM = _D / os.environ.get('ANIM', 'approche')
_CAM = json.loads((_ANIM / 'trajet.json').read_text())['images']
if len(_a) > 1:
    if '-' in _a[1]:
        _deb, _fin = (int(v) for v in _a[1].split('-'))
        _CHOIX = list(range(_deb, _fin + 1))
    else:
        _CHOIX = [int(v) for v in _a[1].split(',')]
else:
    _CHOIX = list(range(len(_CAM)))

_tmp = _ANIM / ('tmp-' + _PASSE + ('.exr' if _PASSE == 'mur' else '.png'))
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [str(_AP['echantillons'][1 if _PASSE == 'mur' else 0]), str(_tmp), _PASSE]
_source = (_ICI / 'borne.py').read_text()
_tete = _source.split('scene.render.filepath = OUT')[0]
assert _tete != _source, 'borne.py : la ligne du rendu est introuvable'
# SCENE=distribution : la passe « borne » rend la borne habillée comme dans le film de distribution (étuis en carton
# usés, lumière douce, qualité photo — voir borne_etuis.py), pour que la fin de l'approche soit le début de ce film.
_ETUIS = _PASSE == 'borne' and os.environ.get('SCENE') == 'distribution'
if _ETUIS:
    _choix_approche = _CHOIX
    os.environ.update(SCENE_SEULE='1', QUALITE='photo', LUMIERE='douce')
    os.environ.pop('TRAJET', None)
    sys.argv = sys.argv[:sys.argv.index('--') + 1] + [str(_AP['echantillons'][0]), 'mixte']
    exec(compile((_ICI / 'distribution_film.py').read_text(), str(_ICI / 'distribution_film.py'), 'exec'), globals())
    _CHOIX = _choix_approche
else:
    exec(compile(_tete, str(_ICI / 'borne.py'), 'exec'), globals())      # la scène, la caméra d'origine, la passe choisie

import numpy as np  # noqa: E402

scene.render.resolution_x, scene.render.resolution_y = _WV, _HV
scene.render.use_border = True
scene.render.use_crop_to_border = False
# La zone rendue par borne.py, dans l'image d'origine (colonnes, lignes) : elle suit le mur pendant le trajet.
if _PASSE == 'mur':
    _zx0, _zx1, _zy0, _zy1 = MUR.get('zone_px', (0, 900, 1100, 2300))
else:
    _zx0, _zx1, _zy0, _zy1 = kx0 - 70 * ECH, kx1 + 130 * ECH, top_y - 330 * ECH, H


def _borne01(v):
    return min(1.0, max(0.0, v))


for _i in _CHOIX:
    _f = _CAM[_i]
    cam.location = (_f['cam_x'], -_f['d'], _f['cam_z'])
    cam_data.shift_x, cam_data.shift_y = _f['shift_x'], _f['shift_y']
    if _ETUIS:
        cam_data.dof.focus_distance = _f['d'] + Y_RACK_G
    _c0, _r0, _bw, _bh = _f['boite']
    _x0, _x1 = _borne01((_zx0 - _c0) / _bw), _borne01((_zx1 - _c0) / _bw)
    _y0, _y1 = _borne01(1 - (_zy1 - _r0) / _bh), _borne01(1 - (_zy0 - _r0) / _bh)
    _vide = (_x1 - _x0) * _WV < 2 or (_y1 - _y0) * _HV < 2
    if _PASSE == 'mur':
        _sortie = _ANIM / f'mur_{_i:04d}.npy'
        if _vide:
            np.save(str(_sortie), np.zeros((_HV, _WV, 3), np.float16))
            continue
    else:
        _sortie = _ANIM / f'borne_{_i:04d}.png'
        assert not _vide, f'image {_i} : la borne est hors du cadre'
    scene.render.border_min_x, scene.render.border_max_x = _x0, _x1
    scene.render.border_min_y, scene.render.border_max_y = _y0, _y1
    scene.render.filepath = str(_tmp if _PASSE == 'mur' else _sortie)
    bpy.ops.render.render(write_still=True)
    if _PASSE == 'mur':
        _exr = bpy.data.images.load(str(_tmp))
        _buf = np.empty(_exr.size[0] * _exr.size[1] * 4, np.float32)
        _exr.pixels.foreach_get(_buf)
        np.save(str(_sortie), _buf.reshape(_exr.size[1], _exr.size[0], 4)[::-1, :, :3].astype(np.float16))
        bpy.data.images.remove(_exr)
    elif _i == len(_CAM) - 1:
        # Où est l'écran de la borne dans la dernière image : le site y pose l'écran de son interface.
        _e = cadre([(L(x_), FRONT + 0.019, z_) for x_ in (F['ecran'][0], F['ecran'][1]) for z_ in (F['ecran'][2], F['ecran'][3])])
        (_ANIM / 'ecran-arrivee.json').write_text(json.dumps({k_: round(v_, 6) for k_, v_ in _e.items()}))
        print('ÉCRAN À L\'ARRIVÉE', {k_: round(v_, 4) for k_, v_ in _e.items()})
    print('IMAGE', _i, _PASSE, '→', _sortie.name, flush=True)
print('FINI', _PASSE, len(_CHOIX), 'images')
