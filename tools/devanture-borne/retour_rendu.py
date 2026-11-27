"""Rend le film de retour depuis sa scène animée dans Blender (travail/retour/retour-anim.blend).

blender -b <retour-anim.blend> --python-exit-code 1 -P retour_rendu.py -- <échantillons> <pourcentage> <dossier> [<images>]
L'animation (main, K7, clapet, appareil) est faite à vue dans le Blender ouvert : la main suit des repères attachés à
la K7 (« tient », « lache », « pousse ») par des contraintes Copy Transforms dont l'influence est animée, les doigts
tiennent la K7 par cinématique inverse. Ce script ne fait que rendre, image par image, et change le message de
l'afficheur (« K7 REÇUE » quand la borne a pris la K7), que Blender n'anime pas.

SUIVI=1 : aucun rendu, écrit <dossier>/suivi.json (la tranche et l'écran à chaque image).
PASSES=1 : les passes cache_/blanc_ de chaque image dans <dossier>/passes/ (voir distribution_planches.py).

PC — blender -b main/retour-anim-pc.blend … avec TRAJET=<retour/pc/trajet.json> (retour_pc_trajet.py) : le même geste
sur la borne du PC ; l'appareil suit le trajet (il ne tourne jamais), l'image prend sa taille, et Blender ne rend que
la borne et la main sur fond transparent — le mur de la photo et la pluie viennent d'approche_compo.py (ANIM=retour/pc).
"""
import json
import os
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
# Cycles sur la carte graphique, comme borne.py : un fichier ouvert en tâche de fond prend les préférences de
# l'utilisateur, qui peuvent le laisser au processeur (le film du téléphone du 26/11 : 102 s par image au lieu de ~25).
_prefs = bpy.context.preferences.addons['cycles'].preferences
_prefs.compute_device_type = 'METAL'
_prefs.get_devices()
for _d in _prefs.devices:
    _d.use = _d.type == 'METAL'
s.cycles.device = 'GPU'
s.cycles.samples = ECH
s.cycles.use_denoising = True
s.render.resolution_percentage = PCT
s.render.use_motion_blur = True
s.render.motion_blur_shutter = 0.5
# Images rendues SANS flou de bougé : l'approche rapide de la K7 (1,2 à 2,4 s). La page y pose la tranche du film rendu,
# une image nette : sur une K7 floue elle se détachait, décalée (Rusmir, 27/11/2026 : re-rendre sans flou, comme le
# film de location, qui n'en a pas). Vaut pour le film ET ses passes, pour que le cache épouse la K7 de l'image.
NETTES = range(29, 58)


s.camera = bpy.data.objects['camera']
DOSSIER.mkdir(parents=True, exist_ok=True)
K7 = bpy.data.objects['k7_servie']
cam = s.camera
# TRAJET (PC) : l'appareil est placé d'après le trajet, la source commune à la passe « mur » et à l'assemblage. Il est
# posé image par image, sans animation : Cycles ne floute donc que ce qui bouge dans la scène (la main, le bras, la
# K7), et le flou de bougé de l'appareil lui-même est fait à l'assemblage (approche_compo.bouge) — jamais deux fois.
_PC = json.loads(Path(os.environ['TRAJET']).read_text()) if os.environ.get('TRAJET') else None
if _PC:
    _im = _PC['images']
    assert len(_im) == s.frame_end - s.frame_start + 1, 'le trajet doit avoir la durée de l\'animation'
    s.render.resolution_x, s.render.resolution_y = _PC['w'], _PC['h']
    cam.animation_data_clear()
    cam.data.animation_data_clear()


def appareil(i):
    """PC : l'appareil de l'image i (à appeler après frame_set)."""
    if _PC:
        f = _PC['images'][i]
        cam.location = (f['cam_x'], -f['d'], f['cam_z'])
        cam.data.shift_x, cam.data.shift_y = f['shift_x'], f['shift_y']
        cam.data.dof.focus_distance = f['d']


def flou(i):
    s.render.use_motion_blur = i not in NETTES


def _face_tranche():
    """Les sommets de la tranche tournée vers nous : la face arrière de la K7 couchée, celle que pincent les doigts
    (relevée une fois, puis suivie par ses numéros)."""
    s.frame_set(IMAGES[0])
    appareil(IMAGES[0])
    vs = [K7.matrix_world @ v.co for v in K7.data.vertices]
    ymin = min(v.y for v in vs)
    return [k for k, v in enumerate(vs) if v.y < ymin + 0.002]


