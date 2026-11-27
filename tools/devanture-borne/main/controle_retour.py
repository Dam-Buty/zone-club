"""Contrôle du film de retour, dans le Blender ouvert (scène main/retour-anim.blend) : à chaque image, aucune
phalange (au rayon du doigt) ni os de la paume (12 mm) n'entre dans la K7, et rien ne passe la façade (y = YB).
exec(open(CE_FICHIER).read()) ; rend `result` (images en défaut). À refaire après toute retouche de l'animation."""
import bpy
from mathutils import Vector

s = bpy.context.scene
arm = bpy.data.objects['main_arm']
P = arm.pose.bones
k7 = bpy.data.objects['k7_servie']
YB = -0.08
RAY = {'thumb': 0.0085, 'index': 0.0075, 'middle': 0.0078, 'ring': 0.0072, 'pinky': 0.0065}
PAUME = ('pulse.R', 'hand.R', 'hand.R.001', 'index_base.R', 'pinky_base.R', 'thumb_base.R')


def dist(p, b):
    d = [max(b[i][0] - p[i], p[i] - b[i][1]) for i in range(3)]
    ext = Vector([max(v, 0) for v in d]).length
    return ext if ext > 0 else max(d)


defauts = []
for fr in range(s.frame_start, s.frame_end + 1):
    s.frame_set(fr)
    kv = [k7.matrix_world @ v.co for v in k7.data.vertices]
    b = [(min(v[i] for v in kv), max(v[i] for v in kv)) for i in range(3)]
    Wa = arm.matrix_world
    pk, pf = (1, ''), (-1, '')
    for nn, rr in RAY.items():
        for k in ('01', '02', '03'):
            bb = P[f'{nn}_{k}.R']
            for u in (0, .33, .66, 1):
                p = (Wa @ bb.head).lerp(Wa @ bb.tail, u)
                if dist(p, b) - rr < pk[0]:
                    pk = (dist(p, b) - rr, f'{nn}{k}')
                if p.y + rr - YB > pf[0]:
                    pf = (p.y + rr - YB, f'{nn}{k}')
    for nn in PAUME:
        for u in (0, .5, 1):
            p = (Wa @ P[nn].head).lerp(Wa @ P[nn].tail, u)
            if dist(p, b) - 0.012 < pk[0]:
                pk = (dist(p, b) - 0.012, nn)
            if p.y + 0.012 - YB > pf[0]:
                pf = (p.y + 0.012 - YB, nn)
    if pk[0] < -0.002 or pf[0] > 0.0:
        defauts.append((fr, round(pk[0] * 1000, 1), pk[1], round(pf[0] * 1000, 1), pf[1]))
result = {'images_en_defaut': len(defauts), 'detail': defauts}
