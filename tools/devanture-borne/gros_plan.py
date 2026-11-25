"""Gros plan Cycles d'une zone de la façade, avec la scène de borne.py (pour juger l'usure de près).

blender -b --factory-startup -P gros_plan.py -- <echantillons> <sortie.png> <x_local> <z> <distance_m> [mur]
"""
import math
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
ICI = Path(__file__).resolve().parent
xl, z, dist = float(args[2]), float(args[3]), float(args[4])
src = (ICI / 'borne.py').read_text().replace("bpy.ops.render.render(write_still=True)", "pass")
g = {'__name__': '__borne__', '__file__': str(ICI / 'borne.py')}
exec(compile(src, str(ICI / 'borne.py'), 'exec'), g)
scene = bpy.context.scene
if len(args) > 5 and args[5] == 'mur':
    # Gros plan de l'enseigne : le mur prend sa vraie matière et le réverbère est posé. Les lampes d'ambiance sont de
    # grands rectangles qui tiennent lieu d'enseignes : on leur interdit de se refléter (elles éclairent toujours).
    g['murs_reels']()
    # Dans l'image finale le mur est celui de la photo, presque noir : seuls le néon et le réverbère l'éclairent. Ici
    # on retire donc le mur de ce que les lampes d'ambiance éclairent (sinon sa peinture bleue sort bleu électrique).
    eclaires = bpy.data.collections.new('eclaires_par_l_ambiance')
    for ob in scene.objects:
        if ob.type in ('MESH', 'CURVE') and not ob.name.startswith('mur_'):
            eclaires.objects.link(ob)
    for ob in scene.objects:
        if ob.type == 'LIGHT':
            ob.visible_glossy = False
            try:
                ob.light_linking.receiver_collection = eclaires
            except Exception as err:                       # pas de liaison de lumière : on baisse l'ambiance
                print('LIAISON indisponible', err)
                ob.data.energy *= 0.05
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.15
    g['pose_reverbere']()
scene.render.use_border = False
scene.render.film_transparent = False
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.015, 0.03, 1)
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
cam = scene.camera
cam.data.shift_x = cam.data.shift_y = 0.0
cam.data.sensor_fit = 'AUTO'
cam.data.lens = 50
cam.location = (g['L'](xl) - 0.06, g['FRONT'] - dist, z + 0.08)
cam.rotation_euler = (math.radians(84), 0, math.radians(-7))
scene.render.filepath = args[1]
bpy.ops.render.render(write_still=True)
