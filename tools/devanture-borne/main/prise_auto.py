"""Saisie automatique de la K7 par la main, dans le Blender ouvert (scène du film de retour, travail/retour/retour-anim.blend).

Exécuté par le MCP : exec(open(CE_FICHIER).read()) puis pose(...). La main est placée (orientation, position des
jointures), puis chaque doigt se plie — flexion seule, dans les amplitudes normales (MCP −20/90, IPP 0/100, IPD 0/70 ;
pouce : opposition de la base puis flexion) — jusqu'à toucher la K7, avec le rayon d'un doigt. Rien ne peut donc
entrer dans la boîte. La pose de repos du modèle est un peu repliée (MCP 14 à 50°) : g = 0 la ramène doigts tendus.
"""
import math

import bpy
from mathutils import Euler, Matrix, Vector

r = math.radians
s = bpy.context.scene
arm = bpy.data.objects['main_arm']
P = arm.pose.bones
prise = bpy.data.objects['main_prise']
k7 = bpy.data.objects['k7_servie']
tient = bpy.data.objects['repere_tient']
pg = bpy.data.objects['poignet']
DOIGTS = ('index', 'middle', 'ring', 'pinky')
RAYON = {'index': 0.0075, 'middle': 0.0078, 'ring': 0.0072, 'pinky': 0.0065, 'thumb': 0.0085}
REPOS_MCP = {'index': 32, 'middle': 14, 'ring': 24, 'pinky': 50}
COUDE_DIR = Vector((0.64, -0.54, 0.55)).normalized()       # vers le coude du visiteur (image fixe validée)
MANCHE_ATELIER = Vector((0.724, -0.385, 0.572)).normalized()


def boite():
    kv = [k7.matrix_world @ v.co for v in k7.data.vertices]
    return [(min(v[i] for v in kv), max(v[i] for v in kv)) for i in range(3)]


def dist(p, kb):
    d = [max(kb[i][0] - p[i], p[i] - kb[i][1]) for i in range(3)]
    ext = Vector([max(v, 0) for v in d]).length
    return ext if ext > 0 else max(d)


def points(n, ks=('02', '03')):
    Wa = arm.matrix_world
    return [(Wa @ P[f'{n}_{k}.R'].head).lerp(Wa @ P[f'{n}_{k}.R'].tail, u) for k in ks for u in (0.25, 0.5, 0.75, 1.0)]


def flechit(n, g):
    if n == 'thumb':
        P['thumb_01.R'].rotation_euler = Euler((r(10 * g), 0, r(45 * g)))
        P['thumb_02.R'].rotation_euler = Euler((0, 0, r(50 * g)))
        P['thumb_03.R'].rotation_euler = Euler((0, 0, r(60 * g)))
    else:
        P[f'{n}_01.R'].rotation_euler = Euler((0, 0, r(-REPOS_MCP[n] + 90 * g)))
        P[f'{n}_02.R'].rotation_euler = Euler((0, 0, r(-12 + 100 * g)))
        P[f'{n}_03.R'].rotation_euler = Euler((0, 0, r(-8 + 70 * g)))


def repere_main():
    """Axes de la main tendue dans l'espace de main_prise : doigts, paume, et le milieu des jointures."""
    for n in DOIGTS + ('thumb',):
        flechit(n, 0)
    bpy.context.view_layer.update()
    Mloc = prise.matrix_world.inverted() @ arm.matrix_world
    h = lambda n: Mloc @ P[n].head
    a0 = (h('middle_01.R') - h('pulse.R')).normalized()
    n0 = (h('index_01.R') - h('pinky_01.R')).cross(a0).normalized()
    P['index_02.R'].rotation_euler = Euler((0, 0, r(60)))
    bpy.context.view_layer.update()
    M2 = prise.matrix_world.inverted() @ arm.matrix_world
    pli = (M2 @ P['index_03.R'].tail) - (M2 @ P['index_02.R'].head)
    flechit('index', 0)
    bpy.context.view_layer.update()
    if n0.dot(pli) < 0:
        n0 = -n0
    return Matrix((a0, n0, a0.cross(n0))).transposed().inverted(), (h('index_01.R') + h('pinky_01.R')) / 2


