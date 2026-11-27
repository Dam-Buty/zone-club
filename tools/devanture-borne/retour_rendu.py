"""Rend le film de retour depuis sa scène animée dans Blender (travail/retour/retour-anim.blend).

blender -b <retour-anim.blend> --python-exit-code 1 -P retour_rendu.py -- <échantillons> <pourcentage> <dossier> [<images>]
L'animation (main, K7, clapet, appareil) est faite à vue dans le Blender ouvert : la main suit des repères attachés à
la K7 (« tient », « lache », « pousse ») par des contraintes Copy Transforms dont l'influence est animée, les doigts
tiennent la K7 par cinématique inverse. Ce script ne fait que rendre, image par image, et change le message de
l'afficheur (« K7 REÇUE » quand la borne a pris la K7), que Blender n'anime pas.
"""
import sys
from pathlib import Path

import bpy

_a = sys.argv[sys.argv.index('--') + 1:]
ECH, PCT, DOSSIER = int(_a[0]), int(_a[1]), Path(_a[2])
s = bpy.context.scene
if len(_a) > 3:
    IMAGES = [int(v) for v in _a[3].split(',')] if ',' in _a[3] or '-' not in _a[3] else list(range(int(_a[3].split('-')[0]), int(_a[3].split('-')[1]) + 1))
else:
    IMAGES = list(range(s.frame_start, s.frame_end + 1))
RECUE = (3.45, 5.0)         # secondes : l'afficheur écrit « K7 REÇUE » (la borne la prend des doigts du visiteur)
tex = [n for n in bpy.data.materials['afficheur'].node_tree.nodes if n.type == 'TEX_IMAGE'][0]
repos = tex.image
recue = bpy.data.images.load(str(Path(bpy.path.abspath(repos.filepath)).parent / 'afficheur-recue.png'), check_existing=True)
recue.colorspace_settings.name = repos.colorspace_settings.name
s.cycles.samples = ECH
s.cycles.use_denoising = True
s.render.resolution_percentage = PCT
s.render.use_motion_blur = True
s.render.motion_blur_shutter = 0.5
s.camera = bpy.data.objects['camera']
DOSSIER.mkdir(parents=True, exist_ok=True)
for i in IMAGES:
    t = i / s.render.fps
    s.frame_set(i)
    tex.image = recue if RECUE[0] <= t < RECUE[1] else repos
    s.render.filepath = str(DOSSIER / f'img_{i:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('IMAGE', i, round(t, 3), flush=True)
print('FINI', len(IMAGES))
