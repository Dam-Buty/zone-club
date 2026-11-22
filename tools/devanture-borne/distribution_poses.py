"""La distribution de la K7 : images clés du robot, à faire valider AVANT d'animer.

blender -b --factory-startup --python-exit-code 1 -P distribution_poses.py -- <échantillons> [<poses>] [<vues>]
Sorties : <dossier de la variante>/distribution/cle-<pose>-<vue>.png (fond transparent).

Conception : docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md (§ 5, § 6). La scène est celle de
borne.py, sans une ligne changée : ce script l'exécute jusqu'à son rendu, puis déplace les pièces du robot et la K7
servie. Le robot a trois mouvements : la traverse monte et descend (Z), le chariot court sur la traverse (X), le
tiroir à deux doigts avance et recule (Y). Pour sortir une K7 de sa case, la traverse se soulève de la hauteur du
retour de la tablette : la K7 passe par-dessus et glisse sur le plateau.
"""
import sys
from pathlib import Path

_ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(_ICI))
from variante import D as _D  # noqa: E402

_a = sys.argv[sys.argv.index('--') + 1:]
_ECH = _a[0] if _a else '96'
_SENS = -90      # sens de pose de l'étui du vidéoclub (tranche vers la vitre, haut de la jaquette en haut)
_POSES = _a[1].split(',') if len(_a) > 1 else ['repos', 'saisie', 'descente', 'sortie']
_VUES = _a[2].split(',') if len(_a) > 2 else ['borne', 'vitrine', 'fente']
_OUT = _D / 'distribution'
_OUT.mkdir(exist_ok=True)

sys.argv = sys.argv[:sys.argv.index('--') + 1] + [_ECH, str(_OUT / 'tmp.png'), 'borne']
_source = (_ICI / 'borne.py').read_text()
_tete = _source.split('scene.render.filepath = OUT')[0]
assert _tete != _source, 'borne.py : la ligne du rendu est introuvable'
exec(compile(_tete, str(_ICI / 'borne.py'), 'exec'), globals())

# ----- la K7 servie : détachée du casier, pour pouvoir la déplacer -----
_rows, _n = rk_g['rows'], rk_g['n_slots']
_k7s = bpy.data.objects['casier_g_k7']


def _faces_de(bm, rang, case):
    xc, zb = L(rk_g['xa'] + (case + 0.5) * PITCH), _rows[rang]
    return [f for f in bm.faces if all(abs(v.co.x - xc) < K7_W / 2 + 0.002 and zb - 0.001 < v.co.z < zb + K7_H + 0.002 for v in f.verts)]


