"""Devanture mobile avec la borne : la borne sous Blender, calée sur la vue mobile reculée.

blender -b --factory-startup -P borne.py -- <echantillons> [<sortie.png> [borne|mur|masque]]
Repère : X vers la droite (0 = centre de la porte), Y vers le mur (mur en Y = 0), Z vers le haut
(0 = sol). 1 unité = 1 m. Échelle et position tirées de travail/repere.json (fond.py).
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))         # Blender ne connaît pas le dossier du script
from variante import D, G, SOURCES  # noqa: E402 — la variante en cours : sa géométrie, son dossier d'intermédiaire
SAMPLES = int(args[0]) if len(args) > 0 else 64
OUT = args[1] if len(args) > 1 else str(D / 'borne.png')
# 'borne' : la borne sur fond transparent (et la mise en page lue par le site) ; 'mur' : la lumière que le mur renvoie
# (voir « passe mur » plus bas) ; 'masque' : la borne en aplats, pour le masque de reflets de la devanture animée du
# bureau. Le film d'approche rend ces mêmes passes image par image (approche_rendu.py).
PASSE = args[2] if len(args) > 2 else 'borne'
R = json.loads((D / 'repere.json').read_text())
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
T = D / 'tex'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

# ----- rendu -----
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == 'METAL'
scene.cycles.device = 'GPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.use_border = True
scene.render.use_crop_to_border = False
kx0, kx1 = R['kiosk_left_x'], R['kiosk_right_x']
top_y = R['ground_y'] - G['borne']['hauteur_m'] * PPM
ECH = PPM / 549                      # les marges en pixels ont été réglées sur la vue mobile (549 px/m)
scene.render.border_min_x = max(0.0, (kx0 - 70 * ECH) / W)
scene.render.border_max_x = min(1.0, (kx1 + 130 * ECH) / W)
scene.render.border_min_y = 0.0
scene.render.border_max_y = min(1.0, (H - (top_y - 330 * ECH)) / H)

# ----- monde : nuit, ciel de pluie -----
world = bpy.data.worlds.new('nuit')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.010, 0.013, 0.026, 1)
bg.inputs['Strength'].default_value = 1.0

# ----- caméra calée sur la photo -----
cam_d = G['camera']['distance_mur_m']
eye = G['camera']['hauteur_oeil_m']
frame_h_m = H / PPM
cam_data = bpy.data.cameras.new('camera')
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_height = 36
cam_data.lens = 36 * cam_d / frame_h_m
center_z = (R['ground_y'] - H / 2) / PPM
AXE = G['camera'].get('axe_px', R['door_center_x'])     # colonne de l'image que vise l'appareil (mobile : la porte)
cam_data.shift_x = (W / 2 - AXE) / H
cam_data.shift_y = (center_z - eye) / frame_h_m
cam_data.clip_end = 100
cam = bpy.data.objects.new('camera', cam_data)
scene.collection.objects.link(cam)
cam.location = ((AXE - R['door_center_x']) / PPM, -cam_d, eye)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam


# ----- matières -----
def principled(name, **v):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    for k, val in v.items():
        if k in p.inputs:
            p.inputs[k].default_value = val
    return m


def image(path, colorspace='sRGB'):
    img = bpy.data.images.load(str(path))
    img.colorspace_settings.name = colorspace
    return img


def tex_node(mat, img, coords='UV', box=False, scale=1.0):
    nt = mat.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    if box:
        t.projection = 'BOX'
        t.projection_blend = 0.25
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if scale != 1.0:
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (scale, scale, scale)
        nt.links.new(tc.outputs['Object' if coords == 'Object' else 'UV'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
    else:
        nt.links.new(tc.outputs['Object' if coords == 'Object' else 'UV'], t.inputs['Vector'])
    return t


def math_node(nt, op, a=None, b=None, clamp=True):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def mix_rgb(nt, fac, c1, c2, blend='MIX'):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for idx, v in ((0, fac), (6, c1), (7, c2)):
        if isinstance(v, (int, float)):
            n.inputs[idx].default_value = v
        elif isinstance(v, tuple):
            n.inputs[idx].default_value = v
        else:
            bpy.context  # noqa
            mat_links = nt.links
            mat_links.new(v, n.inputs[idx])
    return n.outputs[2]


F = G['facade']
KW_, KH_ = G['borne']['largeur_m'], G['borne']['hauteur_m']
X_LEFT = (((kx0 + kx1) / 2) - R['door_center_x']) / PPM - KW_ / 2
usure = image(T / 'usure-facade.png', 'Non-Color')


def lerp(nt, f, a, b):
    """a si f = 0, b si f = 1 (scalaires)."""
    return math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', a, math_node(nt, 'SUBTRACT', 1.0, f), clamp=False),
                     math_node(nt, 'MULTIPLY', b, f, clamp=False), clamp=False)


def facade_maps(nt):
    """Carte d'usure de la façade (R rayure profonde, G éraflure, B gras) et masque des faces tournées vers la rue."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', sep.outputs['X'], X_LEFT, clamp=False), 1 / KW_, clamp=False), comb.inputs['X'])
    nt.links.new(math_node(nt, 'MULTIPLY', sep.outputs['Z'], 1 / KH_, clamp=False), comb.inputs['Y'])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = usure
    t.extension = 'CLIP'
    nt.links.new(comb.outputs['Vector'], t.inputs['Vector'])
    sc_ = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(t.outputs['Color'], sc_.inputs['Color'])
    geo_ = nt.nodes.new('ShaderNodeNewGeometry')
    sn = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo_.outputs['Normal'], sn.inputs[0])
    front = math_node(nt, 'LESS_THAN', sn.outputs['Y'], -0.5)
    return sc_.outputs['Red'], sc_.outputs['Green'], sc_.outputs['Blue'], front


rayures = image(T / 'rayures.png', 'Non-Color')
coulures = image(T / 'coulures.png', 'Non-Color')
crasse = image(T / 'crasse.png', 'Non-Color')

# Peinture de la carrosserie : bleu nuit presque noir, mouillée par la pluie (vernis d'eau), rayée,
# écaillée aux arêtes jusqu'au métal, coulures et crasse.
paint = principled('peinture', **{'Roughness': 0.4, 'Coat Weight': 0.55, 'Coat Roughness': 0.08})
nt = paint.node_tree
p = nt.nodes['Principled BSDF']
side_sc = tex_node(paint, rayures, 'Object', box=True, scale=1.0).outputs['Color']
f_deep, f_scuff, f_grease, f_front = facade_maps(nt)
sc = lerp(nt, f_front, math_node(nt, 'MULTIPLY', side_sc, 0.35), f_deep)
scuff_ = math_node(nt, 'MULTIPLY', f_scuff, f_front)
grease_ = math_node(nt, 'MULTIPLY', f_grease, f_front)
st = tex_node(paint, coulures, 'Object', box=True, scale=0.9).outputs['Color']
gr = tex_node(paint, crasse, 'Object', box=True, scale=0.7).outputs['Color']
bev = nt.nodes.new('ShaderNodeBevel')
bev.inputs['Radius'].default_value = 0.006
geo = nt.nodes.new('ShaderNodeNewGeometry')
dot = nt.nodes.new('ShaderNodeVectorMath')
dot.operation = 'DOT_PRODUCT'
nt.links.new(bev.outputs['Normal'], dot.inputs[0])
nt.links.new(geo.outputs['Normal'], dot.inputs[1])
edge = math_node(nt, 'SUBTRACT', 1.0, dot.outputs['Value'])
edge = math_node(nt, 'MULTIPLY', edge, 9.0)
edge = math_node(nt, 'MULTIPLY', edge, math_node(nt, 'GREATER_THAN', gr, 0.42))
scr = math_node(nt, 'MULTIPLY', sc, 0.9)
wearm = math_node(nt, 'MAXIMUM', scr, math_node(nt, 'MULTIPLY', edge, 0.6))
c = mix_rgb(nt, wearm, (0.020, 0.024, 0.036, 1), (0.30, 0.30, 0.31, 1))
c = mix_rgb(nt, math_node(nt, 'MULTIPLY', st, 0.35), c, (0.10, 0.11, 0.13, 1))
c = mix_rgb(nt, math_node(nt, 'MULTIPLY', scuff_, 0.8), c, (0.11, 0.12, 0.14, 1))
c = mix_rgb(nt, math_node(nt, 'MULTIPLY', grease_, 0.5), c, (0.010, 0.012, 0.018, 1))
c = mix_rgb(nt, 1.0, c, mix_rgb(nt, gr, (0.75, 0.75, 0.75, 1), (1.1, 1.1, 1.1, 1)), 'MULTIPLY')
nt.links.new(c, p.inputs['Base Color'])
nt.links.new(math_node(nt, 'MULTIPLY', wearm, 0.95), p.inputs['Metallic'])
rough = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', gr, 0.3), 0.28)
rough = math_node(nt, 'ADD', rough, math_node(nt, 'MULTIPLY', sc, 0.25))
rough = math_node(nt, 'ADD', rough, math_node(nt, 'MULTIPLY', scuff_, 0.25))
rough = math_node(nt, 'SUBTRACT', rough, math_node(nt, 'MULTIPLY', grease_, 0.18))
nt.links.new(rough, p.inputs['Roughness'])
nt.links.new(math_node(nt, 'SUBTRACT', 0.7, math_node(nt, 'MULTIPLY', st, 0.5)), p.inputs['Coat Weight'])
bump = nt.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.25
bump.inputs['Distance'].default_value = 0.0004
nt.links.new(math_node(nt, 'MAXIMUM', sc, math_node(nt, 'MULTIPLY', scuff_, 0.4)), bump.inputs['Height'])
nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])