# ----- SUIVI=1 : aucun rendu — où sont la tranche et l'écran à chaque image (même format que distribution_film.py) -----
if os.environ.get('SUIVI'):
    from bpy_extras.object_utils import world_to_camera_view as _proj

    def _bb(points):
        pr = [_proj(s, cam, p) for p in points]
        xs, ys = [q.x for q in pr], [q.y for q in pr]
        return [round(min(xs), 5), round(1 - max(ys), 5), round(max(xs), 5), round(1 - min(ys), 5)]

    _face, _ecran, _suivi = _face_tranche(), bpy.data.objects['ecran'], []
    for i in IMAGES:
        s.frame_set(i)
        appareil(i)
        bpy.context.view_layer.update()
        vs = [K7.matrix_world @ v.co for v in K7.data.vertices]
        _suivi.append({'i': i, 't': round(i / s.render.fps, 4), 'couchee': True, 'tranche': _bb([vs[k] for k in _face]),
                       'ecran': _bb([_ecran.matrix_world @ v.co for v in _ecran.data.vertices]), 'k7': _bb(vs)})
    (DOSSIER / 'suivi.json').write_text(json.dumps(_suivi) + '\n')
    print('SUIVI', len(_suivi), 'images', flush=True)
    IMAGES = []

# ----- PASSES=1 : deux petits rendus par image, recadrés sur la K7 (comme distribution_film.py) -----
#   cache_NNNN.png : ce qu'on voit réellement de la K7 (alpha) — les doigts, la façade, le clapet la trouent ;
#   blanc_NNNN.png : la même image avec une K7 blanche (albédo 0,8) — la lumière qu'elle reçoit à cet instant.
if os.environ.get('PASSES'):
    from bpy_extras.object_utils import world_to_camera_view as _proj
    P = DOSSIER / 'passes'
    P.mkdir(exist_ok=True)
    jaq = K7.data.materials[0]
    blanc = jaq.copy()
    pb = blanc.node_tree.nodes['Principled BSDF']
    for lien in list(pb.inputs['Base Color'].links):
        blanc.node_tree.links.remove(lien)
    pb.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
    em = bpy.data.materials.new('k7_cache')
    em.use_nodes = True
    e = em.node_tree.nodes.new('ShaderNodeEmission')
    em.node_tree.links.new(e.outputs['Emission'], em.node_tree.nodes['Material Output'].inputs['Surface'])
    autres = [o for o in s.objects if o.type in ('MESH', 'CURVE') and o is not K7]
    verres = [o for o in autres if o.name.startswith('vitre')]
    boites = {}
    s.render.use_border = s.render.use_crop_to_border = True
    for i in IMAGES:
        s.frame_set(i)
        appareil(i)
        bpy.context.view_layer.update()
        flou(i)
        pr = [_proj(s, cam, K7.matrix_world @ v.co) for v in K7.data.vertices]
        x0, x1 = max(0.0, min(q.x for q in pr) - 0.006), min(1.0, max(q.x for q in pr) + 0.006)
        y0, y1 = max(0.0, min(q.y for q in pr) - 0.004), min(1.0, max(q.y for q in pr) + 0.004)
        if x1 - x0 < 0.004 or y1 - y0 < 0.004:
            continue
        s.render.border_min_x, s.render.border_max_x, s.render.border_min_y, s.render.border_max_y = x0, x1, y0, y1
        boites[i] = [round(x0, 5), round(1 - y1, 5), round(x1, 5), round(1 - y0, 5)]
        K7.data.materials[0] = blanc
        s.render.film_transparent = False
        s.render.filepath = str(P / f'blanc_{i:04d}.png')
        bpy.ops.render.render(write_still=True)
        K7.data.materials[0] = em
        for o in autres:
            o.is_holdout = True
        for o in verres:
            o.hide_render = True
        s.render.film_transparent = True
        s.render.image_settings.color_mode = 'RGBA'
        s.render.filepath = str(P / f'cache_{i:04d}.png')
        bpy.ops.render.render(write_still=True)
        for o in autres:
            o.is_holdout = False
        for o in verres:
            o.hide_render = False
        K7.data.materials[0] = jaq
        print('PASSES', i, flush=True)
    anciennes = json.loads((P / 'boites.json').read_text()) if (P / 'boites.json').exists() else {}
    anciennes.update({str(k): v for k, v in boites.items()})
    (P / 'boites.json').write_text(json.dumps(anciennes) + '\n')
    IMAGES = []

for i in IMAGES:
    t = i / s.render.fps
    s.frame_set(i)
    appareil(i)
    flou(i)
    tex.image = recue if RECUE[0] <= t < RECUE[1] else repos
    s.render.filepath = str(DOSSIER / f'img_{i:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('IMAGE', i, round(t, 3), flush=True)
print('FINI', len(IMAGES))
