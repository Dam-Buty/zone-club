"""Recharge borne.py dans le Blender INTERACTIF (via le MCP), sans toucher aux préférences.

borne.py commence par read_factory_settings, qui remettrait aussi les préférences à zéro et couperait le
module MCP : on le remplace par un vidage des datablocks, et le rendu final par rien. La photo de fond est
posée en arrière-plan de la caméra et la vue 3D passe en vue caméra.

Usage depuis le MCP :  exec(compile(open(CHEMIN).read(), CHEMIN, 'exec'), {'__file__': CHEMIN})   (CHEMIN = ce fichier)
"""
import sys
from pathlib import Path

import bpy

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))
from variante import D  # noqa: E402 — la variante en cours (variable DEVANTURE)
src = (ICI / 'borne.py').read_text()
assert src.count("bpy.ops.wm.read_factory_settings(use_empty=True)") == 1
assert src.count("bpy.ops.render.render(write_still=True)") == 1
RESET = """
for _coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
              bpy.data.images, bpy.data.worlds, bpy.data.node_groups, bpy.data.curves):
    for _it in list(_coll):
        _coll.remove(_it)
for _c in list(bpy.data.collections):
    bpy.data.collections.remove(_c)
"""
src = src.replace("bpy.ops.wm.read_factory_settings(use_empty=True)", RESET)
src = src.replace("bpy.ops.render.render(write_still=True)", "pass")
_argv = sys.argv
sys.argv = ['blender', '--', '48', str(D / 'borne-apercu.png')]
try:
    exec(compile(src, str(ICI / 'borne.py'), 'exec'), {'__name__': '__borne__', '__file__': str(ICI / 'borne.py')})
finally:
    sys.argv = _argv

cam = bpy.context.scene.camera
cam.data.show_background_images = True
bi = cam.data.background_images.new()
bi.image = bpy.data.images.load(str(D / 'fond.png'))
bi.display_depth = 'BACK'
bi.frame_method = 'FIT'
for win in bpy.context.window_manager.windows:
    for area in win.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(D / 'borne.blend'))