interior = principled('interieur', **{'Base Color': (0.012, 0.012, 0.014, 1), 'Roughness': 0.8})
plastic = principled('plastique', **{'Base Color': (0.010, 0.010, 0.011, 1), 'Roughness': 0.32, 'Coat Weight': 0.4, 'Coat Roughness': 0.1})
pnt = plastic.node_tree
pp = pnt.nodes['Principled BSDF']
p_deep, p_scuff, p_grease, _pf = facade_maps(pnt)
p_marks = math_node(pnt, 'MAXIMUM', math_node(pnt, 'MULTIPLY', p_deep, 0.9), math_node(pnt, 'MULTIPLY', p_scuff, 0.7))
pnt.links.new(mix_rgb(pnt, p_marks, (0.010, 0.010, 0.011, 1), (0.13, 0.13, 0.135, 1)), pp.inputs['Base Color'])
p_rough = math_node(pnt, 'ADD', 0.32, math_node(pnt, 'MULTIPLY', p_marks, 0.35))
pnt.links.new(math_node(pnt, 'SUBTRACT', p_rough, math_node(pnt, 'MULTIPLY', p_grease, 0.15)), pp.inputs['Roughness'])
p_bump = pnt.nodes.new('ShaderNodeBump')
p_bump.inputs['Strength'].default_value = 0.2
p_bump.inputs['Distance'].default_value = 0.0003
pnt.links.new(p_marks, p_bump.inputs['Height'])
pnt.links.new(p_bump.outputs['Normal'], pp.inputs['Normal'])
case_plastic = principled('boitier_k7', **{'Base Color': (0.02, 0.02, 0.022, 1), 'Roughness': 0.3})
# Vitre de 4 mm vue comme une feuille mince : elle laisse passer la lumière sans la dévier et réfléchit selon
# l'angle (Fresnel). Un plan unique en transmission « pleine » se comporte comme l'entrée d'un bloc de verre.
glass = bpy.data.materials.new('vitre')
glass.use_nodes = True
gnt = glass.node_tree
gnt.nodes.remove(gnt.nodes['Principled BSDF'])
smudge = tex_node(glass, crasse, 'Object', box=True, scale=2.3).outputs['Color']
fres = gnt.nodes.new('ShaderNodeFresnel')
fres.inputs['IOR'].default_value = 1.52
tr = gnt.nodes.new('ShaderNodeBsdfTransparent')
tr.inputs['Color'].default_value = (0.90, 0.94, 0.93, 1)
gl = gnt.nodes.new('ShaderNodeBsdfAnisotropic')
gnt.links.new(math_node(gnt, 'ADD', math_node(gnt, 'MULTIPLY', smudge, 0.03), 0.01), gl.inputs['Roughness'])
mx = gnt.nodes.new('ShaderNodeMixShader')
gnt.links.new(math_node(gnt, 'ADD', fres.outputs['Fac'], 0.02), mx.inputs['Fac'])
gnt.links.new(tr.outputs['BSDF'], mx.inputs[1])
gnt.links.new(gl.outputs['BSDF'], mx.inputs[2])
haze = gnt.nodes.new('ShaderNodeBsdfDiffuse')
haze.inputs['Color'].default_value = (0.5, 0.5, 0.52, 1)
mx2 = gnt.nodes.new('ShaderNodeMixShader')
gnt.links.new(math_node(gnt, 'MULTIPLY', smudge, 0.04), mx2.inputs['Fac'])
gnt.links.new(mx.outputs['Shader'], mx2.inputs[1])
gnt.links.new(haze.outputs['BSDF'], mx2.inputs[2])
gnt.links.new(mx2.outputs['Shader'], gnt.nodes['Material Output'].inputs['Surface'])
if hasattr(glass, 'surface_render_method'):
    glass.surface_render_method = 'BLENDED'          # le tramage donnait un grain « craquelé » dans l'aperçu EEVEE
chrome = principled('chrome', **{'Base Color': (0.7, 0.7, 0.72, 1), 'Metallic': 1.0, 'Roughness': 0.25})


