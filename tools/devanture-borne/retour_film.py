"""Le film de retour de la K7 (spec 2026-11-26-borne-retour-k7-design, § 5.1 et 5.6) — variante téléphone.

blender -b --factory-startup --python-exit-code 1 -P retour_film.py -- <échantillons> [<images>]
<images> : « 0,40,80 » ou « 0-102 » (toutes par défaut). QUALITE=photo LUMIERE=douce ECHELLE=… comme la location.
Sortie : <dossier de la variante>/distribution/<DOSSIER, « retour » par défaut>/img_NNNN.png

La scène est celle du film de location (distribution_film.py, exécuté sans rien rendre), avec le visiteur invisible et
le lampadaire (visiteur.py). Le film, en 6,25 s :
  0 → 1,2 s     la vue part de l'écran (l'image 0 de la location), recule et s'incline vers la fente en gardant sa hauteur ;
  0,9 → 1,25 s  le clapet de la fente se relève ;
  1,2 → 2,3 s   la main du visiteur arrive d'en haut à droite, la K7 tenue par son coin (pouce dessus, doigts dessous) ;
  2,3 → 3,0 s   elle l'engage dans la fente, qui la porte ; 3,0 → 3,4 s elle la lâche ; 3,4 → 3,8 s elle la pousse ;
  3,85 s        la borne la détecte : l'afficheur écrit « K7 REÇUE » ; les rouleaux l'avalent, la main se retire ;
  4,35 → 4,6 s  le clapet retombe ;
  4,8 → 6,0 s   la vue se redresse et revient sur l'écran, cadrée comme l'image 0.
La main est la « Rigged hand » d'Elena FF (CC BY-SA), posée dans main/atelier-main.blend (voir README.md).
"""
import math
import os
import sys
from pathlib import Path

_ICI = Path(__file__).resolve().parent
_a = sys.argv[sys.argv.index('--') + 1:]
_ECHANTILLONS = _a[0]
_LISTE_IMAGES = _a[1] if len(_a) > 1 else None
# La scène du film de location, sans rien rendre : LISTE fait sauter ses rendus ; VISITEUR=0, on l'installe ici avec la main.
os.environ['LISTE'] = '1'
os.environ['VISITEUR'] = '0'
_DOSSIER = os.environ.pop('DOSSIER', 'retour')
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [_ECHANTILLONS, 'mixte']
_f = _ICI / 'distribution_film.py'
_sortie_std = sys.stdout
sys.stdout = open(os.devnull, 'w')
exec(compile(_f.read_text(), str(_f), 'exec'), globals())
sys.stdout = _sortie_std

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import visiteur  # noqa: E402

DUREE_RETOUR = 6.25        # Rusmir, 26/11 : le premier jet (4,25 s) allait trop vite
N_RETOUR = int(round(IPS * DUREE_RETOUR)) + 1
SORTIE = _OUT / _DOSSIER
SORTIE.mkdir(exist_ok=True)

# ----- la K7 à l'arrêt sur la fente (celle de la location) : la main de l'atelier a été posée sur elle -----
applique_etat(0.0)                       # robot au repos, clapet fermé, afficheur au repos
K7_ARRET = Vector((L(_FX), YB + 0.105 - 0.109, _FZ))
K7_ROT = (0.0, math.radians(-90.0), 0.0)
K7.location, K7.rotation_euler = K7_ARRET, K7_ROT
bpy.context.view_layer.update()

# ----- la main et la manche, venues de l'atelier -----
_ATELIER = _ICI / 'main' / 'atelier-main.blend'
with bpy.data.libraries.load(str(_ATELIER), link=False) as (_src, _dst):
    _dst.objects = [n for n in _src.objects if n in ('main_arm', 'main_peau', 'manche', 'pivot_main')]
_TEX = _ICI / 'main' / 'textures'
for _im in bpy.data.images:              # les chemins de l'atelier pointent vers son ancien dossier
    if _im.filepath and not Path(bpy.path.abspath(_im.filepath)).exists() and (_TEX / Path(_im.filepath).name).exists():
        _im.filepath = str(_TEX / Path(_im.filepath).name)
O = visiteur.origine(K7)
MAIN = bpy.data.objects.new('main_groupe', None)
scene.collection.objects.link(MAIN)
MAIN.location = O
PRISE = bpy.data.objects.new('main_prise', None)      # la main dans sa prise : de la pose « porte » à la pose « pousse »
scene.collection.objects.link(PRISE)
PRISE.parent = MAIN
for _o in _dst.objects:
    scene.collection.objects.link(_o)
    if _o.parent is None:
        _o.parent = PRISE
