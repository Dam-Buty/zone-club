"""Le visiteur devant la fente, que l'on ne voit pas, et le lampadaire derrière lui — communs aux films de la borne.

Rusmir, 26/11/2026 (spec 2026-11-26-borne-retour-k7-design, § 5.6) : le visiteur se tient collé à la borne, un peu à
droite de la fente. Son corps n'apparaît pas à l'image mais arrête la lumière ; un lampadaire derrière lui, presque
au-dessus, passe au-dessus de ses épaules : la main est éclairée et l'ombre du corps tombe sur la borne et sur le bras.
« Pourquoi pas tout uniformiser dans les 120 W » : le même lampadaire et le même visiteur dans le film de location et
dans le film de retour, au téléphone comme sur PC. Jamais dans la scène de la rue (SCENE_SEULE) : elle a ses lumières.

Repère : l'origine O est le centre de la K7 arrêtée à la fente, glissé de MAIN_X vers la droite (là où la main la
pousse) ; +Y entre dans la borne, +Z monte. Les cotes viennent de l'atelier de la main : coude et épaule mesurés sur la
pose retenue.
"""
import bpy
from mathutils import Vector

MAIN_X = 0.045                       # la main pousse la K7 un peu à droite de son milieu : la tranche reste visible
COUDE, EPAULE = (0.308, -0.26, 0.266), (0.32, -0.36, 0.57)
LAMPADAIRE = (0.12, -0.75, 3.0)      # derrière le visiteur, presque au-dessus de lui (~70° au-dessus de l'horizon)
LAMPADAIRE_TAILLE = 0.25
LAMPADAIRE_COULEUR = (1.0, 0.82, 0.62)
PUISSANCE_BORNE = 120.0              # ce que reçoit toute la scène
PUISSANCE_MAIN = 350.0               # ce que reçoivent la main et la manche (le complément ne porte que sur elles)


def origine(k7):
    """O, à partir de la K7 telle qu'elle est posée à l'arrêt sur la fente (à appeler après l'avoir placée)."""
    vs = [k7.matrix_world @ v.co for v in k7.data.vertices]
    milieu = [(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)]
    return Vector((milieu[0] + MAIN_X, milieu[1] - 0.0055, milieu[2]))


def _invisible(o, mat):
    o.data.materials.append(mat)
    o.visible_camera = o.visible_glossy = o.visible_diffuse = False
    o.visible_transmission = o.visible_volume_scatter = False
    o.visible_shadow = True


def corps(scene, O):
    """Torse, jambes, tête et bras, en volumes simples : ils ne se voient pas, ils font de l'ombre."""
    mat = bpy.data.materials.new('visiteur')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
    pieces = []

    def boite(nom, centre, dims):
        bpy.ops.mesh.primitive_cube_add(size=1, location=O + Vector(centre))
        o = bpy.context.active_object
        o.name, o.scale = nom, dims
        pieces.append(o)

    def cylindre(nom, a, b, r):
        a, b = O + Vector(a), O + Vector(b)
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=(b - a).length, location=(a + b) / 2, vertices=24)
        o = bpy.context.active_object
        o.name, o.rotation_euler = nom, (b - a).to_track_quat('Z', 'Y').to_euler()
        pieces.append(o)

    boite('visiteur_torse', (0.13, -0.42, 0.25), (0.40, 0.24, 0.70))
    boite('visiteur_jambes', (0.13, -0.42, -0.48), (0.34, 0.22, 0.80))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.105, location=O + Vector((0.12, -0.44, 0.80)))
    bpy.context.active_object.name = 'visiteur_tete'
    pieces.append(bpy.context.active_object)
    cylindre('visiteur_bras', EPAULE, COUDE, 0.05)
    cylindre('visiteur_bras_gauche', (-0.06, -0.40, 0.57), (-0.10, -0.40, 0.05), 0.045)
    for o in pieces:
        if o.users_collection and scene.collection not in o.users_collection:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            scene.collection.objects.link(o)
        _invisible(o, mat)
    return pieces


def _lampe(scene, nom, O, puissance):
    ld = bpy.data.lights.new(nom, 'AREA')
    ld.size, ld.energy, ld.color = LAMPADAIRE_TAILLE, puissance, LAMPADAIRE_COULEUR
    lo = bpy.data.objects.new(nom, ld)
    scene.collection.objects.link(lo)
    lo.location = O + Vector(LAMPADAIRE)
    lo.rotation_euler = (O - lo.location).to_track_quat('-Z', 'Y').to_euler()
    return lo


def lampadaire(scene, O, main=()):
    """Le lampadaire sur toute la scène ; et, si `main` nomme des objets (la main, la manche), le complément qui ne
    porte que sur eux (même place, même couleur), jusqu'à PUISSANCE_MAIN en tout."""
    lampes = [_lampe(scene, 'lampadaire', O, PUISSANCE_BORNE)]
    if main:
        lo = _lampe(scene, 'lampadaire_main', O, PUISSANCE_MAIN - PUISSANCE_BORNE)
        rc = bpy.data.collections.new('recoit_lampadaire_main')
        for o in main:
            rc.objects.link(o)
        lo.light_linking.receiver_collection = rc
        for co in rc.collection_objects:
            co.light_linking.link_state = 'INCLUDE'
        lampes.append(lo)
    return lampes


def installe(scene, k7, main=()):
    """Le visiteur et le lampadaire, la K7 déjà placée à l'arrêt sur la fente. Rend O."""
    bpy.context.view_layer.update()
    O = origine(k7)
    corps(scene, O)
    lampadaire(scene, O, main)
    bpy.context.view_layer.update()
    return O