def emissive(name, img=None, color=(1, 1, 1, 1), strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Strength'].default_value = strength
    if img is not None:
        t = tex_node(m, img)
        nt.links.new(t.outputs['Color'], e.inputs['Color'])
    else:
        e.inputs['Color'].default_value = color
    nt.links.new(e.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
    return m


def sticker_mat(name, path):
    m = principled(name, **{'Roughness': 0.5, 'Coat Weight': 0.3, 'Coat Roughness': 0.15})
    t = tex_node(m, image(path))
    nt = m.node_tree
    nt.links.new(t.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.links.new(t.outputs['Alpha'], nt.nodes['Principled BSDF'].inputs['Alpha'])
    return m


# ----- géométrie -----
KX = (((kx0 + kx1) / 2) - R['door_center_x']) / PPM
B = G['borne']
KW, KD, KH = B['largeur_m'], B['profondeur_m'], B['hauteur_m']
# Encastrée dans le mur (Rusmir, 18/11/2026) : seule la saillie dépasse du mur (plan Y = 0) ; le corps continue
# derrière, sur toute sa profondeur.
SAILLIE = B.get('saillie_m', KD)
FRONT = -SAILLIE
VIT_G_DEPTH = 0.32          # grande vitrine : 15 cm libres devant le casier, pour le robot


def box(name, x0, x1, y0, y1, z0, z1, mat, coll=scene.collection):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0)
        v.co.y = y0 + (v.co.y + 0.5) * (y1 - y0)
        v.co.z = z0 + (v.co.z + 0.5) * (z1 - z0)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def plane(name, cx, y, cz, w, h, mat, rot_deg=0.0, normal='-Y'):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    hw, hh = w / 2, h / 2
    a, b_ = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    pts = []
    for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        lx, lz = u * hw, v * hh
        rx, rz = lx * a - lz * b_, lx * b_ + lz * a
        if normal == '-Y':
            pts.append((cx + rx, y, cz + rz))
        else:  # '+X' : sur le flanc droit, rx porte sur Y
            pts.append((cx, y + rx, cz + rz))
    verts = [bm.verts.new(p_) for p_ in pts]
    f = bm.faces.new(verts)
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


# Mur : il ne garde que les ombres de la borne (« attrape-ombres »).
# Il est percé à l'emplacement de la borne, qui le traverse.
wall_mat = principled('mur', **{'Base Color': (0.004, 0.006, 0.014, 1), 'Roughness': 0.7})
for wname, wx0, wx1, wz0, wz1 in (('mur_g', KX - 2.4, KX - KW / 2, 0.0, 5.2), ('mur_d', KX + KW / 2, KX + 3.6, 0.0, 5.2),
                                  ('mur_h', KX - KW / 2, KX + KW / 2, KH, 5.2)):
    wpart = plane(wname, (wx0 + wx1) / 2, 0.0, (wz0 + wz1) / 2, wx1 - wx0, wz1 - wz0, wall_mat)
    wpart.is_shadow_catcher = True
# Collerette d'encastrement : une cornière peinte qui couvre le joint entre le mur et la borne.
for cname, cx0, cx1, cz0, cz1 in (('collerette_g', KX - KW / 2 - 0.022, KX - KW / 2 + 0.001, 0.0, KH + 0.022),
                                  ('collerette_d', KX + KW / 2 - 0.001, KX + KW / 2 + 0.022, 0.0, KH + 0.022),
                                  ('collerette_h', KX - KW / 2 - 0.022, KX + KW / 2 + 0.022, KH - 0.001, KH + 0.022)):
    cbv = box(cname, cx0, cx1, -0.005, 0.0, cz0, cz1, paint).modifiers.new('arrondi', 'BEVEL')
    cbv.width = 0.002
    cbv.segments = 2

cutters = bpy.data.collections.new('decoupes')
scene.collection.children.link(cutters)
body = box('borne', KX - KW / 2, KX + KW / 2, FRONT, FRONT + KD, 0.0, KH, paint)
L = lambda x: KX + x  # noqa: E731 — abscisse locale → monde
recesses = [
    ('vitrine_g', *F['vitrine_g'], VIT_G_DEPTH, interior),
    ('boitier', *F['boitier'], 0.02, plastic),
    ('vitrine_d', *F['vitrine_d'], 0.22, interior),
    ('bandeau', *F['bandeau'], 0.015, plastic),
    ('fente', *F['fente'], 0.08, interior),
]
for name, x0, x1, z0, z1, depth, mat in recesses:
    cut = box('cut_' + name, L(x0), L(x1), FRONT - 0.05, FRONT + depth, z0, z1, mat, cutters)
    cut.hide_render = True
    cut.hide_viewport = True
    mod = body.modifiers.new('trou_' + name, 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cut
    try:
        mod.solver = 'EXACT'
    except TypeError:
        pass
    try:
        mod.material_mode = 'TRANSFER'
    except (AttributeError, TypeError):
        pass
bevel = body.modifiers.new('arrondi', 'BEVEL')
bevel.width = 0.006
bevel.segments = 2
bevel.limit_method = 'ANGLE'

# Vitres des deux vitrines, légèrement en retrait.
from mathutils import Vector  # noqa: E402


def aim(ob, direction):
    """Tourne une lampe plane pour qu'elle éclaire dans `direction`, son grand côté le plus vertical possible."""
    ob.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()


for (x0, x1, z0, z1), deep in ((F['vitrine_g'], True), (F['vitrine_d'], False)):
    plane('vitre', L((x0 + x1) / 2), FRONT + 0.005, (z0 + z1) / 2, x1 - x0, z1 - z0, glass)
    # Tube fluorescent en haut de la vitrine, et la lumière qu'il donne aux tranches (inclinée vers le fond).
    box('tube', L(x0 + 0.01), L(x1 - 0.01), FRONT + 0.03, FRONT + 0.045, z1 - 0.025, z1 - 0.012, emissive('tube', color=(0.88, 0.93, 1.0, 1), strength=6))
    box('levre', L(x0), L(x1), FRONT, FRONT + 0.012, z1 - 0.045, z1, paint)
    lt = bpy.data.lights.new('eclairage_vitrine', 'AREA')
    lt.shape = 'RECTANGLE'
    lt.size, lt.size_y = x1 - x0 - 0.02, 0.03
    lt.energy = 9 if deep else 6
    lt.color = (0.9, 0.95, 1.0)
    lo = bpy.data.objects.new('eclairage_vitrine', lt)
    scene.collection.objects.link(lo)
    lo.location = (L((x0 + x1) / 2), FRONT + 0.06, z1 - 0.03)
    lo.rotation_euler = (math.radians(32 if deep else 12), 0, 0)
    if deep:
        # Grande vitrine : deux réglettes de diodes sur les joues, devant les tranches, qui les éclairent de biais.
        for side, xs in ((1, x0 + 0.004), (-1, x1 - 0.004)):
            box('reglette', L(xs - 0.002), L(xs + 0.002), FRONT + 0.118, FRONT + 0.128, z0 + 0.05, z1 - 0.07, emissive('reglette', color=(0.86, 0.93, 1.0, 1), strength=1.6))
            st_l = bpy.data.lights.new('reglette', 'AREA')
            st_l.shape = 'RECTANGLE'
            st_l.size, st_l.size_y = 0.008, z1 - z0 - 0.14
            st_l.energy = 3.5
            st_l.color = (0.88, 0.94, 1.0)
            so_l = bpy.data.objects.new('reglette', st_l)
            scene.collection.objects.link(so_l)
            so_l.location = (L(xs + side * 0.004), FRONT + 0.123, (z0 + z1) / 2 - 0.01)
            aim(so_l, (side, 0.9, 0.0))

# ----- Casiers : les K7 debout, bien droites, tranche vers la vitre (Rusmir, 17/11/2026) -----
import random  # noqa: E402
random.seed(5)
atlas = image(T / 'tranches.png')
spine = principled('tranche', **{'Roughness': 0.35, 'Coat Weight': 0.3})
st_ = tex_node(spine, atlas)
spine.node_tree.links.new(st_.outputs['Color'], spine.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
N_ATLAS = 96
acier = principled('acier', **{'Base Color': (0.5, 0.51, 0.5, 1), 'Metallic': 1.0, 'Roughness': 0.42})
ant = acier.node_tree
a_gr = tex_node(acier, crasse, 'Object', box=True, scale=6).outputs['Color']
ant.links.new(mix_rgb(ant, a_gr, (0.20, 0.20, 0.19, 1), (0.58, 0.59, 0.58, 1)), ant.nodes['Principled BSDF'].inputs['Base Color'])
ant.links.new(math_node(ant, 'ADD', 0.30, math_node(ant, 'MULTIPLY', a_gr, 0.3)), ant.nodes['Principled BSDF'].inputs['Roughness'])
reperes = principled('reperes', **{'Roughness': 0.6})
rp_t = tex_node(reperes, image(T / 'reperes.png'))
reperes.node_tree.links.new(rp_t.outputs['Color'], reperes.node_tree.nodes['Principled BSDF'].inputs['Base Color'])

K7_W, K7_H, K7_D = 0.026, 0.200, 0.118      # boîtier de location debout : tranche de 26 mm sur 20 cm
PITCH, ROW_PITCH = 0.031, 0.233             # pas des cases, pas des rangées


def add_box(bm_, x0, x1, y0, y1, z0, z1, mat_index=0):
    geom = bmesh.ops.create_cube(bm_, size=1.0)
    for v in geom['verts']:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0)
        v.co.y = y0 + (v.co.y + 0.5) * (y1 - y0)
        v.co.z = z0 + (v.co.z + 0.5) * (z1 - z0)
    faces = {f for v in geom['verts'] for f in v.link_faces}
    for f in faces:
        f.material_index = mat_index
    return faces


k7_count = {'k7': 0, 'vides': 0}


def rack(name, rect, y_front, first_row):
    """Un casier : tablettes à retour, peignes séparateurs, repères ; une K7 debout par case, quelques cases vides
    (les films loués). Rend ses cotes, dont le robot a besoin."""
    x0, x1, z0, z1 = rect
    n_slots = int((x1 - x0 - 0.06 + 1e-6) / PITCH)
    xa = (x0 + x1) / 2 - n_slots * PITCH / 2
    xb = xa + n_slots * PITCH
    # Rangées alignées par le haut : la plus haute s'arrête 1,5 cm sous la lèvre de la vitrine.
    rows = []
    zb_top = z1 - 0.045 - 0.015 - K7_H
    while zb_top >= z0 + 0.01:
        rows.append(zb_top)
        zb_top -= ROW_PITCH
    rows.reverse()
    bm_c, bm_k, bm_r = bmesh.new(), bmesh.new(), bmesh.new()
    uv_k, uv_r = bm_k.loops.layers.uv.new(), bm_r.loops.layers.uv.new()
    for r, zb in enumerate(rows):
        # tablette, et son retour avant qui retient les K7 et porte les repères
        add_box(bm_c, L(xa - 0.004), L(xb + 0.004), y_front - 0.006, y_front + K7_D + 0.004, zb - 0.004, zb)
        add_box(bm_c, L(xa - 0.004), L(xb + 0.004), y_front - 0.008, y_front - 0.006, zb - 0.004, zb + 0.012)
        # peigne : une lame entre deux cases, en retrait des tranches
        for s_ in range(n_slots + 1):
            xs = xa + s_ * PITCH
            add_box(bm_c, L(xs - 0.00075), L(xs + 0.00075), y_front + 0.012, y_front + K7_D, zb, zb + 0.085)
        vr = [bm_r.verts.new(c) for c in ((L(xa), y_front - 0.0083, zb + 0.001), (L(xb), y_front - 0.0083, zb + 0.001),
                                           (L(xb), y_front - 0.0083, zb + 0.011), (L(xa), y_front - 0.0083, zb + 0.011))]
        fr = bm_r.faces.new(vr)
        for loop, (u, v) in zip(fr.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv_r].uv = (u * n_slots / 13, 1 - (first_row + r + 1 - v) / 8)
        for s_ in range(n_slots):
            if random.random() < 0.14:
                k7_count['vides'] += 1
                continue
            xc = xa + (s_ + 0.5) * PITCH
            faces = add_box(bm_k, L(xc - K7_W / 2), L(xc + K7_W / 2), y_front, y_front + K7_D, zb + 0.0005, zb + 0.0005 + K7_H, 1)
            row = k7_count['k7'] % N_ATLAS
            for f in faces:
                f.normal_update()
                if f.normal.y < -0.9:       # la tranche, face à la vitre : le titre se lit de haut en bas
                    f.material_index = 0
                    xs_ = [l.vert.co.x for l in f.loops]
                    zs_ = [l.vert.co.z for l in f.loops]
                    for l in f.loops:
                        u = (max(zs_) - l.vert.co.z) / (max(zs_) - min(zs_))
                        t_ = (l.vert.co.x - min(xs_)) / (max(xs_) - min(xs_))
                        l[uv_k].uv = (u, 1 - (row + 1 - t_) / N_ATLAS)
            k7_count['k7'] += 1
    for nm, bm_, mats in ((name + '_carter', bm_c, [acier]), (name + '_k7', bm_k, [spine, case_plastic]), (name + '_reperes', bm_r, [reperes])):
        me_ = bpy.data.meshes.new(nm)
        bm_.normal_update()
        bm_.to_mesh(me_)
        bm_.free()
        ob_ = bpy.data.objects.new(nm, me_)
        scene.collection.objects.link(ob_)
        for m_ in mats:
            ob_.data.materials.append(m_)
    return {'xa': xa, 'xb': xb, 'n_slots': n_slots, 'rows': rows}


Y_RACK_G = FRONT + 0.17
rk_g = rack('casier_g', F['vitrine_g'], Y_RACK_G, 0)
rk_d = rack('casier_d', F['vitrine_d'], FRONT + 0.06, 6)

# ----- Le robot : un portique très simple, DEVANT le casier (entre la vitre et les tranches) pour qu'on le voie -----
# Deux rails verticaux contre la vitre, une traverse qui monte et descend, un chariot qui porte un plateau à la
# hauteur de la tablette et un tiroir à deux doigts : les doigts entrent entre deux K7, pincent, tirent la K7 sur le
# plateau. Au repos : la traverse dans l'intervalle sous la rangée du haut, le chariot à droite, le tiroir rentré.
alu = principled('alu', **{'Base Color': (0.74, 0.75, 0.76, 1), 'Metallic': 1.0, 'Roughness': 0.36})
alu.node_tree.links.new(math_node(alu.node_tree, 'ADD', 0.26, math_node(alu.node_tree, 'MULTIPLY', tex_node(alu, crasse, 'Object', box=True, scale=7).outputs['Color'], 0.3)),
                        alu.node_tree.nodes['Principled BSDF'].inputs['Roughness'])
alu_noir = principled('alu_noir', **{'Base Color': (0.035, 0.035, 0.04, 1), 'Metallic': 1.0, 'Roughness': 0.42})
caoutchouc = principled('caoutchouc', **{'Base Color': (0.012, 0.012, 0.012, 1), 'Roughness': 0.85})


def part(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0012):
    ob = box('robot_' + name, x0, x1, y0, y1, z0, z1, mat)
    if bevel:
        bv = ob.modifiers.new('arrondi', 'BEVEL')
        bv.width = bevel
        bv.segments = 2
    return ob


gx0, gx1, gz0, gz1 = F['vitrine_g']
ZB = rk_g['rows'][-1]                                       # tablette de la rangée servie (ici : celle du haut)
CX = rk_g['xa'] + (rk_g['n_slots'] - 0.5) * PITCH           # case servie (ici : la dernière à droite)
YR = FRONT + 0.012                                          # plan des rails, contre la vitre
for sfx, xr0, xr1 in (('g', gx0 + 0.006, gx0 + 0.024), ('d', gx1 - 0.024, gx1 - 0.006)):
    part('rail_' + sfx, L(xr0), L(xr1), YR, YR + 0.018, gz0 + 0.012, gz1 - 0.05, alu)
    part('courroie_' + sfx, L(xr0 + 0.006), L(xr1 - 0.006), YR - 0.0015, YR, gz0 + 0.04, gz1 - 0.07, caoutchouc, 0)
    part('moteur_z' + sfx, L(xr0 - 0.002), L(xr1 + 0.002), YR, YR + 0.034, gz0 + 0.006, gz0 + 0.04, alu_noir, 0.002)
    part('equerre_' + sfx, L(xr0 - 0.002), L(xr1 + 0.004), YR - 0.002, YR + 0.040, ZB - 0.040, ZB + 0.002, alu_noir, 0.002)
part('traverse', L(gx0 + 0.024), L(gx1 - 0.024), YR + 0.020, YR + 0.038, ZB - 0.030, ZB - 0.008, alu)
part('courroie_x', L(gx0 + 0.03), L(gx1 - 0.03), YR + 0.0185, YR + 0.020, ZB - 0.023, ZB - 0.015, caoutchouc, 0)
part('moteur_x', L(gx0 + 0.004), L(gx0 + 0.030), YR + 0.004, YR + 0.034, ZB + 0.002, ZB + 0.030, alu_noir, 0.002)
part('chariot', L(CX - 0.027), L(CX + 0.027), YR + 0.018, YR + 0.052, ZB - 0.034, ZB - 0.004, alu_noir, 0.002)
part('plateau', L(CX - 0.017), L(CX + 0.017), FRONT + 0.036, FRONT + 0.165, ZB - 0.004, ZB - 0.0015, alu, 0.0005)
for sfx, xg in (('g', CX - 0.0163), ('d', CX + 0.0148)):
    part('guide_' + sfx, L(xg), L(xg + 0.0015), FRONT + 0.045, FRONT + 0.160, ZB - 0.0015, ZB + 0.028, alu, 0)
part('tiroir', L(CX - 0.017), L(CX + 0.017), FRONT + 0.020, FRONT + 0.040, ZB + 0.004, ZB + 0.070, alu_noir, 0.002)
part('moteur_pince', L(CX - 0.012), L(CX + 0.012), FRONT + 0.022, FRONT + 0.038, ZB + 0.070, ZB + 0.092, alu_noir, 0.002)
for sfx, xf in (('g', CX - 0.0155), ('d', CX + 0.0135)):
    part('doigt_' + sfx, L(xf), L(xf + 0.002), FRONT + 0.040, FRONT + 0.092, ZB + 0.018, ZB + 0.058, alu, 0)
    part('patin_' + sfx, L(xf + (0.002 if sfx == 'g' else -0.0015)), L(xf + (0.0035 if sfx == 'g' else 0.0)), FRONT + 0.074, FRONT + 0.092, ZB + 0.024, ZB + 0.052, caoutchouc, 0)
box('robot_voyant', L(CX + 0.016), L(CX + 0.021), YR + 0.0172, YR + 0.018, ZB - 0.017, ZB - 0.012, emissive('voyant_robot', color=(0.2, 1.0, 0.3, 1), strength=10))
print('CASIERS', k7_count, 'grand casier', rk_g['n_slots'], 'cases x', len(rk_g['rows']), 'rangées ; petit', rk_d['n_slots'], 'x', len(rk_d['rows']))

# L'écran : la vraie interface de la borne, sous une vitre brillante.
screen_img = image(SOURCES / F['ecran_image'])
E_ = F['ecran']
ecx, ecz = (E_[0] + E_[1]) / 2, (E_[2] + E_[3]) / 2
plane('ecran', L(ecx), FRONT + 0.019, ecz, E_[1] - E_[0], E_[3] - E_[2], emissive('ecran', screen_img, strength=1.0))
plane('vitre_ecran', L(ecx), FRONT + 0.016, ecz, E_[1] - E_[0] + 0.01, E_[3] - E_[2] + 0.01, glass)
BD = F['bandeau']
plane('bandeau', L((BD[0] + BD[1]) / 2), FRONT + 0.014, (BD[2] + BD[3]) / 2, BD[1] - BD[0] - 0.02, BD[3] - BD[2] - 0.005, emissive('bandeau', image(T / 'bandeau.png'), strength=2.2))

# ----- paiement par carte : lecteur motorisé, étiquette CB, clavier en métal sous son capot -----
YB = FRONT + 0.02                      # surface du boîtier (en retrait de 2 cm)
lecteur = principled('lecteur_cb', **{'Base Color': (0.025, 0.025, 0.027, 1), 'Roughness': 0.38, 'Coat Weight': 0.3})
lnt = lecteur.node_tree
lp = lnt.nodes['Principled BSDF']
l_deep, l_scuff, l_grease, _lf = facade_maps(lnt)
l_bev = lnt.nodes.new('ShaderNodeBevel')
l_bev.inputs['Radius'].default_value = 0.003
l_geo = lnt.nodes.new('ShaderNodeNewGeometry')
l_dot = lnt.nodes.new('ShaderNodeVectorMath')
l_dot.operation = 'DOT_PRODUCT'
lnt.links.new(l_bev.outputs['Normal'], l_dot.inputs[0])
lnt.links.new(l_geo.outputs['Normal'], l_dot.inputs[1])
l_edge = math_node(lnt, 'MULTIPLY', math_node(lnt, 'SUBTRACT', 1.0, l_dot.outputs['Value']), 6.0)
l_edge = math_node(lnt, 'MULTIPLY', l_edge, tex_node(lecteur, crasse, 'Object', box=True, scale=9).outputs['Color'])
l_marks = math_node(lnt, 'MAXIMUM', math_node(lnt, 'MAXIMUM', l_deep, math_node(lnt, 'MULTIPLY', l_scuff, 0.8)), math_node(lnt, 'MULTIPLY', l_edge, 0.7))
l_col = mix_rgb(lnt, l_marks, (0.025, 0.025, 0.027, 1), (0.17, 0.17, 0.175, 1))
lnt.links.new(mix_rgb(lnt, math_node(lnt, 'MULTIPLY', l_grease, 0.4), l_col, (0.012, 0.012, 0.013, 1)), lp.inputs['Base Color'])
lnt.links.new(math_node(lnt, 'SUBTRACT', math_node(lnt, 'ADD', 0.36, math_node(lnt, 'MULTIPLY', l_marks, 0.35)),
                        math_node(lnt, 'MULTIPLY', l_grease, 0.2)), lp.inputs['Roughness'])
lnt.links.new(math_node(lnt, 'SUBTRACT', 0.3, math_node(lnt, 'MULTIPLY', l_marks, 0.3)), lp.inputs['Coat Weight'])
l_bump = lnt.nodes.new('ShaderNodeBump')
l_bump.inputs['Strength'].default_value = 0.25
l_bump.inputs['Distance'].default_value = 0.0003
lnt.links.new(l_marks, l_bump.inputs['Height'])
lnt.links.new(l_bump.outputs['Normal'], lp.inputs['Normal'])
LC = F['lecteur_cb']
lb = box('lecteur_cb', L(LC[0]), L(LC[1]), YB - 0.022, YB, LC[2], LC[3], lecteur)
lbv = lb.modifiers.new('arrondi', 'BEVEL')
lbv.width = 0.004
lbv.segments = 3
slot_z = (LC[2] + LC[3]) / 2 + 0.004
box('fente_carte', L(LC[0] + 0.0125), L(LC[1] - 0.0125), YB - 0.0225, YB - 0.012, slot_z - 0.002, slot_z + 0.002, interior)
# Liseré vert autour de la fente : la borne montre où va la carte.
box('lisere_carte', L(LC[0] + 0.0105), L(LC[1] - 0.0105), YB - 0.0223, YB - 0.012, slot_z - 0.0038, slot_z + 0.0038, emissive('lisere', color=(0.25, 1.0, 0.35, 1), strength=3))
box('voyant_carte', L(LC[1] - 0.012), L(LC[1] - 0.007), YB - 0.0226, YB - 0.020, slot_z + 0.008, slot_z + 0.0115, emissive('voyant', color=(0.2, 1.0, 0.3, 1), strength=12))
box('levre_carte', L(LC[0] + 0.008), L(LC[1] - 0.008), YB - 0.028, YB - 0.022, slot_z - 0.010, slot_z - 0.0035, lecteur)
EC = F['etiquette_cb']
plane('etiquette_cb', L((EC[0] + EC[1]) / 2), YB - 0.0006, (EC[2] + EC[3]) / 2, EC[1] - EC[0], EC[3] - EC[2], sticker_mat('etiquette_cb', T / 'etiquette-cb.png'))

inox = principled('inox', **{'Base Color': (0.62, 0.62, 0.60, 1), 'Metallic': 1.0, 'Roughness': 0.3, 'Anisotropic': 0.6})
inox_nt = inox.node_tree
inox_nt.links.new(math_node(inox_nt, 'ADD', 0.24, math_node(inox_nt, 'MULTIPLY', tex_node(inox, crasse, 'Object', box=True, scale=6).outputs['Color'], 0.2)),
                  inox_nt.nodes['Principled BSDF'].inputs['Roughness'])
touche = principled('touche', **{'Base Color': (0.66, 0.66, 0.64, 1), 'Metallic': 1.0, 'Roughness': 0.22, 'Anisotropic': 0.5})
tnt = touche.node_tree
tp = tnt.nodes['Principled BSDF']
tt = tex_node(touche, image(T / 'touches.png'))
tnt.links.new(mix_rgb(tnt, tt.outputs['Alpha'], (0.66, 0.66, 0.64, 1), tt.outputs['Color']), tp.inputs['Base Color'])
tnt.links.new(math_node(tnt, 'SUBTRACT', 1.0, tt.outputs['Alpha']), tp.inputs['Metallic'])
tnt.links.new(math_node(tnt, 'ADD', 0.2, math_node(tnt, 'MULTIPLY', tt.outputs['Alpha'], 0.4)), tp.inputs['Roughness'])

KP = F['clavier']
plate = box('clavier', L(KP[0]), L(KP[1]), YB - 0.005, YB, KP[2], KP[3], inox)
pbv = plate.modifiers.new('arrondi', 'BEVEL')
pbv.width = 0.003
pbv.segments = 2
me_k = bpy.data.meshes.new('touches')
bm = bmesh.new()
uvk = bm.loops.layers.uv.new()
margin, gap = 0.0075, 0.004
kw = (KP[1] - KP[0] - 2 * margin - 3 * gap) / 4
kh = (KP[3] - KP[2] - 2 * margin - 3 * gap) / 4
for r_ in range(4):
    for c_ in range(4):
        x0_ = L(KP[0] + margin + c_ * (kw + gap))
        z1_ = KP[3] - margin - r_ * (kh + gap)
        press = random.uniform(0.0, 0.0012)            # touches inégalement enfoncées
        geom = bmesh.ops.create_cube(bm, size=1.0)
        vs = geom['verts']
        for v in vs:
            v.co.x = x0_ + (v.co.x + 0.5) * kw
            v.co.y = YB - 0.005 - 0.0045 + press + (v.co.y + 0.5) * 0.0045
            v.co.z = z1_ - kh + (v.co.z + 0.5) * kh
        for f in {f for v in vs for f in v.link_faces}:
            f.normal_update()
            us = [(l.vert.co.x - x0_) / kw for l in f.loops]
            vz = [(l.vert.co.z - (z1_ - kh)) / kh for l in f.loops]
            for l, u_, v_ in zip(f.loops, us, vz):
                if f.normal.y < -0.9:
                    l[uvk].uv = ((c_ + u_) / 4, 1 - (r_ + 1 - v_) / 4)
                else:
                    l[uvk].uv = ((c_ + 0.02) / 4, 1 - (r_ + 0.98) / 4)   # coin vierge de la case : métal nu
bm.normal_update()
bm.to_mesh(me_k)
bm.free()
ko = bpy.data.objects.new('touches', me_k)
scene.collection.objects.link(ko)
ko.data.materials.append(touche)
kbv = ko.modifiers.new('arrondi', 'BEVEL')
kbv.width = 0.0012
kbv.segments = 2


def wedge(name, x0, x1, z0, z1, d_bottom, d_top, mat):
    """Joue du capot : profonde en haut, presque à fleur en bas."""
    me = bpy.data.meshes.new(name)
    bm_ = bmesh.new()
    pts = [(z0, d_bottom), (z1, d_top)]
    vv = []
    for x in (x0, x1):
        for z, dd in pts:
            vv.append(bm_.verts.new((x, YB - dd, z)))
            vv.append(bm_.verts.new((x, YB, z)))
    bmesh.ops.convex_hull(bm_, input=vv)
    bm_.to_mesh(me)
    bm_.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


wedge('capot_g', L(KP[0] - 0.008), L(KP[0] - 0.004), KP[2], KP[3] + 0.009, 0.010, 0.048, paint)
wedge('capot_d', L(KP[1] + 0.004), L(KP[1] + 0.008), KP[2], KP[3] + 0.009, 0.010, 0.048, paint)
box('capot_haut', L(KP[0] - 0.008), L(KP[1] + 0.008), YB - 0.048, YB, KP[3] + 0.005, KP[3] + 0.009, paint)
# Éclairage du clavier, caché sous le capot (sans lui l'inox ne reflète que la nuit).
kl = bpy.data.lights.new('eclairage_clavier', 'AREA')
kl.shape = 'RECTANGLE'
kl.size, kl.size_y = KP[1] - KP[0] - 0.01, 0.01
kl.energy = 0.4
kl.color = (1.0, 0.93, 0.82)
klo = bpy.data.objects.new('eclairage_clavier', kl)
scene.collection.objects.link(klo)
klo.location = (L((KP[0] + KP[1]) / 2), YB - 0.036, KP[3] + 0.003)
klo.rotation_euler = (math.radians(-25), 0, 0)

# ----- afficheur fluorescent 2 × 20, entre le pavé et la fente (à la place de l'étiquette imprimée) -----
# Au repos : « RETRAIT / RETOUR DES K7 ». Pendant la distribution, la page y écrira le titre du film.
AF = F['afficheur']
afc = box('afficheur_cadre', L(AF[0] - 0.010), L(AF[1] + 0.010), YB - 0.006, YB, AF[2] - 0.010, AF[3] + 0.010, lecteur).modifiers.new('arrondi', 'BEVEL')
afc.width = 0.003
afc.segments = 3
plane('afficheur', L((AF[0] + AF[1]) / 2), YB - 0.0062, (AF[2] + AF[3]) / 2, AF[1] - AF[0], AF[3] - AF[2], emissive('afficheur', image(T / 'afficheur.png'), strength=1.6))
plane('vitre_afficheur', L((AF[0] + AF[1]) / 2), YB - 0.0068, (AF[2] + AF[3]) / 2, AF[1] - AF[0] + 0.004, AF[3] - AF[2] + 0.004, glass)

# Serrure, sur le bord gauche de la façade.
bpy.ops.mesh.primitive_cylinder_add(radius=0.013, depth=0.012, location=(L(-0.50), FRONT - 0.005, 1.05), rotation=(math.radians(90), 0, 0))
bpy.context.active_object.data.materials.append(chrome)

# Autocollants.
stickers = [
    ('ultramarines', -0.125, FRONT - 0.0006, 1.50, 0.115, 0.115, -6, '-Y'),
    ('anarchiste', -0.125, FRONT - 0.0006, 0.74, 0.115, 0.151, -4, '-Y'),
    ('rosie', -0.36, FRONT + 0.0045, 1.18, 0.135, 0.172, 3, '-Y'),
    ('che', 0.4625, FRONT - 0.0006, 1.38, 0.105, 0.111, 3, '-Y'),
]
for name, x, y, z, w_, h_, rot, nrm in stickers:
    plane('autocollant_' + name, x if nrm == '+X' else L(x), y, z, w_, h_, sticker_mat('autocollant_' + name, T / f'sticker-{name}.png'), rot, nrm)


# ----- Enseigne néon « Borne 24/7 », au mur au-dessus de la borne (Rusmir, 18/11/2026) -----
# Un vrai néon en verre, tel qu'un verrier le cintre (parcours tracés par neon.py) : deux tubes continus, « Borne »
# et « 24/7 », branchés en série. Chaque tube est en verre teinté transparent ; le gaz luit dedans sur les portions
# de face ; les retours et les liaisons entre lettres passent derrière, peints en noir ; aux bouts, le tube se coude
# vers le mur et finit par une électrode sous capuchon. Un cavalier relie les deux tubes, et deux fils haute tension
# descendent dans la borne. Ce que le mur renvoie de la lumière est calculé par la passe « mur ».
EB = G.get('enseigne_borne')
NEON_JSON = D / 'neon-borne.json'
if EB and NEON_JSON.exists():
    from mathutils import Matrix  # noqa: E402
    from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
    nd = json.loads(NEON_JSON.read_text())
    SX, SZ = KX - nd['centre_m'][0], EB['hauteur_247_m'] - nd['milieu_247_m']
    R_OUT = EB['tube_diam_m'] / 2
    R_GAZ = R_OUT - 0.0013                     # paroi de verre de 1,3 mm
    FACE = nd['face_m']                        # du mur à l'axe des tubes de face
    ROT_Y = Matrix.Rotation(math.radians(90), 4, 'X')   # couche un cylindre (axe Z) le long de Y

    def p3(x, z, d=0.0):
        return (SX + x, -(FACE - d), SZ + z)

    neon_mat = bpy.data.materials.new('neon_gaz')
    neon_mat.use_nodes = True
    nnt = neon_mat.node_tree
    nnt.nodes.remove(nnt.nodes['Principled BSDF'])
    # Ce que l'appareil voit du gaz. Un néon photographié de nuit SATURE le capteur : son cœur brûle à blanc et il ne
    # garde sa couleur que sur ses bords — c'est ce passage qui fait « néon » (mesuré sur les tubes de la photo : centre
    # 255 230 255, bord 137 75 172). On le calcule comme le fait un capteur : la lumière reçue croît avec l'épaisseur de
    # gaz traversée (maximale au centre du tube), puis la réponse sature, couche par couche : 1 - exp(-lumière).
    n_lw = nnt.nodes.new('ShaderNodeLayerWeight')
    n_lw.inputs['Blend'].default_value = 0.5
    n_face = math_node(nnt, 'SUBTRACT', 1.0, n_lw.outputs['Facing'])
    n_lum = math_node(nnt, 'MULTIPLY', math_node(nnt, 'POWER', n_face, EB.get('profil_gaz', 3.0)), EB.get('exposition_gaz', 14.0), clamp=False)
    n_rgb = nnt.nodes.new('ShaderNodeCombineColor')
    for i_, c_ in enumerate(EB.get('couleur_gaz', (1.0, 0.16, 0.85))):
        n_exp = math_node(nnt, 'EXPONENT', math_node(nnt, 'MULTIPLY', n_lum, -c_, clamp=False), None, clamp=False)
        nnt.links.new(math_node(nnt, 'SUBTRACT', 1.0, n_exp), n_rgb.inputs[i_])
    n_cam = nnt.nodes.new('ShaderNodeEmission')
    n_cam.inputs['Strength'].default_value = 1.0
    nnt.links.new(n_rgb.outputs[0], n_cam.inputs['Color'])
    # Pour tout le reste (mur, borne, reflets) : la vraie lumière du gaz, bien plus forte que le blanc de l'image.
    n_lit = nnt.nodes.new('ShaderNodeEmission')
    n_lit.inputs['Color'].default_value = tuple(EB.get('couleur_lumiere', (0.9, 0.2, 1.0))) + (1,)
    n_lit.inputs['Strength'].default_value = EB.get('emission', 8)
    n_lp = nnt.nodes.new('ShaderNodeLightPath')
    n_mx = nnt.nodes.new('ShaderNodeMixShader')
    nnt.links.new(n_lp.outputs['Is Camera Ray'], n_mx.inputs['Fac'])
    nnt.links.new(n_lit.outputs['Emission'], n_mx.inputs[1])
    nnt.links.new(n_cam.outputs['Emission'], n_mx.inputs[2])
    nnt.links.new(n_mx.outputs['Shader'], nnt.nodes['Material Output'].inputs['Surface'])

    # Le verre : paroi mince, teintée, transparente. Transparence + reflet selon l'angle (Fresnel) : la lumière du gaz
    # la traverse sans être arrêtée, et le verre accroche les reflets — plus fort sur ses bords, comme un vrai tube.
    verre = bpy.data.materials.new('neon_verre')
    verre.use_nodes = True
    vnt = verre.node_tree
    vnt.nodes.remove(vnt.nodes['Principled BSDF'])
    v_tr = vnt.nodes.new('ShaderNodeBsdfTransparent')
    v_tr.inputs['Color'].default_value = (0.94, 0.88, 1.0, 1)
    try:
        v_gl = vnt.nodes.new('ShaderNodeBsdfGlossy')
    except RuntimeError:
        v_gl = vnt.nodes.new('ShaderNodeBsdfAnisotropic')
    v_gl.inputs['Roughness'].default_value = 0.03
    v_fr = vnt.nodes.new('ShaderNodeFresnel')
    v_fr.inputs['IOR'].default_value = 1.5
    v_mx = vnt.nodes.new('ShaderNodeMixShader')
    vnt.links.new(v_fr.outputs[0], v_mx.inputs[0])
    vnt.links.new(v_tr.outputs[0], v_mx.inputs[1])
    vnt.links.new(v_gl.outputs[0], v_mx.inputs[2])
    vnt.links.new(v_mx.outputs[0], vnt.nodes['Material Output'].inputs['Surface'])
    # La peinture d'occultation : noire, satinée, passée au pinceau sur le verre.
    occulte = principled('neon_occulte', **{'Base Color': (0.012, 0.012, 0.014, 1), 'Roughness': 0.42})
    nickel = principled('neon_electrode', **{'Base Color': (0.62, 0.62, 0.64, 1), 'Metallic': 1.0, 'Roughness': 0.32})
    capuchon = principled('neon_capuchon', **{'Base Color': (0.02, 0.02, 0.022, 1), 'Roughness': 0.55})
    # Embases des supports : noires et petites (blanches, la lumière du tube en faisait des perles roses sur le mur).
    plastique_blanc = principled('neon_embase', **{'Base Color': (0.02, 0.02, 0.022, 1), 'Roughness': 0.6})

    def courbe(nom, rayon, mat):
        cu_ = bpy.data.curves.new(nom, 'CURVE')
        cu_.dimensions = '3D'
        cu_.bevel_depth = rayon
        cu_.bevel_resolution = 4
        cu_.use_fill_caps = True
        ob_ = bpy.data.objects.new(nom, cu_)
        scene.collection.objects.link(ob_)
        cu_.materials.append(mat)
        return cu_

    def spline(cu_, pts3):
        sp = cu_.splines.new('POLY')
        sp.points.add(len(pts3) - 1)
        for pnt, co in zip(sp.points, pts3):
            pnt.co = (co[0], co[1], co[2], 1.0)

    cu_gaz = courbe('neon_tubes', R_GAZ, neon_mat)
    cu_verre = courbe('neon_verre', R_OUT, verre)
    cu_noir = courbe('neon_occulte', R_OUT + 0.0002, occulte)
    cu_fil = courbe('neon_fils', 0.0025, caoutchouc)
    bm_e, bm_c, bm_s, bm_b = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    long_ = {'L': 0.0, 'N': 0.0, 'E': 0.0}
    bouts_monde, allume = [], []
    for u in nd['unites']:
        pts = [p3(*q) for q in u['points']]
        lab = u['labels']
        a = 0
        while a < len(lab):
            b = a
            while b + 1 < len(lab) and lab[b + 1] == lab[a]:
                b += 1
            seg = pts[max(0, a - 1):min(len(pts), b + 2)]            # un point de recouvrement de chaque côté
            long_[lab[a]] += sum((Vector(seg[k + 1]) - Vector(seg[k])).length for k in range(len(seg) - 1))
            if lab[a] == 'L':
                spline(cu_gaz, pts[a:b + 1])
                spline(cu_verre, seg)
                allume += pts[a:b + 1]
            elif lab[a] == 'N':
                spline(cu_noir, seg)
            else:
                spline(cu_verre, seg)
            a = b + 1
        for bx, bz, bd in u['bouts']:
            X, Z = SX + bx, SZ + bz
            # l'électrode (coquille de nickel dans la partie droite du verre), puis le capuchon, jusqu'à 2 mm du mur
            y_av = -(FACE - bd) + 0.002                      # début de la partie droite, côté rue
            long_e = min(0.018, max(0.006, -0.012 - y_av))
            bmesh.ops.create_cone(bm_e, cap_ends=True, segments=14, radius1=0.0042, radius2=0.0042, depth=long_e,
                                  matrix=Matrix.Translation((X, -0.012 - long_e / 2, Z)) @ ROT_Y)
            bmesh.ops.create_cone(bm_c, cap_ends=True, segments=18, radius1=0.0098, radius2=0.0092, depth=0.020,
                                  matrix=Matrix.Translation((X, -0.012, Z)) @ ROT_Y)
            bouts_monde.append((X, Z))
        for sx_, sz_ in u['supports']:
            X, Z = SX + sx_, SZ + sz_
            h_ = FACE - R_OUT * 0.5
            bmesh.ops.create_cone(bm_s, cap_ends=True, segments=10, radius1=0.003, radius2=0.003, depth=h_,
                                  matrix=Matrix.Translation((X, -h_ / 2, Z)) @ ROT_Y)
            bmesh.ops.create_cone(bm_b, cap_ends=True, segments=14, radius1=0.006, radius2=0.005, depth=0.003,
                                  matrix=Matrix.Translation((X, -0.0015, Z)) @ ROT_Y)

    def lisse3(ctrl, n=12):
        """Courbe souple passant par les points de contrôle (Catmull-Rom)."""
        c = [Vector(ctrl[0])] + [Vector(q) for q in ctrl] + [Vector(ctrl[-1])]
        out = []
        for k in range(1, len(c) - 2):
            p0, p1, p2, p3_ = c[k - 1], c[k], c[k + 1], c[k + 2]
            for m_ in range(n):
                t_ = m_ / n
                out.append(0.5 * ((2 * p1) + (-p0 + p2) * t_ + (2 * p0 - 5 * p1 + 4 * p2 - p3_) * t_ * t_ + (-p0 + 3 * p1 - 3 * p2 + p3_) * t_ ** 3))
        return out + [Vector(ctrl[-1])]

    # Câblage en série : fil d'arrivée → « Borne » → cavalier → « 24/7 » → fil de retour. Les fils sortent des
    # capuchons, longent le mur, et les deux bouts de la chaîne descendent dans le dessus de la borne (passe-fils).
    (xa0, za0), (xa1, za1), (xb0, zb0), (xb1, zb1) = bouts_monde
    spline(cu_fil, lisse3([(xa1, -0.010, za1 - 0.009), (xa1 + 0.012, -0.006, za1 - 0.032), ((xa1 + xb0) / 2, -0.006, min(za1, zb0) - 0.050),
                           (xb0 - 0.012, -0.006, zb0 - 0.032), (xb0, -0.010, zb0 - 0.009)]))
    for X, Z in ((xa0, za0), (xb1, zb1)):
        spline(cu_fil, lisse3([(X, -0.010, Z - 0.009), (X, -0.006, Z - 0.035), (X, -0.006, KH + 0.075), (X, -0.009, KH + 0.035), (X, -0.022, KH + 0.002)]))
        bmesh.ops.create_cone(bm_c, cap_ends=True, segments=14, radius1=0.0065, radius2=0.0055, depth=0.005, matrix=Matrix.Translation((X, -0.022, KH + 0.0025)))
        zc = (Z - 0.035 + KH + 0.075) / 2
        box('neon_attache', X - 0.007, X + 0.007, -0.0085, 0.0, zc - 0.004, zc + 0.004, acier)
    for nom, bm_, mat in (('neon_electrodes', bm_e, nickel), ('neon_capuchons', bm_c, capuchon), ('neon_supports', bm_s, verre), ('neon_embases', bm_b, plastique_blanc)):
        me_ = bpy.data.meshes.new(nom)
        bm_.to_mesh(me_)
        bm_.free()
        ob_ = bpy.data.objects.new(nom, me_)
        scene.collection.objects.link(ob_)
        ob_.data.materials.append(mat)
    # Où est l'enseigne dans l'image : compo.py y ajoute le halo.
    bpy.context.view_layer.update()
    ax = [q[0] for q in allume]
    az = [q[2] for q in allume]
    corners = [world_to_camera_view(scene, cam, Vector((x_, -FACE, z_))) for x_ in (min(ax) - 0.03, max(ax) + 0.03) for z_ in (min(az) - 0.03, max(az) + 0.03)]
    pxs, pys = [c_.x * W for c_ in corners], [(1 - c_.y) * H for c_ in corners]
    tube_px = R_GAZ * (max(pxs) - min(pxs)) / (max(ax) - min(ax) + 0.06)
    (D / 'neon-bbox.json').write_text(json.dumps({'x0': min(pxs), 'x1': max(pxs), 'y0': min(pys), 'y1': max(pys), 'rayon_tube_px': tube_px}))
    print('NEON 3D', len(nd['unites']), 'tubes de', round(EB['tube_diam_m'] * 1000), 'mm | allumé', round(long_['L'], 2), 'm, occulté', round(long_['N'], 2), 'm, électrodes',
          round(long_['E'], 2), 'm |', len(bouts_monde), 'électrodes,', sum(len(u['supports']) for u in nd['unites']), 'supports, 3 fils | axe de face à',
          round(FACE * 100, 1), 'cm du mur | « 24/7 » de', round(min(q[2] for q in allume if q[0] > SX + nd['centre_m'][0]) - R_OUT, 3), 'à',
          round(max(q[2] for q in allume if q[0] > SX + nd['centre_m'][0]) + R_OUT, 3), 'm | image : colonnes', round(min(pxs)), 'à', round(max(pxs)),
          ', lignes', round(min(pys)), 'à', round(max(pys)), '| rayon du gaz', round(tube_px, 2), 'px')


# ----- lumières -----
def area(name, loc, size, size_y, energy, color, tilt_deg):
    lt = bpy.data.lights.new(name, 'AREA')
    lt.shape = 'RECTANGLE'
    lt.size, lt.size_y = size, size_y
    lt.energy = energy
    lt.color = color
    ob = bpy.data.objects.new(name, lt)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (math.radians(tilt_deg), 0, 0)
    return ob


sign_x = (R['sign_center_x'] - R['door_center_x']) / PPM
sign_z = (R['ground_y'] - R['sign_center_y']) / PPM
area('enseigne_videoclub', (sign_x, -0.12, sign_z), 2.2, 0.3, 90, (0.55, 0.22, 1.0), -40)
# Appoint sous l'enseigne (les tubes éclairent déjà) : la lumière rasante qu'elle jette sur le haut de la borne.
area('enseigne_borne', (KX, -0.07, 2.14), 0.95, 0.05, 7, (1.0, 0.25, 0.9), -62)
area('neon_porte', (0.0, -0.10, 2.25), 0.9, 0.3, 10, (0.6, 0.25, 1.0), -40)
area('boutique', (0.0, -0.03, 1.25), 0.85, 1.7, 12, (1.0, 0.72, 0.45), -90)
area('rue', (KX + 0.8, -5.5, 3.8), 4.0, 2.0, 140, (0.55, 0.65, 1.0), 70)
sun = bpy.data.lights.new('lune', 'SUN')
sun.energy = 0.04
sun.color = (0.7, 0.78, 1.0)
so = bpy.data.objects.new('lune', sun)
scene.collection.objects.link(so)
so.rotation_euler = (math.radians(35), math.radians(-25), 0)


# ----- Le mur, pour de vrai : ce qu'un mur peint et mouillé renvoie du néon et du réverbère -----
# Dans la passe « borne », le mur n'est qu'un attrape-ombres : ses pixels sont ceux de la photo. La passe « mur » le
# rend avec une vraie matière, éclairé par les seuls tubes et par un réverbère ; compo.py ajoute cette lumière au mur
# de la photo. Le lancer de rayons place tout seul les reflets au bon endroit : l'image d'un tube dans le mur glisse
# vers le pied de l'appareil (vers le bas, puisqu'on regarde l'enseigne d'en dessous), comme sous « VIDEOCLUB ».
MUR = G.get('mur', {})


def mat_mur_reel():
    """Peinture sombre, lisse, mouillée : peu de diffus, un reflet net là où l'eau ruisselle, plus flou ailleurs."""
    m = principled('mur_reel', **{'Base Color': tuple(MUR.get('albedo', (0.016, 0.018, 0.028))) + (1,), 'Roughness': 0.25,
                                  'Specular IOR Level': MUR.get('reflet', 0.5)})
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry')

    def noise(scale, detail=2.0):
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        nt.links.new(geo.outputs['Position'], mp.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Detail'].default_value = detail
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n.outputs[0]

    coulures = noise((110.0, 1.0, 2.2))                # ruissellements : étroits (1 cm), longs (45 cm)
    nappes = noise((2.5, 1.0, 2.5), 1.0)               # zones plus ou moins trempées
    grain = noise((260.0, 260.0, 260.0), 3.0)          # grain de la peinture
    # L'eau ne ruisselle que par endroits : là, le film est lisse et le reflet net ; ailleurs la peinture est satinée.
    mouille = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', coulures, 0.52), 6.0),
                        math_node(nt, 'ADD', 0.25, nappes))
    sec, trempe = MUR.get('rugosite_sec', 0.17), MUR.get('rugosite_mouille', 0.07)
    nt.links.new(math_node(nt, 'SUBTRACT', sec, math_node(nt, 'MULTIPLY', mouille, sec - trempe)), bsdf.inputs['Roughness'])
    # Relief très léger : le grain de la peinture, et à peine le bourrelet des coulures (un relief marqué transformait
    # le mur en rideau plissé).
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = MUR.get('relief', 0.05)
    bump.inputs['Distance'].default_value = 0.0008
    nt.links.new(math_node(nt, 'ADD', grain, math_node(nt, 'MULTIPLY', coulures, 0.4), clamp=False), bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def murs_reels():
    """Les trois pans du mur cessent d'être des attrape-ombres et prennent leur vraie matière."""
    mat = mat_mur_reel()
    for ob in scene.objects:
        if ob.name.startswith('mur_'):
            ob.is_shadow_catcher = False
            ob.data.materials.clear()
            ob.data.materials.append(mat)


def pose_reverbere():
    """Un réverbère de l'autre côté de la rue. Il ne compte que par son reflet (le mur de la photo est déjà éclairé
    par la rue) : son éclat sur le mur est là où le regard, renvoyé par le mur, tombe sur lui."""
    rv = MUR.get('reverbere')
    if not rv:
        return None
    lt = bpy.data.lights.new('reverbere', 'AREA')
    lt.shape = 'DISK'
    lt.size = rv['diametre_m']
    lt.energy = rv['puissance_w']
    lt.color = tuple(rv['couleur'])
    ob = bpy.data.objects.new('reverbere', lt)
    scene.collection.objects.link(ob)
    ob.location = tuple(rv['position_m'])
    lx, ly, lz = rv['position_m']
    t_ = cam_d / (cam_d - ly)                        # le rayon appareil → image du réverbère coupe le mur ici
    px_, pz_ = lx * t_, eye + (lz - eye) * t_
    ob.rotation_euler = Vector((px_ - lx, -ly, pz_ - lz)).normalized().to_track_quat('-Z', 'Y').to_euler()
    ob.visible_diffuse = False
    print('REVERBERE éclat attendu sur le mur : X', round(px_, 2), 'm, Z', round(pz_, 2), 'm → colonne', round(R['door_center_x'] + px_ * PPM),
          ', ligne', round(R['ground_y'] - pz_ * PPM))
    return ob


# ----- Ce que le site lit : la mise en page de l'image -----
# Le site pose ses zones d'appui sur ces positions, en fractions de l'image (0 à 1, origine en haut à
# gauche). Elles sont projetées par la caméra de la scène, jamais recopiées à la main.
from bpy_extras.object_utils import world_to_camera_view as vers_image  # noqa: E402

SITE = G.get('site', {})


def cadre(points):
    """Rectangle qui englobe, dans l'image, des points de la scène."""
    bpy.context.view_layer.update()
    vus = [vers_image(scene, cam, Vector(q)) for q in points]
    xs_, ys_ = [v.x for v in vus], [1 - v.y for v in vus]
    return {'x0': min(xs_), 'y0': min(ys_), 'x1': max(xs_), 'y1': max(ys_)}


def mise_en_page():
    # La borne : le corps entier, de sa façade (en saillie) au plan du mur ; son pied est sous le bord de l'image.
    borne_ = cadre([(KX + c_ * KW / 2, y_, z_) for c_ in (-1, 1) for y_ in (FRONT, 0.0) for z_ in (0.0, KH)])
    borne_ = {k_: min(1.0, max(0.0, v_)) for k_, v_ in borne_.items()}
    ex0, ex1, ez0, ez1 = F['ecran']
    ecran_ = cadre([(L(x_), FRONT + 0.019, z_) for x_ in (ex0, ex1) for z_ in (ez0, ez1)])
    # La porte est dans la photo : ses bords viennent du calage de la photo (fond.py), son haut du cadre relevé.
    porte_ = {'x0': R['door_left_x'] / W, 'y0': MUR['porte_px']['haut'] / H, 'x1': R['door_right_x'] / W, 'y1': 1.0}
    kp = PPM / G['photo']['px_par_m']
    push_x, push_y = G['photo']['plaque_push_px']
    mise = {
        'image': {'w': W, 'h': H}, 'borne': borne_, 'ecran': ecran_, 'porte': porte_,
        'push': {'x': (R['photo_x0'] + push_x * kp) / W, 'y': (R['photo_y0'] + push_y * kp) / H},
        'groupe': {'cx': (borne_['x0'] + porte_['x1']) / 2, 'cy': SITE.get('groupe_cy', 0.72)},
    }
    return mise


MISE = mise_en_page()
if PASSE == 'borne':
    (D / 'mise-en-page.json').write_text(json.dumps(
        {k_: {c_: (round(v_, 6) if isinstance(v_, float) else v_) for c_, v_ in r_.items()} for k_, r_ in MISE.items()}, indent=2) + '\n')
    print('MISE EN PAGE borne', [round(MISE['borne'][c_] * (W if c_[0] == 'x' else H)) for c_ in ('x0', 'y0', 'x1', 'y1')],
          '| écran', [round(MISE['ecran'][c_] * (W if c_[0] == 'x' else H)) for c_ in ('x0', 'y0', 'x1', 'y1')],
          '| porte', [round(MISE['porte'][c_] * (W if c_[0] == 'x' else H)) for c_ in ('x0', 'y0', 'x1', 'y1')],
          '| push', round(MISE['push']['x'] * W), round(MISE['push']['y'] * H))

if PASSE == 'mur':
    murs_reels()
    for ob in scene.objects:
        if ob.type == 'LIGHT':
            ob.hide_render = True                    # les lumières d'ambiance sont déjà dans la photo
        elif not ob.name.startswith('mur_') and ob.type in ('MESH', 'CURVE'):
            ob.visible_camera = False                # la borne et les tubes masquent et éclairent, sans être vus
    pose_reverbere()
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    scene.render.film_transparent = False
    ZX0, ZX1, ZY0, ZY1 = MUR.get('zone_px', (0, 900, 1100, 2300))      # la zone du mur autour de la borne, dans l'image
    scene.render.border_min_x, scene.render.border_max_x = ZX0 / W, min(1.0, ZX1 / W)
    scene.render.border_min_y, scene.render.border_max_y = 1 - ZY1 / H, 1 - ZY0 / H
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'

if PASSE == 'masque':
    # Le masque de reflets du site (devanture animée du bureau) : vert = vitre, bleu = métal, rouge = néon qui vacille.
    # La borne y entre en aplats, sans éclairage : ses vitres en « vitre », sa carrosserie et ses pièces de métal en
    # « carrosserie » (moins réfléchissante que l'inox de la porte), tout le reste — néon compris, il ne vacille pas
    # (Rusmir, 18/11/2026) — en noir opaque : la borne recouvre ce que le masque de la photo portait derrière elle.
    MQ = G['masque']
    VITRES = {'vitre'}
    CARROSSERIE = {'peinture', 'alu', 'alu_noir', 'acier', 'inox', 'chrome', 'touche'}
    aplats = {}

    def aplat(couleur):
        cle = tuple(couleur)
        if cle not in aplats:
            m = bpy.data.materials.new('aplat')
            m.use_nodes = True
            m.node_tree.nodes.clear()
            em = m.node_tree.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (*cle, 1)
            em.inputs['Strength'].default_value = 1.0
            m.node_tree.links.new(em.outputs['Emission'], m.node_tree.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
            aplats[cle] = m
        return aplats[cle]

    for ob in scene.objects:
        if ob.type == 'LIGHT' or ob.name.startswith('mur_'):
            ob.hide_render = True                    # ni lumière ni mur attrape-ombres : seules les matières comptent
        elif ob.type in ('MESH', 'CURVE'):
            if not ob.material_slots:
                ob.data.materials.append(None)
            for slot in ob.material_slots:
                nom = slot.material.name.split('.')[0] if slot.material else ''
                slot.material = aplat(MQ['vitre'] if nom in VITRES else MQ['carrosserie'] if nom in CARROSSERIE else (0, 0, 0))
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    scene.view_settings.view_transform = 'Raw'       # les valeurs du masque sortent telles quelles (0,25 → 64)
    scene.render.dither_intensity = 0.0              # sans tramage : il ajoutait ±1 partout, donc du rouge (néon) sur la borne
    scene.cycles.use_denoising = False
    scene.cycles.samples = 16

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
if PASSE == 'mur':
    import numpy as np  # noqa: E402
    exr = bpy.data.images.load(OUT if OUT.endswith('.exr') else OUT + '.exr')
    buf = np.empty(exr.size[0] * exr.size[1] * 4, np.float32)
    exr.pixels.foreach_get(buf)
    lum = buf.reshape(exr.size[1], exr.size[0], 4)[::-1, :, :3]
    np.save(str(D / 'mur-passe.npy'), lum[ZY0:ZY1, ZX0:ZX1].copy())
    print('PASSE MUR', lum.shape, 'max', round(float(lum.max()), 3), '→ mur-passe.npy (lignes 1100 à 2300, colonnes 0 à 900)')
print('RENDU', OUT, 'centre borne X =', round(KX, 3), 'objectif', round(cam_data.lens, 2), 'mm', 'décalage', round(cam_data.shift_x, 4), round(cam_data.shift_y, 4))