def pose(a_t, rho, ancre, pouce=True):
    """a_t : direction des doigts ; rho : roulis (°) autour d'elle, paume vers le bas à 0 ; ancre : où poser le milieu
    des jointures (monde). Plie les doigts jusqu'au contact ; rend un bilan."""
    kb = boite()
    B0i, ancre_l = repere_main()
    a_t = Vector(a_t).normalized()
    n_t = Vector((0, 0.1, -1))
    n_t = Matrix.Rotation(r(rho), 3, a_t) @ (n_t - n_t.dot(a_t) * a_t).normalized()
    # les axes de la main sont mesurés dans le repère de main_prise : la rotation monde est directement Bt·B0⁻¹
    W = (Matrix((a_t, n_t, a_t.cross(n_t))).transposed() @ B0i).to_4x4()
    W.translation = Vector(ancre) - W @ ancre_l
    tient.matrix_world = W
    pg.rotation_mode = 'QUATERNION'
    pg.rotation_quaternion = MANCHE_ATELIER.rotation_difference(COUDE_DIR)
    bpy.context.view_layer.update()
    depart = min(min(dist(p, kb) for p in points(n, ('01', '02', '03'))) - RAYON[n] for n in DOIGTS + ('thumb',))
    fin = {}
    for n in DOIGTS + (('thumb',) if pouce else ()):
        pas = 0
        for pas in range(0, 101, 2):
            flechit(n, pas / 100)
            bpy.context.view_layer.update()
            if min(dist(p, kb) for p in points(n)) <= RAYON[n]:
                break
        fin[n] = pas
    Wa = arm.matrix_world
    pc = Wa @ P['thumb_03.R'].tail
    pen = min(min(dist(p, kb) for p in points(n, ('01', '02', '03'))) - RAYON[n] for n in DOIGTS + ('thumb',))
    return {'depart_mm': round(depart * 1000, 1), 'pouce_sous_mm': round((kb[2][0] - pc.z) * 1000, 1),
            'pouce_dans_mm': round((pc.y - kb[1][0]) * 1000, 1), 'pen_mm': round(pen * 1000, 1), 'flex': fin,
            'angle_poignet': round(math.degrees(a_t.angle(-COUDE_DIR)), 1)}


def place_paume(a_t, rho, paume_cible, coude=None):
    """Variante de pose() : on place le CENTRE DE LA PAUME (entre le poignet et la jointure du majeur), pas les
    jointures — la K7 repose sur la paume (Rusmir, 26/11 : « la paume empêche la K7 de tomber, le pouce la maintient
    en place pour pouvoir la guider »). Ne plie rien : doigts tendus."""
    global COUDE_DIR
    if coude is not None:
        COUDE_DIR = Vector(coude).normalized()
    B0i, _ = repere_main()
    Mloc = prise.matrix_world.inverted() @ arm.matrix_world
    paume_l = ((Mloc @ P['pulse.R'].head) + (Mloc @ P['middle_01.R'].head)) / 2
    a_t = Vector(a_t).normalized()
    n_t = Vector((0, 0.1, -1))
    n_t = Matrix.Rotation(r(rho), 3, a_t) @ (n_t - n_t.dot(a_t) * a_t).normalized()
    W = (Matrix((a_t, n_t, a_t.cross(n_t))).transposed() @ B0i).to_4x4()
    W.translation = Vector(paume_cible) - W @ paume_l
    tient.matrix_world = W
    pg.rotation_mode = 'QUATERNION'
    pg.rotation_quaternion = MANCHE_ATELIER.rotation_difference(COUDE_DIR)
    bpy.context.view_layer.update()
    return math.degrees(a_t.angle(-COUDE_DIR))


def plie_au_contact(noms=DOIGTS):
    kb = boite()
    fin = {}
    for n in noms:
        pas = 0
        for pas in range(0, 101, 2):
            flechit(n, pas / 100)
            bpy.context.view_layer.update()
            if min(dist(p, kb) for p in points(n)) <= RAYON[n]:
                break
        fin[n] = pas
    return fin