PEAU, MANCHE = bpy.data.objects['main_peau'], bpy.data.objects['manche']
visiteur.corps(scene, O)
visiteur.lampadaire(scene, O, main=(PEAU, MANCHE, K7))      # le complément éclaire aussi la K7, comme sur l'image fixe validée
bpy.context.view_layer.update()
# ENREGISTRE=<fichier.blend> : la scène prête (borne, K7 à l'arrêt, main de l'atelier, visiteur, lampadaire), sans
# geste ni rendu — pour poser et animer la main à vue dans le Blender ouvert (MCP).
if os.environ.get('ENREGISTRE'):
    import json  # noqa: E402
    Path(os.environ['ENREGISTRE']).with_suffix('.json').write_text(json.dumps({
        'cam0': [L(_EX), -_D_REF * _HE / _HB, _EZ], 'YB': YB, 'FX': L(_FX), 'FZ': _FZ, 'EX': L(_EX), 'EZ': _EZ,
        'O': list(O), 'k7_arret': list(K7_ARRET), 'ips': IPS}, indent=1))
    bpy.ops.wm.save_as_mainfile(filepath=os.environ['ENREGISTRE'])
    print('ENREGISTRÉ', os.environ['ENREGISTRE'], flush=True)
    raise SystemExit(0)

# ----- la prise : la main porte la K7 par son coin avant droit, pouce dessus, index et majeur dessous -----
# Rusmir, 26/11 : « la prise en main de la K7 n'est pas réaliste, elle flotte dans l'air » — la pose de l'atelier ne
# fait que pousser du bout des doigts. Réglée au banc (main/prise.py) ; coordonnées de l'atelier (O, voir visiteur.py).
ARM = bpy.data.objects['main_arm']
PRISE_D = Vector((-0.015, 0.08, 0.0))         # la main glisse vers la K7…
PRISE_ROUL = -90.0                            # … et tourne sur l'avant-bras : pouce en haut
PRISE_IK = {'thumb_03.R': (0.02, -0.032, 0.0155), 'index_03.R': (0.0, -0.03, -0.0155), 'middle_03.R': (0.025, -0.027, -0.0155)}
bpy.context.view_layer.update()
_poignet = PRISE.matrix_world.inverted() @ ARM.matrix_world @ ARM.pose.bones['pulse.R'].head
M_PORTE = (Matrix.Translation(PRISE_D + _poignet)
           @ Matrix.Rotation(math.radians(PRISE_ROUL), 4, (Vector(visiteur.COUDE) - _poignet).normalized())
           @ Matrix.Translation(-_poignet))
POUSSE_BASE = {pb.name: pb.matrix_basis.copy() for pb in ARM.pose.bones}
PRISE.matrix_basis = M_PORTE
bpy.context.view_layer.update()
_cibles = []
for _n, _c in PRISE_IK.items():
    _e = bpy.data.objects.new('ik_' + _n, None)
    scene.collection.objects.link(_e)
    _e.location = O + Vector(_c)
    _k = ARM.pose.bones[_n].constraints.new('IK')
    _k.target, _k.chain_count = _e, 3
    _cibles.append(_e)
bpy.context.view_layer.update()
PORTE_BASE = {pb.name: ARM.convert_space(pose_bone=pb, matrix=pb.matrix, from_space='POSE', to_space='LOCAL') for pb in ARM.pose.bones}
for _n in PRISE_IK:
    _pb = ARM.pose.bones[_n]
    _pb.constraints.remove(_pb.constraints[-1])
for _e in _cibles:
    bpy.data.objects.remove(_e)
for _pb in ARM.pose.bones:
    _pb.rotation_mode = 'QUATERNION'


def melange(a, b, w):
    """Entre deux matrices : positions mêlées, rotations par le plus court chemin."""
    la, ra, _ = a.decompose()
    lb, rb, _ = b.decompose()
    return la.lerp(lb, w), ra.slerp(rb, w)


# ----- le geste -----
_AXE = Vector(visiteur.COUDE).normalized()     # la main recule le long de l'avant-bras, vers le coude (en haut à droite)
DEHORS = 0.11                                  # la K7 entière hors de la fente : la main la porte jusque-là
ENFONCE = 0.05                                 # puis la pousse du bout des doigts au-delà de l'arrêt de la location
AVALEE = 0.30                                  # les rouleaux la tirent jusque-là, derrière le clapet
VIENT = [(1.2, 0.45), (2.3, 0.0)]              # la main arrive le long de l'avant-bras (0,45 m : hors du cadre)
POUSSE = [(2.3, -DEHORS), (3.0, 0.0), (3.4, 0.0), (3.8, ENFONCE)]   # elle l'engage, la lâche, la pousse
LACHE = [(3.0, 0.0), (3.4, 1.0)]               # de la prise à la pose qui pousse (0 : porte, 1 : pousse)
AVALE = [(3.95, 0.0), (4.2, AVALEE - ENFONCE)]
REPART = [(4.0, 0.0), (4.7, 0.55)]
CLAPET = [(0.9, 0.0), (1.25, 1.0), (4.35, 1.0), (4.6, 0.0)]
RECUE = (3.85, 5.3)                            # l'afficheur écrit « K7 REÇUE »