_bm = bmesh.new()
_bm.from_mesh(_k7s.data)
_RANG = len(_rows) - 2                                   # la rangée sous celle du haut : à hauteur de l'écran
_CASE = next(c for c in sorted(range(_n), key=lambda c: abs(c - _n // 2)) if _faces_de(_bm, _RANG, c))
_uv0 = _bm.loops.layers.uv.active
_ZB = _rows[_RANG]


def _arrondi(ob):
    """Un étui en carton a des angles vifs : juste de quoi accrocher la lumière sur l'arête (0,5 mm)."""
    bv = ob.modifiers.new('arete', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = 0.0005, 1, 'ANGLE'


def _detache(case, nom):
    """Ôte une K7 du casier et la refait seule (mêmes cotes, même tranche) pour pouvoir la déplacer."""
    garde = _faces_de(_bm, _RANG, case)
    tranche = next(f for f in garde if f.material_index == 0)
    ligne = round((1 - max(l[_uv0].uv.y for l in tranche.loops)) * N_ATLAS)
    bmesh.ops.delete(_bm, geom=garde, context='FACES')
    me = bpy.data.meshes.new(nom)
    b = bmesh.new()
    ob = bpy.data.objects.new(nom, me)
    scene.collection.objects.link(ob)
    for m in (spine, case_plastic):
        me.materials.append(m)
    uv = b.loops.layers.uv.new()
    for f in add_box(b, -K7_W / 2, K7_W / 2, -K7_D / 2, K7_D / 2, -K7_H / 2, K7_H / 2, 1):
        f.normal_update()
        if f.normal.y < -0.9:
            f.material_index = 0
            for l in f.loops:
                u = (K7_H / 2 - l.vert.co.z) / K7_H
                t = (l.vert.co.x + K7_W / 2) / K7_W
                l[uv].uv = (u, 1 - (ligne + 1 - t) / N_ATLAS)
    b.normal_update()
    b.to_mesh(me)
    b.free()
    ob.location = (L(rk_g['xa'] + (case + 0.5) * PITCH), Y_RACK_G + K7_D / 2, _ZB + 0.0005 + K7_H / 2)
    _arrondi(ob)
    return ob, ligne


_VOISINES = [_detache(c, f'k7_voisine_{c}')[0] for c in (_CASE - 1, _CASE + 1) if 0 <= c < _n and _faces_de(_bm, _RANG, c)]
_VOISINES_BASE = [o.location.copy() for o in _VOISINES]
K7, _ligne = _detache(_CASE, 'k7_servie')
_bm.to_mesh(_k7s.data)
_bm.free()
# La K7 servie est le modèle du vidéoclub lui-même (public/models/vhs_cassette_tape.glb), habillé de la jaquette que
# l'application fabrique pour ce film (capturée dans le navigateur : affiche, tranche, dos, et son relief).
_JAQ = _D / 'tex' / 'jaquette-servie.png'
assert _JAQ.exists() and _ligne == 25, 'jaquette capturée pour « La Mouche » (ligne 25) seulement'
from mathutils import Matrix as _M, Vector as _V  # noqa: E402
_avant = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(_ICI.parents[1] / 'public' / 'models' / 'vhs_cassette_tape.glb'))
bpy.context.view_layer.update()
_neufs = [o for o in bpy.data.objects if o not in _avant]
_glb = next(o for o in _neufs if o.type == 'MESH')
_me = _glb.data.copy()
_me.transform(_glb.matrix_world)
_c = sum((v.co for v in _me.vertices), _V()) / len(_me.vertices)
_me.transform(_M.Rotation(math.radians(_SENS), 4, 'Y') @ _M.Scale(K7_H / 2.0, 4) @ _M.Translation(-_c))   # 2 unités de haut → 20 cm
for _o in _neufs:
    bpy.data.objects.remove(_o, do_unlink=True)
jaquette = principled('jaquette_servie', **{'Roughness': 0.9})
_jn = jaquette.node_tree
_jn.links.new(tex_node(jaquette, bpy.data.images.load(str(_JAQ))).outputs['Color'], _jn.nodes['Principled BSDF'].inputs['Base Color'])
_rel = bpy.data.images.load(str(_D / 'tex' / 'jaquette-servie-relief.png'))
_rel.colorspace_settings.name = 'Non-Color'
_bp = _jn.nodes.new('ShaderNodeBump')
_bp.inputs['Strength'].default_value, _bp.inputs['Distance'].default_value = 0.8, 0.0004
_jn.links.new(tex_node(jaquette, _rel).outputs['Color'], _bp.inputs['Height'])
_jn.links.new(_bp.outputs['Normal'], _jn.nodes['Principled BSDF'].inputs['Normal'])
_me.materials.clear()
_me.materials.append(jaquette)
K7.modifiers.clear()
K7.data = _me
print('K7 SERVIE : modèle du vidéoclub,', [round(d, 4) for d in K7.dimensions])
_XC = rk_g['xa'] + (_CASE + 0.5) * PITCH
_K7_CASE = tuple(K7.location)
for _nom in ('casier_g_k7', 'casier_d_k7'):
    _arrondi(bpy.data.objects[_nom])
print('K7 SERVIE rangée', _RANG, 'case', _CASE, 'ligne d\'atlas', _ligne, '| voisines', len(_VOISINES))

# ----- l'étui : celui du vidéoclub (public/models/vhs_cassette_tape.glb), en carton imprimé, à angles vifs -----
# Les tranches refaites sur ce modèle viennent de distribution_tranches.py ; tranches.png (image validée) reste intact.
_etui = _D / 'tex' / 'tranches-etui.png'
assert _etui.exists(), 'lancer d\'abord : python3 distribution_tranches.py'
_pb = spine.node_tree.nodes['Principled BSDF']
_pb.inputs['Base Color'].links[0].from_node.image = bpy.data.images.load(str(_etui))
# La matière est celle du vidéoclub (VHSCaseViewer.tsx) : carton mat (rugosité 1 là-bas), sans vernis, et le relief
# des titres donné par la seconde toile du générateur (bumpMap d'échelle 1,2).
_pb.inputs['Roughness'].default_value = 0.9
_pb.inputs['Coat Weight'].default_value = 0.0
_relief = bpy.data.images.load(str(_D / 'tex' / 'tranches-etui-relief.png'))
_relief.colorspace_settings.name = 'Non-Color'
_bosse = spine.node_tree.nodes.new('ShaderNodeBump')
_bosse.inputs['Strength'].default_value, _bosse.inputs['Distance'].default_value = 0.8, 0.0004
spine.node_tree.links.new(tex_node(spine, _relief).outputs['Color'], _bosse.inputs['Height'])
spine.node_tree.links.new(_bosse.outputs['Normal'], _pb.inputs['Normal'])

# ----- le papier, d'après la K7 de référence validée par Rusmir le 22/11/2026 (k7_reference.py) : le pelliculage est
# parti — surface mate, presque plus de reflet propre ; l'usure (bords, cassures de l'encre, couleurs passées selon
# l'âge du film) est cuite dans l'image par distribution_tranches.py, son masque rend le papier à nu plus rêche -----
def _papier(mat, image, masque):
    nt = mat.node_tree
    pb = nt.nodes['Principled BSDF']
    pb.inputs['Base Color'].links[0].from_node.image = bpy.data.images.load(str(image))
    m = bpy.data.images.load(str(masque))
    m.colorspace_settings.name = 'Non-Color'
    nt.links.new(math_node(nt, 'ADD', 0.84, math_node(nt, 'MULTIPLY', tex_node(mat, m).outputs['Color'], 0.12)), pb.inputs['Roughness'])
    pb.inputs['Specular IOR Level'].default_value = 0.22
    pb.inputs['Coat Weight'].default_value = 0.0


for _f in ('tranches-etui-usees.png', 'jaquette-servie-usee.png'):
    assert (_D / 'tex' / _f).exists(), 'lancer d\'abord : python3 distribution_tranches.py'
_papier(spine, _D / 'tex' / 'tranches-etui-usees.png', _D / 'tex' / 'tranches-etui-usure.png')
_papier(jaquette, _D / 'tex' / 'jaquette-servie-usee.png', _D / 'tex' / 'jaquette-servie-usure.png')

# ----- le volet de la fente : un clapet articulé en haut, que la machine relève vers l'intérieur avant de pousser la K7 -----
_fx0, _fx1, _fz0, _fz1 = F['fente']
_vm = bpy.data.meshes.new('volet_fente')
_vb = bmesh.new()
add_box(_vb, -(_fx1 - _fx0) / 2 + 0.001, (_fx1 - _fx0) / 2 - 0.001, 0.0, 0.002, -(_fz1 - _fz0) + 0.001, 0.0)
_vb.normal_update()
_vb.to_mesh(_vm)
_vb.free()
VOLET = bpy.data.objects.new('volet_fente', _vm)
scene.collection.objects.link(VOLET)
_vm.materials.append(lecteur)     # même plastique noir marqué que le lecteur de carte
VOLET.location = (L((_fx0 + _fx1) / 2), YB + 0.0015, _fz1)
_vbv = VOLET.modifiers.new('arete', 'BEVEL')
_vbv.width, _vbv.segments = 0.0005, 2

# ----- les autocollants : un papier collé sur une vitre éclairée par-derrière laisse passer la lumière dans ses
# zones claires (Rusmir, 22/11/2026) -----
for _m in [m for m in bpy.data.materials if m.name.startswith('autocollant_')]:
    _n = _m.node_tree
    _p = _n.nodes['Principled BSDF']
    _sortie = _n.nodes['Material Output']
    _img = _p.inputs['Base Color'].links[0].from_node
    _lum = _n.nodes.new('ShaderNodeRGBToBW')
    _n.links.new(_img.outputs['Color'], _lum.inputs['Color'])
    _tl = _n.nodes.new('ShaderNodeBsdfTranslucent')
    _n.links.new(_img.outputs['Color'], _tl.inputs['Color'])
    _tp = _n.nodes.new('ShaderNodeBsdfTransparent')
    _decoupe = _n.nodes.new('ShaderNodeMixShader')
    _n.links.new(_img.outputs['Alpha'], _decoupe.inputs['Fac'])
    _n.links.new(_tp.outputs['BSDF'], _decoupe.inputs[1])
    _n.links.new(_tl.outputs['BSDF'], _decoupe.inputs[2])
    _mel = _n.nodes.new('ShaderNodeMixShader')
    _n.links.new(math_node(_n, 'MULTIPLY', _lum.outputs['Val'], 0.35), _mel.inputs['Fac'])
    _n.links.new(_p.outputs['BSDF'], _mel.inputs[1])
    _n.links.new(_decoupe.outputs['Shader'], _mel.inputs[2])
    _n.links.new(_mel.outputs['Shader'], _sortie.inputs['Surface'])

# ----- la pince, refaite ajourée : deux doigts sur coulisseaux, une tige de guidage et une vis, un socle bas -----
# L'ancien tiroir était un bloc plein devant la K7. Ici, vus de face : le socle sous le titre, deux fines barres en
# travers, les coulisseaux de part et d'autre ; la tranche reste visible entre les doigts.
from mathutils import Matrix  # noqa: E402

for _o in [o for o in scene.objects if o.name.startswith(('robot_tiroir', 'robot_moteur_pince', 'robot_doigt_', 'robot_patin_'))]:
    bpy.data.objects.remove(_o, do_unlink=True)
laiton = principled('laiton', **{'Base Color': (0.72, 0.52, 0.2, 1), 'Metallic': 1.0, 'Roughness': 0.35})


def _tige(nom, x0, x1, y, z, r, mat):
    me = bpy.data.meshes.new(nom)
    b = bmesh.new()
    bmesh.ops.create_cone(b, cap_ends=True, segments=16, radius1=r, radius2=r, depth=x1 - x0, matrix=Matrix.Rotation(math.pi / 2, 4, 'Y'))
    b.to_mesh(me)
    b.free()
    ob = bpy.data.objects.new('robot_' + nom, me)
    scene.collection.objects.link(ob)
    me.materials.append(mat)
    ob.location = (L((x0 + x1) / 2), y, z)
    return ob


PARQUE, OUVERT, SERRE = 0.0015, 0.0150, 0.0143     # demi-écart entre les patins : rangés, ouverts sur la K7, serrés
part('tiroir_socle', L(CX - 0.026), L(CX + 0.026), FRONT + 0.020, FRONT + 0.040, ZB + 0.003, ZB + 0.015, alu_noir, 0.0015)
part('tiroir_palier', L(CX - 0.026), L(CX - 0.021), FRONT + 0.022, FRONT + 0.034, ZB + 0.015, ZB + 0.052, alu, 0.0008)
part('tiroir_montant', L(CX + 0.021), L(CX + 0.026), FRONT + 0.022, FRONT + 0.034, ZB + 0.015, ZB + 0.030, alu, 0.0008)
part('moteur_pince', L(CX + 0.021), L(CX + 0.039), FRONT + 0.020, FRONT + 0.038, ZB + 0.030, ZB + 0.052, alu_noir, 0.002)
_tige('tiroir_tige', CX - 0.022, CX + 0.022, FRONT + 0.028, ZB + 0.036, 0.002, acier)
_tige('tiroir_vis', CX - 0.022, CX + 0.022, FRONT + 0.028, ZB + 0.046, 0.0015, laiton)
_DOIGTS = {-1: [], 1: []}
for _s, _sfx in ((-1, 'g'), (1, 'd')):
    _x = lambda a, b: sorted((L(CX + _s * (PARQUE + a)), L(CX + _s * (PARQUE + b))))  # noqa: E731
    _DOIGTS[_s].append(part('doigt_coul_' + _sfx, *_x(-0.0005, 0.0055), FRONT + 0.022, FRONT + 0.034, ZB + 0.030, ZB + 0.052, alu, 0.0008))
    _DOIGTS[_s].append(part('doigt_' + _sfx, *_x(0.0015, 0.0035), FRONT + 0.034, FRONT + 0.092, ZB + 0.032, ZB + 0.062, alu, 0))
    _DOIGTS[_s].append(part('patin_' + _sfx, *_x(0.0, 0.0015), FRONT + 0.074, FRONT + 0.092, ZB + 0.036, ZB + 0.058, caoutchouc, 0))

# ----- les trois groupes de pièces, emboîtés -----
_Y = ('tiroir', 'moteur_pince', 'doigt_', 'patin_')
_X = _Y + ('chariot', 'plateau', 'guide_', 'voyant')
_Z = _X + ('equerre_', 'traverse', 'courroie_x', 'moteur_x')


def _groupe(prefixes):
    return [o for o in scene.objects if o.name.startswith('robot_') and o.name[6:].startswith(prefixes)]


_GY, _GX, _GZ = _groupe(_Y), _groupe(_X), _groupe(_Z)
assert _GY and len(_GX) > len(_GY) and len(_GZ) > len(_GX), 'pièces du robot introuvables'
_BASE = {o.name: o.location.copy() for o in _GZ}

# ----- les poses -----
LEVEE = 0.0135                 # la traverse se soulève : la K7 passe le retour de la tablette (12 mm)
COURSE = 0.098                 # course du tiroir : les patins pincent les 2 premiers centimètres de la K7
_FENTE = F['fente']
_DX, _DZ = _XC - CX, _ZB - ZB  # de la case de repos de borne.py à la case servie


def pose(nom):
    """Rend (dx, dz, dy, position de la K7, rotation de la K7 autour de Y en degrés)."""
    x, y, z = _K7_CASE
    if nom == 'repos':
        return 0.0, 0.0, 0.0, (x, y, z), 0.0
    if nom == 'saisie':        # doigts refermés sur la K7, soulevée, à mi-course du retrait
        return _DX, _DZ + LEVEE, COURSE / 2, (x, y - COURSE / 2, z + LEVEE), 0.0
    if nom == 'descente':      # K7 sur le plateau, tiroir rentré, la traverse descend vers le bas de la vitrine
        bas = _rows[0] - ZB + 0.02
        return _DX, bas, 0.0, (x, y - COURSE, z - _ZB + _rows[0] + 0.02), 0.0
    if nom == 'sortie':        # le robot est reparti au repos, la K7 sort couchée de la fente, à moitié
        fx, fz = L((_FENTE[0] + _FENTE[1]) / 2), (_FENTE[2] + _FENTE[3]) / 2
        return 0.0, 0.0, 0.0, (fx, YB - 0.004, fz), -90.0
    raise SystemExit('pose inconnue : ' + nom)


def applique(nom):
    dx, dz, dy, k7, rot = pose(nom)
    for o in _GZ:
        o.location = _BASE[o.name].copy()
        o.location.z += dz
    for o in _GX:
        o.location.x += dx
    for o in _GY:
        o.location.y += dy
    K7.location = k7
    K7.rotation_euler = (0, math.radians(rot), 0)


# ----- les vues : l'appareil reste face au mur -----
VUES = {
    # nom : (centre x local, centre z, hauteur du cadre en m, largeur px, hauteur px)
    'borne': (0.0, 1.06, 2.24, 1080, 1936),
    'vitrine': (-0.33, _ZB + 0.02, 0.62, 1080, 1440),
    'fente': (0.165, 0.93, 0.42, 1440, 1080),
}
scene.render.use_border = False
for _v in _VUES:
    cx, cz, hh, w_, h_ = VUES[_v]
    scene.render.resolution_x, scene.render.resolution_y = w_, h_
    dist = 3.0
    cam.location = (L(cx), -dist, cz)
    cam_data.shift_x = cam_data.shift_y = 0.0
    cam_data.lens = 36 * dist / hh
    for _p in _POSES:
        if _v == 'vitrine' and _p == 'sortie' or _v == 'fente' and _p not in ('repos', 'sortie'):
            continue
        applique(_p)
        scene.render.filepath = str(_OUT / f'cle-{_p}-{_v}.png')
        bpy.ops.render.render(write_still=True)
        print('IMAGE CLÉ', _p, _v, flush=True)
print('FINI')
