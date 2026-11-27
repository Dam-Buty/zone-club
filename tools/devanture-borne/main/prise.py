"""Banc de pose de la main dans l'atelier (main/atelier-main.blend) : la K7 à l'arrêt de la fente, la main posée par
un réglage JSON, trois vues (visiteur, côté, dessous). Sert à régler la prise de la K7 avant le film de retour.

blender -b --factory-startup main/atelier-main.blend -P main/prise.py -- <sortie.png> '<json>'
JSON : {"d": [dx, dy, dz] (déplacement de la main, m), "r": [rx, ry, rz] (rotation de la main autour du poignet, °),
        "os": {"<os>": [rx, ry, rz] (°, s'ajoute à la pose de l'atelier)}, "k7": [dx, dy, dz]}
Imprime les points utiles (bouts des doigts, du pouce) et leur position par rapport à la K7.
"""
import json
import math
import sys

import bpy
from mathutils import Euler, Matrix, Vector

_a = sys.argv[sys.argv.index('--') + 1:]
SORTIE, R = _a[0], json.loads(_a[1])
scene = bpy.context.scene
arm, piv, k7 = bpy.data.objects['main_arm'], bpy.data.objects['pivot_main'], bpy.data.objects['k7_atelier']
k7.location += Vector(R.get('k7', (0, 0, 0)))
TEX = __import__('pathlib').Path(bpy.path.abspath('//textures'))
for im in bpy.data.images:          # l'atelier a été déplacé : ses textures sont dans main/textures
    if im.filepath and (TEX / __import__('pathlib').Path(im.filepath).name).exists():
        im.filepath = str(TEX / __import__('pathlib').Path(im.filepath).name)
for n, rot in R.get('os', {}).items():
    b = arm.pose.bones[n]
    b.rotation_mode = 'XYZ'
    b.rotation_euler = Euler([b.rotation_euler[i] + math.radians(rot[i]) for i in range(3)])
bpy.context.view_layer.update()
poignet = arm.matrix_world @ arm.pose.bones['pulse.R'].head
rot = Euler([math.radians(v) for v in R.get('r', (0, 0, 0))]).to_matrix().to_4x4()
if R.get('roul'):     # la main tourne sur l'axe de l'avant-bras (du poignet vers le coude du visiteur)
    COUDE = Vector((0.308, -0.26, 0.266))
    rot = Matrix.Rotation(math.radians(R['roul']), 4, (COUDE - poignet).normalized()) @ rot
M = Matrix.Translation(Vector(R.get('d', (0, 0, 0))) + poignet) @ rot @ Matrix.Translation(-poignet)
piv.matrix_world = M @ piv.matrix_world
manche = bpy.data.objects['manche']
manche.matrix_world = M @ manche.matrix_world
bpy.context.view_layer.update()
# Prise : chaque doigt nommé va toucher son point (cinématique inverse sur les trois phalanges).
for n, cible_ik in R.get('ik', {}).items():
    e = bpy.data.objects.new('ik_' + n, None)
    scene.collection.objects.link(e)
    e.location = cible_ik
    c = arm.pose.bones[n].constraints.new('IK')
    c.target, c.chain_count = e, 3
bpy.context.view_layer.update()

vs = [k7.matrix_world @ v.co for v in k7.data.vertices]
kb = [(min(v[i] for v in vs), max(v[i] for v in vs)) for i in range(3)]
print('K7', [tuple(round(c, 3) for c in b) for b in kb])
for n in ('thumb_03.R', 'index_03.R', 'middle_03.R', 'ring_03.R', 'pinky_03.R'):
    p = arm.matrix_world @ arm.pose.bones[n].tail
    print('BOUT', n, tuple(round(c, 3) for c in p), '| au-dessus du dessus', round(p.z - kb[2][1], 3),
          '| sous le dessous', round(kb[2][0] - p.z, 3), '| devant la face', round(kb[1][0] - p.y, 3))

if R.get('sans_rendu'):
    raise SystemExit(0)
scene.render.resolution_x = scene.render.resolution_y = 560
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
cible = Vector(R.get('vise', (0.06, -0.05, 0.0)))
vues = {'visiteur': Vector((0.12, -0.45, 0.35)), 'cote': Vector((0.45, -0.12, 0.02)), 'dessous': Vector((0.1, -0.3, -0.22))}
cd = bpy.data.cameras.new('banc')
cd.lens = 50
cam = bpy.data.objects.new('banc', cd)
scene.collection.objects.link(cam)
scene.camera = cam
fichiers = []
for nom, pos in vues.items():
    cam.location = cible + pos
    cam.rotation_euler = (cible - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = 50 if nom != 'visiteur' else 40
    scene.render.filepath = f'{SORTIE}_{nom}.png'
    bpy.ops.render.render(write_still=True)
    fichiers.append(scene.render.filepath)
print('VUES', ' '.join(fichiers))