def geste(t):
    """(décalage de la main, décalage de la K7, prise de 0 à 1) à l'instant t, par rapport à la pose de l'atelier."""
    y, v = piste(POUSSE, t), piste(VIENT, t)
    if t < REPART[0][0]:
        main = _AXE * v + Vector((0, y, 0))
    else:
        main = _AXE * piste(REPART, t) + Vector((0, ENFONCE - 0.02 * lisse((t - REPART[0][0]) / 0.2), 0))
    k7 = _AXE * v + Vector((0, y + piste(AVALE, t), 0))
    return main, k7, piste(LACHE, t)


# ----- l'appareil : il garde sa hauteur, recule et s'incline vers la fente, puis revient -----
_Y0 = -_D_REF * _HE / _HB                      # l'image 0 du film de location
_DIST0 = YB - _Y0
_DIST1 = 1.59                                  # cadre d'environ 0,62 m de haut sur la fente, inclinaison ~17°
_CIBLE = (_FX, 0.95)                           # le centre du cadre de l'image fixe validée (cadrage de l'arrêt de la location)
VUE = [(0.15, 0.0), (1.2, 1.0), (4.8, 1.0), (6.0, 0.0)]


def appareil_retour(t):
    v = piste(VUE, t)
    x = _EX + (_CIBLE[0] - _EX) * v
    d = _DIST0 + (_DIST1 - _DIST0) * v
    cz = _EZ + (_CIBLE[1] - _EZ) * v
    cam.location = (L(x), YB - d, _EZ)
    vise = Vector((L(x), YB, cz))
    cam.rotation_euler = (vise - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.shift_x = cam_data.shift_y = 0.0
    return (vise - cam.location).length


# Toute l'animation en images clés (une par image, linéaires) : le flou de bougé de Cycles en a besoin.
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
for _i in range(N_RETOUR):
    _t = _i / IPS
    _m, _k, _w = geste(_t)
    MAIN.location = O + _m
    K7.location = K7_ARRET + _k
    _l, _r = melange(M_PORTE, Matrix.Identity(4), _w)
    PRISE.location, PRISE.rotation_mode, PRISE.rotation_quaternion = _l, 'QUATERNION', _r
    PRISE.keyframe_insert('location', frame=_i)
    PRISE.keyframe_insert('rotation_quaternion', frame=_i)
    for _pb in ARM.pose.bones:
        _pb.location, _pb.rotation_quaternion = melange(PORTE_BASE[_pb.name], POUSSE_BASE[_pb.name], _w)
        _pb.keyframe_insert('location', frame=_i)
        _pb.keyframe_insert('rotation_quaternion', frame=_i)
    VOLET.rotation_euler = (math.radians(86.0) * piste(CLAPET, _t), 0, 0)
    appareil_retour(_t)
    for _o, _c in ((MAIN, 'location'), (K7, 'location'), (VOLET, 'rotation_euler'), (cam, 'location'), (cam, 'rotation_euler')):
        _o.keyframe_insert(_c, frame=_i)
scene.frame_start, scene.frame_end = 0, N_RETOUR - 1
scene.render.fps = IPS
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
_AFF_IMAGES['recue'] = bpy.data.images.load(str(_AFF_DOSSIER / 'afficheur-recue.png'), check_existing=True)
_AFF_IMAGES['recue'].colorspace_settings.name = _AFF.image.colorspace_settings.name

if _LISTE_IMAGES:
    if '-' in _LISTE_IMAGES:
        _d, _f2 = (int(v) for v in _LISTE_IMAGES.split('-'))
        _CHOIX_R = list(range(_d, _f2 + 1))
    else:
        _CHOIX_R = [int(v) for v in _LISTE_IMAGES.split(',')]
else:
    _CHOIX_R = list(range(N_RETOUR))
print('RETOUR', N_RETOUR, 'images | O', tuple(round(v, 3) for v in O), '| sortie', SORTIE, flush=True)
for _i in _CHOIX_R:
    _t = _i / IPS
    scene.frame_set(_i)
    _AFF.image = _AFF_IMAGES['recue' if RECUE[0] <= _t < RECUE[1] else 'repos']
    if _PHOTO:
        cam_data.dof.focus_distance = appareil_retour(_t)
    scene.render.filepath = str(SORTIE / f'img_{_i:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('IMAGE', _i, round(_t, 3), flush=True)
print('FINI retour', len(_CHOIX_R))
