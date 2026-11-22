"""UNE K7 de référence, seule, à juger à côté d'une vraie photo avant de l'étendre à la borne (Rusmir, 22/11/2026).

blender -b --factory-startup --python-exit-code 1 -P k7_reference.py -- <échantillons> <sortie.png> <bout|tranche>

L'étui est celui du vidéoclub (public/models/vhs_cassette_tape.glb, ses coordonnées de texture, la jaquette que
l'application dessine), refait comme l'objet réel : un fourreau de carton de 0,7 mm d'épaisseur, ouvert à un bout,
aux plis arrondis, aux panneaux jamais tout à fait plats, avec la cassette noire dedans et l'étiquette du club.
Les matières sont photographiées (ambientCG, CC0 : carton, papier, rayures et traces) ; la lumière est un vrai
environnement de rue de nuit (Poly Haven, CC0) plus un tube.
Référence visuelle : « Video store stock tracking label » (Wikimedia Commons), une K7 de location dans son étui.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))
from variante import D  # noqa: E402

a = sys.argv[sys.argv.index('--') + 1:]
ECH, SORTIE, VUE = int(a[0]), a[1], a[2]
VOISINES = (22, 1100988, 194662, 550, 134, 335)      # les mêmes que k7_voisines.py
# Niveau d'usure par âge du film (k7_usure_tranche.niveau_du_film) : La Mouche 1986 puis les voisines 2003, 2025, 2014,
# 1999, 2000, 1968. Les masques tex/usure-tranche-<k>.png sont fabriqués à ces niveaux.
NIVEAU = (2, 2, 1, 1, 2, 2, 3)
PASSE = {1: 0.03, 2: 0.10, 3: 0.22}                  # couleurs passées : la part de gris clair mêlée à l'encre
VERNIS = float(__import__('os').environ.get('VERNIS', 1.0))     # 1 : pelliculage terni ; plus : il en reste davantage
M = D / 'matieres'
TEX = D / 'tex'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = ECH
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.render.resolution_x, scene.render.resolution_y = 1800, 1100


def img(p, couleur=True):
    i = bpy.data.images.load(str(p))
    if not couleur:
        i.colorspace_settings.name = 'Non-Color'
    return i


def tex(nt, image, coord, echelle=1.0, proj='FLAT'):
    """Nœud d'image ; coord : sortie de coordonnées (UV ou objet), mise à l'échelle."""
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (echelle,) * 3
    nt.links.new(coord, mp.inputs['Vector'])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = image
    t.projection = proj
    if proj == 'BOX':
        t.projection_blend = 0.3
    t.interpolation = 'Cubic'
    nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
    return t


def calc(nt, op, x, y=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = True
    for k, v in enumerate((x, y)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[k].default_value = v
        else:
            nt.links.new(v, n.inputs[k])
    return n.outputs[0]


def calc_libre(nt, op, x, y=None):
    """Comme calc, sans borner le résultat entre 0 et 1 (pour des coordonnées)."""
    s_ = calc(nt, op, x, y)
    s_.node.use_clamp = False
    return s_


def melange(nt, fac, c1, c2):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    for nom, v in (('Factor', fac), ('A', c1), ('B', c2)):
        s = next(i for i in n.inputs if i.name == nom and (nom == 'Factor' and i.type == 'VALUE' or nom != 'Factor' and i.type == 'RGBA'))
        if isinstance(v, (int, float, tuple)):
            s.default_value = v
        else:
            nt.links.new(v, s)
    return next(o for o in n.outputs if o.type == 'RGBA')


# ----- la jaquette pelliculée : matières photographiées -----
def mat_jaquette():
    m = bpy.data.materials.new('jaquette')
    m.use_nodes = True
    nt = m.node_tree
    pb = nt.nodes['Principled BSDF']
    co = nt.nodes.new('ShaderNodeTexCoord')
    uv, ob = co.outputs['UV'], co.outputs['Object']
    encre = tex(nt, img(TEX / 'jaquette-servie.png'), uv)
    relief = tex(nt, img(TEX / 'jaquette-servie-relief.png', False), uv)
    traces = tex(nt, img(M / 'SurfaceImperfections015' / 'SurfaceImperfections015_1K-JPG_Roughness.jpg', False), ob, 9.0, 'BOX')
    rayures = tex(nt, img(M / 'SurfaceImperfections003' / 'SurfaceImperfections003_1K-JPG_Opacity.jpg', False), ob, 6.0, 'BOX')
    carton = tex(nt, img(M / 'Cardboard004' / 'Cardboard004_1K-JPG_Color.jpg'), ob, 14.0, 'BOX')
    papier_n = tex(nt, img(M / 'Paper001' / 'Paper001_1K-JPG_NormalGL.jpg', False), ob, 22.0, 'BOX')
    # L'usure de la TRANCHE (Rusmir, 22/11/2026, d'après deux tranches réelles) : un masque fabriqué par
    # k7_usure_tranche.py — franges déchiquetées le long des arêtes, cassures de l'encre en fil de cheveu — posé sur la
    # seule face que la vitrine montre. L'ancienne usure calculée (liseré le long des plis, plaques) a été rejetée.
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(ob, sep.inputs[0])
    cmb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(calc_libre(nt, 'ADD', calc_libre(nt, 'MULTIPLY', sep.outputs['Z'], 1 / 0.02864), 0.5), cmb.inputs['X'])
    nt.links.new(calc_libre(nt, 'ADD', calc_libre(nt, 'MULTIPLY', sep.outputs['X'], 1 / 0.2000), 0.5), cmb.inputs['Y'])
    masque = nt.nodes.new('ShaderNodeTexImage')
    masque.image = img(TEX / 'usure-tranche-0.png', False)
    masque.extension = 'EXTEND'
    masque.interpolation = 'Cubic'
    nt.links.new(cmb.outputs['Vector'], masque.inputs['Vector'])
    face = calc(nt, 'LESS_THAN', sep.outputs['Y'], -0.0537)             # la tranche tournée vers la vitre, plis compris
    usure = calc(nt, 'MULTIPLY', masque.outputs['Color'], face)
    # Le papier mis à nu : blanc, pas beige. (Le facteur est la part du SECOND terme : à 0,05 c'était 95 % de carton brun.)
    blanc = melange(nt, 0.93, carton.outputs['Color'], (0.95, 0.94, 0.91, 1))
    passe = nt.nodes.new('ShaderNodeValue')
    passe.name = 'passe'
    passe.outputs[0].default_value = PASSE[NIVEAU[0]]
    encre_passee = melange(nt, passe.outputs[0], encre.outputs['Color'], (0.56, 0.54, 0.50, 1))
    nt.links.new(melange(nt, usure, encre_passee, blanc), pb.inputs['Base Color'])
    nt.links.new(calc(nt, 'ADD', 0.84, calc(nt, 'MULTIPLY', usure, 0.12)), pb.inputs['Roughness'])
    pb.inputs['Specular IOR Level'].default_value = 0.22      # du papier imprimé dépoli : presque plus de reflet propre
    # Du carton imprimé, pas du plastique (Rusmir, 22/11/2026) : un satiné faible et diffus, jamais un miroir. Il varie
    # avec les traces de doigts et les micro-rayures, et disparaît où c'est usé.
    # (Rusmir, même jour : le reflet doit rester, c'est sa NATURE qui doit changer.) Un carton pelliculé reflète, mais
    # pas comme un plastique moulé : le film épouse le grain du papier et la « peau d'orange » de la colle, donc le
    # reflet est large, à bords doux, et grêlé ; il se ternit par plaques là où les doigts et les frottements ont passé.
    # « Le papier brillant s'use vite et perd son éclat » (Rusmir, 22/11) : le pelliculage ne subsiste que par plaques,
    # faible, et son reflet est large. Un vernis plein (0,62 partout) faisait des boîtiers de plastique rigide.
    reste = nt.nodes.new('ShaderNodeTexNoise')
    reste.inputs['Scale'].default_value, reste.inputs['Detail'].default_value = 26, 2.0
    nt.links.new(ob, reste.inputs['Vector'])
    eclat = calc(nt, 'MULTIPLY', calc(nt, 'ADD', 0.02, calc(nt, 'MULTIPLY', calc(nt, 'SUBTRACT', reste.outputs['Fac'], 0.50), 0.7)), VERNIS)
    nt.links.new(calc(nt, 'MULTIPLY', calc(nt, 'SUBTRACT', 1.0, usure), eclat), pb.inputs['Coat Weight'])
    pb.inputs['Coat IOR'].default_value = 1.42
    peau = nt.nodes.new('ShaderNodeTexNoise')
    peau.inputs['Scale'].default_value, peau.inputs['Detail'].default_value, peau.inputs['Roughness'].default_value = 520, 3, 0.55
    nt.links.new(ob, peau.inputs['Vector'])
    grain_n = nt.nodes.new('ShaderNodeNormalMap')
    grain_n.inputs['Strength'].default_value = 0.9
    nt.links.new(papier_n.outputs['Color'], grain_n.inputs['Color'])
    vernis_n = nt.nodes.new('ShaderNodeBump')
    vernis_n.inputs['Strength'].default_value, vernis_n.inputs['Distance'].default_value = 0.35, 0.00012
    nt.links.new(peau.outputs['Fac'], vernis_n.inputs['Height'])
    nt.links.new(grain_n.outputs['Normal'], vernis_n.inputs['Normal'])
    nt.links.new(vernis_n.outputs['Normal'], pb.inputs['Coat Normal'])
    nt.links.new(calc(nt, 'ADD', 0.46, calc(nt, 'ADD', calc(nt, 'MULTIPLY', traces.outputs['Color'], 0.30), calc(nt, 'MULTIPLY', rayures.outputs['Color'], 0.22))), pb.inputs['Coat Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.25
    nt.links.new(papier_n.outputs['Color'], nm.inputs['Color'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value, bp.inputs['Distance'].default_value = 0.7, 0.0003
    nt.links.new(relief.outputs['Color'], bp.inputs['Height'])
    nt.links.new(nm.outputs['Normal'], bp.inputs['Normal'])
    nt.links.new(bp.outputs['Normal'], pb.inputs['Normal'])
    import os
    if os.environ.get('DIAG') == 'usure':            # diagnostic : l'usure seule, en blanc sur noir
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(usure, em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
    if os.environ.get('DIAG') == 'pli':
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(pli, em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
    return m


def mat_carton():
    m = bpy.data.materials.new('carton_nu')
    m.use_nodes = True
    nt = m.node_tree
    pb = nt.nodes['Principled BSDF']
    co = nt.nodes.new('ShaderNodeTexCoord')
    c = tex(nt, img(M / 'Cardboard004' / 'Cardboard004_1K-JPG_Color.jpg'), co.outputs['Object'], 12.0, 'BOX')
    # Carton gris-beige jauni, pelucheux : des fibres plus sombres et un relief fin, pour que sa tranche ne soit pas un trait net.
    fib = nt.nodes.new('ShaderNodeTexNoise')
    fib.inputs['Scale'].default_value, fib.inputs['Detail'].default_value, fib.inputs['Roughness'].default_value = 1400, 6, 0.7
    nt.links.new(co.outputs['Object'], fib.inputs['Vector'])
    teinte = melange(nt, 0.5, c.outputs['Color'], (0.74, 0.66, 0.50, 1))
    nt.links.new(melange(nt, calc(nt, 'MULTIPLY', fib.outputs['Fac'], 0.55), teinte, (0.42, 0.36, 0.27, 1)), pb.inputs['Base Color'])
    pb.inputs['Roughness'].default_value = 0.95
    bf = nt.nodes.new('ShaderNodeBump')
    bf.inputs['Strength'].default_value, bf.inputs['Distance'].default_value = 1.0, 0.0004
    nt.links.new(fib.outputs['Fac'], bf.inputs['Height'])
    n = tex(nt, img(M / 'Cardboard004' / 'Cardboard004_1K-JPG_NormalGL.jpg', False), co.outputs['Object'], 12.0, 'BOX')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.8
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bf.inputs['Normal'])
    nt.links.new(bf.outputs['Normal'], pb.inputs['Normal'])
    return m


def mat_plastique():
    """Le plastique noir de la cassette : grain moulé fin, un peu lustré par les manipulations."""
    m = bpy.data.materials.new('cassette')
    m.use_nodes = True
    nt = m.node_tree
    pb = nt.nodes['Principled BSDF']
    pb.inputs['Base Color'].default_value = (0.012, 0.012, 0.013, 1)
    co = nt.nodes.new('ShaderNodeTexCoord')
    t = tex(nt, img(M / 'SurfaceImperfections015' / 'SurfaceImperfections015_1K-JPG_Roughness.jpg', False), co.outputs['Object'], 14.0, 'BOX')
    nt.links.new(calc(nt, 'ADD', 0.28, calc(nt, 'MULTIPLY', t.outputs['Color'], 0.3)), pb.inputs['Roughness'])
    v = nt.nodes.new('ShaderNodeTexVoronoi')
    v.inputs['Scale'].default_value = 2600
    nt.links.new(co.outputs['Object'], v.inputs['Vector'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value, bp.inputs['Distance'].default_value = 0.25, 0.00008
    nt.links.new(v.outputs['Distance'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], pb.inputs['Normal'])
    return m


# ----- l'étui : le modèle du vidéoclub, refait en fourreau -----
bpy.ops.import_scene.gltf(filepath=str(ICI.parents[1] / 'public' / 'models' / 'vhs_cassette_tape.glb'))
bpy.context.view_layer.update()
glb = next(o for o in scene.objects if o.type == 'MESH')
me = glb.data.copy()
me.transform(glb.matrix_world)
for o in list(scene.objects):
    bpy.data.objects.remove(o, do_unlink=True)
# Le centre de la boîte englobante, et non la moyenne des sommets : le modèle double certains sommets (coutures de
# texture), la moyenne tombait à 3 mm du centre et la cassette sortait de l'étui.
_xs, _ys, _zs = ([v.co[k] for v in me.vertices] for k in range(3))
c = Vector(((min(_xs) + max(_xs)) / 2, (min(_ys) + max(_ys)) / 2, (min(_zs) + max(_zs)) / 2))
print('COTES du modèle', [round(max(q) - min(q), 4) for q in (_xs, _ys, _zs)])
me.transform(Matrix.Scale(0.1, 4) @ Matrix.Translation(-c))        # 2 unités → 20 cm ; X = longueur, Y = largeur, Z = épaisseur
bm = bmesh.new()
bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])                   # vers l'extérieur, quoi qu'ait fait l'import
bm.normal_update()
bouts = [f for f in bm.faces if abs(f.normal.x) > 0.9]
ouvert = max(bouts, key=lambda f: sum(l[uvl].uv.y for l in f.loops))    # le bout dessiné en haut de la toile : côté de l'encoche
SENS = 1 if ouvert.calc_center_median().x > 0 else -1
bmesh.ops.delete(bm, geom=[f for f in bouts if f.calc_center_median().x * SENS > 0], context='FACES')
print('BOUT OUVERT côté', SENS, '| normales sortantes :', all(f.normal.dot(f.calc_center_median()) > 0 for f in bm.faces))
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
bm.to_mesh(me)
bm.free()
me.materials.clear()
me.materials.append(mat_jaquette())
me.materials.append(mat_carton())
etui = bpy.data.objects.new('etui', me)
scene.collection.objects.link(etui)
for p in me.polygons:
    p.use_smooth = True
bv = etui.modifiers.new('plis', 'BEVEL')                 # les plis du carton : arrondis, jamais vifs
bv.width, bv.segments, bv.limit_method, bv.angle_limit = 0.0009, 3, 'ANGLE', math.radians(40)
tx = bpy.data.textures.new('gondole', 'CLOUDS')
tx.noise_scale = 0.09
dp = etui.modifiers.new('gondole', 'DISPLACE')           # un panneau de carton n'est jamais tout à fait plat
dp.texture, dp.strength, dp.mid_level, dp.texture_coords = tx, 0.0011, 0.5, 'LOCAL'
tx2 = bpy.data.textures.new('bord_fatigue', 'CLOUDS')
tx2.noise_scale = 0.012
dp2 = etui.modifiers.new('bord_fatigue', 'DISPLACE')     # le bord et les faces fatigués : de petites ondulations
dp2.texture, dp2.strength, dp2.mid_level, dp2.texture_coords = tx2, 0.00035, 0.5, 'LOCAL'
so = etui.modifiers.new('epaisseur', 'SOLIDIFY')         # 0,7 mm de carton : on voit sa tranche au bout ouvert
so.thickness, so.offset, so.material_offset, so.material_offset_rim = 0.0010, -1.0, 1, 1

# La cassette dans l'étui, en retrait de 3 mm du bord, et l'étiquette du club sur sa tranche visible.
LX, LY, LZ = 0.187, 0.103, 0.025
cm = bpy.data.meshes.new('cassette')
b = bmesh.new()
bmesh.ops.create_cube(b, size=1.0)
for v in b.verts:
    v.co = Vector((v.co.x * LX, v.co.y * LY, v.co.z * LZ))
b.to_mesh(cm)
b.free()
cm.materials.append(mat_plastique())
cass = bpy.data.objects.new('cassette', cm)
scene.collection.objects.link(cass)
cass.location = (SENS * (0.100 - 0.003 - LX / 2), 0, 0)
cb = cass.modifiers.new('aretes', 'BEVEL')
cb.width, cb.segments = 0.0012, 3
# Le bout visible de la cassette, détaillé d'après la référence : le volet articulé de la bande (en relief, avec sa
# gorge et son axe), le joint des deux demi-coques, trois nervures de préhension.
def piece(nom, cy, cz, ly, lz, saillie, mat=None):
    m_ = bpy.data.meshes.new(nom)
    b_ = bmesh.new()
    bmesh.ops.create_cube(b_, size=1.0)
    for v in b_.verts:
        v.co = Vector((v.co.x * saillie, v.co.y * ly, v.co.z * lz))
    b_.to_mesh(m_)
    b_.free()
    m_.materials.append(mat or cm.materials[0])
    o_ = bpy.data.objects.new(nom, m_)
    scene.collection.objects.link(o_)
    o_.location = (SENS * (0.100 - 0.003 + saillie / 2 - 0.0001), cy * SENS, cz)
    bb = o_.modifiers.new('aretes', 'BEVEL')
    bb.width, bb.segments = min(0.0004, saillie / 3), 2
    return o_


chrome = bpy.data.materials.new('axe')
chrome.use_nodes = True
chrome.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 1.0
chrome.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
piece('volet_bande', 0.0335, 0.0002, 0.031, 0.0228, 0.0014)
piece('volet_gorge', 0.0170, -0.0030, 0.0022, 0.0080, 0.0019)
piece('volet_levre', 0.0335, 0.0100, 0.031, 0.0012, 0.0020)
piece('joint_coques', -0.018, 0.0072, 0.064, 0.0004, 0.0005)
for _k in range(3):
    piece(f'nervure_{_k}', -0.0492, -0.006 + _k * 0.006, 0.0018, 0.0035, 0.0007)
piece('axe_volet', 0.0500, 0.0, 0.0012, 0.0210, 0.0016, chrome)
em = bpy.data.materials.new('etiquette_club')
em.use_nodes = True
ent = em.node_tree
eco = ent.nodes.new('ShaderNodeTexCoord')
et = tex(ent, img(TEX / 'etiquette-club.png'), eco.outputs['UV'])       # fabriquée par k7_etiquette.py
ent.links.new(et.outputs['Color'], ent.nodes['Principled BSDF'].inputs['Base Color'])
ent.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.35
ent.nodes['Principled BSDF'].inputs['Coat Weight'].default_value = 0.3
ent.links.new(et.outputs['Alpha'], ent.nodes['Principled BSDF'].inputs['Alpha'])
lm = bpy.data.meshes.new('etiquette')
b = bmesh.new()
u = b.loops.layers.uv.new()
x = SENS * (0.100 - 0.003 + 0.0002)
pts = [(x, -0.046 * SENS, -0.0085), (x, 0.014 * SENS, -0.0085), (x, 0.014 * SENS, 0.0055), (x, -0.046 * SENS, 0.0055)]
f = b.faces.new([b.verts.new(p) for p in pts])
for l, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    l[u].uv = t
b.to_mesh(lm)
b.free()
lm.materials.append(em)
scene.collection.objects.link(bpy.data.objects.new('etiquette', lm))

groupe = bpy.data.objects.new('k7', None)
scene.collection.objects.link(groupe)
for o in list(scene.objects):
    if o is not groupe:
        o.parent = groupe

# ----- le décor et la lumière -----
world = bpy.data.worlds.new('rue')
scene.world = world
world.use_nodes = True
wn = world.node_tree
env = wn.nodes.new('ShaderNodeTexEnvironment')
env.image = img(M / 'rue-nuit.hdr')
wm = wn.nodes.new('ShaderNodeMapping')
wm.inputs['Rotation'].default_value = (0, 0, math.radians(110))
wc = wn.nodes.new('ShaderNodeTexCoord')
wn.links.new(wc.outputs['Generated'], wm.inputs['Vector'])
wn.links.new(wm.outputs['Vector'], env.inputs['Vector'])
wn.links.new(env.outputs['Color'], wn.nodes['Background'].inputs['Color'])
wn.nodes['Background'].inputs['Strength'].default_value = 0.3

sm = bpy.data.materials.new('tablette')            # la tablette d'acier peint de la vitrine
sm.use_nodes = True
snt = sm.node_tree
spb = snt.nodes['Principled BSDF']
sco = snt.nodes.new('ShaderNodeTexCoord')
st = tex(snt, img(M / 'SurfaceImperfections015' / 'SurfaceImperfections015_1K-JPG_Roughness.jpg', False), sco.outputs['Object'], 3.0, 'BOX')
spb.inputs['Base Color'].default_value = (0.30, 0.31, 0.31, 1)
spb.inputs['Metallic'].default_value = 1.0
snt.links.new(calc(snt, 'ADD', 0.22, calc(snt, 'MULTIPLY', st.outputs['Color'], 0.4)), spb.inputs['Roughness'])
bpy.ops.mesh.primitive_plane_add(size=1.2)
sol = bpy.context.object
sol.data.materials.append(sm)

tube = bpy.data.lights.new('tube', 'AREA')          # le tube de la vitrine, au-dessus et un peu en avant
tube.shape, tube.size, tube.size_y, tube.energy, tube.color = 'RECTANGLE', 0.5, 0.03, 3.5, (0.92, 0.97, 1.0)
to = bpy.data.objects.new('tube', tube)
scene.collection.objects.link(to)

cam_d = bpy.data.cameras.new('appareil')
cam = bpy.data.objects.new('appareil', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.lens = 85
cam_d.dof.use_dof = True


def vise(pos, cible, diaph):
    cam.location = pos
    cam.rotation_euler = (Vector(cible) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    cam_d.dof.focus_distance = (Vector(cible) - Vector(pos)).length
    cam_d.dof.aperture_fstop = diaph


if VUE == 'vitrine':     # dans sa situation réelle : sur une tablette de la vitrine, sous le tube, entre ses voisines
    PAS = 0.031
    debout = (0, math.radians(-90 * SENS), 0)
    RECUL = 0.05547 - 0.014          # l'étui fait 111 mm de large : sa tranche arrive à 14 mm du bord de la tablette
    groupe.rotation_euler, groupe.location = debout, (0, RECUL, 0.100 + 0.0008)
    jaq = me.materials[0]
    for k, tmdb in enumerate(VOISINES):
        m2 = jaq.copy()
        for n in m2.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('jaquette-servie'):
                n.image = img(TEX / (f'voisine-{tmdb}-relief.png' if 'relief' in n.image.name else f'voisine-{tmdb}.png'), 'relief' not in n.image.name)
            elif n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('usure-tranche'):
                n.image = img(TEX / f'usure-tranche-{k + 1}.png', False)
            elif n.name == 'passe':
                n.outputs[0].default_value = PASSE[NIVEAU[k + 1]]
        me2 = me.copy()
        me2.materials[0] = m2
        g2 = bpy.data.objects.new(f'k7_{tmdb}', None)
        scene.collection.objects.link(g2)
        e2 = etui.copy()
        e2.data = me2
        c2 = cass.copy()
        for o in (e2, c2):
            scene.collection.objects.link(o)
            o.parent = g2
        rang = k - 3 if k < 3 else k - 2                      # trois à gauche, trois à droite de « La Mouche »
        g2.rotation_euler, g2.location = debout, (rang * PAS, RECUL, 0.100 + 0.0008)
    sol.hide_render = True

    def pave(nom, x0, x1, y0, y1, z0, z1, mat):
        m_ = bpy.data.meshes.new(nom)
        b_ = bmesh.new()
        bmesh.ops.create_cube(b_, size=1.0)
        for v in b_.verts:
            v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
        b_.to_mesh(m_)
        b_.free()
        m_.materials.append(mat)
        o_ = bpy.data.objects.new(nom, m_)
        scene.collection.objects.link(o_)
        bb = o_.modifiers.new('aretes', 'BEVEL')
        bb.width, bb.segments = 0.0004, 2
        return o_

    noir = bpy.data.materials.new('fond_vitrine')
    noir.use_nodes = True
    noir.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
    noir.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    L4 = 3.5 * PAS + 0.004
    pave('tablette', -L4, L4, -0.022, 0.118, -0.004, 0.0, sm)                 # la tablette d'acier
    pave('retour', -L4, L4, -0.024, -0.022, -0.004, 0.012, sm)                # son retour avant, qui retient les étuis
    for k in range(8):                                                        # le peigne : une lame entre deux cases
        pave(f'lame_{k}', (k - 3.5) * PAS - 0.00075, (k - 3.5) * PAS + 0.00075, -0.002, 0.112, 0.0, 0.085, sm)
    pave('fond', -0.3, 0.3, 0.120, 0.122, -0.1, 0.4, noir)
    pave('dessous', -0.3, 0.3, -0.03, 0.122, -0.2, -0.004, noir)
    tm = bpy.data.materials.new('tube_allume')
    tm.use_nodes = True
    te = tm.node_tree.nodes.new('ShaderNodeEmission')
    te.inputs['Color'].default_value, te.inputs['Strength'].default_value = (0.9, 0.96, 1.0, 1), 4.0
    tm.node_tree.links.new(te.outputs['Emission'], tm.node_tree.nodes['Material Output'].inputs['Surface'])
    pave('tube_visible', -L4, L4, -0.085, -0.072, 0.262, 0.275, tm)
    tube.size, tube.energy = 2 * L4, float(__import__('os').environ.get('TUBE', 1.2))     # Rusmir, 22/11 : un peu trop lumineux à 2,2
    to.location, to.rotation_euler = (0, -0.075, 0.258), (math.radians(22), 0, 0)
    wn.nodes['Background'].inputs['Strength'].default_value = 0.12             # la rue, faible, derrière l'appareil
    scene.render.resolution_x, scene.render.resolution_y = 1700, 1600
    vise((0.035, -0.64, 0.118), (0.0, -0.014, 0.102), 5.6)
elif VUE == 'bout':      # comme la photo de référence : l'étui à plat, le bout ouvert vers nous
    groupe.rotation_euler = (0, 0, math.radians(90 if SENS > 0 else -90) + math.radians(180))
    groupe.location = (0, 0, 0.0143 + 0.0006)
    to.location, to.rotation_euler = (0.05, -0.25, 0.42), (math.radians(28), 0, 0)
    vise((0.02, -0.52, 0.055), (0, -0.10, 0.016), 8.0)
else:                    # comme dans la vitrine : debout, la tranche vers nous, vue légèrement de biais
    groupe.rotation_euler = (0, math.radians(-90 * SENS), math.radians(0))
    groupe.location = (0, 0, 0.100 + 0.0006)
    to.location, to.rotation_euler = (0.0, -0.10, 0.42), (math.radians(14), 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = 1100, 1800
    vise((0.13, -0.50, 0.125), (0.0, -0.055, 0.105), 8.0)

scene.render.filepath = SORTIE
bpy.ops.render.render(write_still=True)
print('FINI', VUE, SORTIE)
