"""La distribution de la K7 : le film (borne seule, sans la rue ni la pluie). Cadrage retenu : « mixte ».

blender -b --factory-startup --python-exit-code 1 -P distribution_film.py -- <échantillons> <suit|fixe|mixte|vitrine> [<images>]
<images> : « 0,45,90 » ou « 0-90 » (toutes par défaut). Sorties : <dossier de la variante>/distribution/film-<cadrage>/img_0000.png

« suit » : l'appareil recule jusqu'à la borne entière, s'approche de la vitrine pour la saisie, glisse vers la fente,
revient à l'écran. « fixe » : il recule, reste sur la borne entière, revient. Le robot fait la même chose dans les deux.
L'appareil avance et recule pour de bon (focale fixe, jamais de zoom) et reste face au mur.
La scène, le robot et la K7 servie sont ceux de distribution_poses.py, exécuté jusqu'à ses vues.
"""
import sys
from pathlib import Path

_ICI = Path(__file__).resolve().parent
_b = sys.argv[sys.argv.index('--') + 1:]
_CADRAGE = _b[1]
assert _CADRAGE in ('suit', 'fixe', 'mixte', 'vitrine'), 'cadrage : suit, fixe, mixte ou vitrine'
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [_b[0]]
_src = (_ICI / 'distribution_poses.py').read_text()
_haut = _src.split('# ----- les vues')[0]
assert _haut != _src, 'distribution_poses.py : le bloc des vues est introuvable'
exec(compile(_haut, str(_ICI / 'distribution_poses.py'), 'exec'), globals())

IPS, DUREE = 24, 8.0
LARGEUR, HAUTEUR = 720, 1290
N = int(round(IPS * DUREE)) + 1
if len(_b) > 2:
    if '-' in _b[2]:
        _d, _f = (int(v) for v in _b[2].split('-'))
        _CHOIX = list(range(_d, _f + 1))
    else:
        _CHOIX = [int(v) for v in _b[2].split(',')]
else:
    _CHOIX = list(range(N))
_SORTIE = _OUT / ('film-' + _CADRAGE)
_SORTIE.mkdir(exist_ok=True)


def lisse(v):
    v = min(1.0, max(0.0, v))
    return v * v * (3 - 2 * v)


def piste(cles, t):
    """Valeur d'une piste [(instant, valeur), …] : départ et arrêt en douceur entre deux clés."""
    if t <= cles[0][0]:
        return cles[0][1]
    for (t0, v0), (t1, v1) in zip(cles, cles[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * lisse((t - t0) / (t1 - t0))
    return cles[-1][1]


# ----- le robot et la K7 (les mêmes dans les deux films) -----
_FX, _FZ = (_FENTE[0] + _FENTE[1]) / 2, (_FENTE[2] + _FENTE[3]) / 2
_Z0 = _K7_CASE[2]
_DZ_FENTE = _DZ + (_FZ - _Z0)             # la traverse amène la K7 à la hauteur de la fente
# Le geste, en temps distincts : le chariot arrive (avec son accroc), les doigts s'ouvrent, avancent de part et
# d'autre de la K7, se referment d'un coup sec, la soulèvent par-dessus le retour de la tablette, la tirent, la posent.
# Le 22/11/2026 Rusmir a demandé un arrêt d'au moins une seconde sur la fente, le temps de lire le titre que la page
# pose sur la K7 : tout le geste du robot (de 0,5 s à l'arrêt de la K7) est resserré pour qu'elle soit immobile à
# 5,85 s au lieu de 6,30 s. Les instants ci-dessous restent écrits dans l'ancienne chronologie ; resserre() les ramène à la nouvelle.
ARRET_K7 = 5.85
_RESSERRE = (ARRET_K7 - 0.5) / (6.3 - 0.5)


def resserre(t):
    return t if t <= 0.5 else 0.5 + (t - 0.5) * _RESSERRE


def resserres(cles):
    return [(resserre(t), v) for t, v in cles]


ALLER = [(0.5, 0.0), (1.35, 0.62), (1.6, 0.60), (2.0, 1.0)]
ECART = [(1.7, PARQUE), (2.05, OUVERT), (2.62, OUVERT), (2.70, SERRE), (3.56, SERRE), (3.68, SERRE + 0.0005)]
TIROIR = [(2.1, 0.0), (2.55, COURSE), (3.0, COURSE), (3.5, 0.0)]
LEVEE_T = [(2.75, 0.0), (2.95, LEVEE)]
POSE = [(3.56, 0.0), (3.66, -0.0015)]     # les doigts relâchent : la K7 tombe du millimètre et demi qui la séparait du plateau
DESCENTE = [(3.7, 0.0), (4.5, 1.0)]
GLISSE = [(4.5, 0.0), (5.1, 0.22)]        # la K7 quitte le plateau vers la droite, derrière la tôle (PROVISOIRE)
POUSSE = [(4.5, 0.0), (4.9, 0.09), (5.2, 0.09)]
RETOUR = [(5.2, 0.0), (6.6, 1.0)]
SORTIE = [(5.25, 0.0), (5.6, 0.36), (5.85, 0.33), (6.3, 1.0)]   # elle accroche à un tiers, puis sort
OUVRE_VOLET = [(4.95, 0.0), (5.2, 1.0)]   # le clapet se relève juste avant que la K7 n'apparaisse
_CHOCS = ((resserre(2.66), 1.0), (resserre(3.02), 0.6))       # le serrage, puis le départ du retrait : (instant, force)
ALLER, ECART, TIROIR, LEVEE_T, POSE, DESCENTE, GLISSE, POUSSE, RETOUR, SORTIE, OUVRE_VOLET = (
    resserres(c) for c in (ALLER, ECART, TIROIR, LEVEE_T, POSE, DESCENTE, GLISSE, POUSSE, RETOUR, SORTIE, OUVRE_VOLET))


def secousse(t, pulsation=34.0, amorti=9.0):
    """Petite oscillation amortie après chaque choc (entre -1 et 1)."""
    return sum(f * math.exp(-amorti * (t - t0)) * math.sin(pulsation * (t - t0)) for t0, f in _CHOCS if t >= t0)


def etat_robot(t):
    a, r = piste(ALLER, t), piste(RETOUR, t)
    desc = piste(DESCENTE, t)
    dz_pris = _DZ + piste(LEVEE_T, t)
    dz_charge = dz_pris + (_DZ_FENTE - dz_pris) * desc
    dz = a * _DZ if t < resserre(2.0) else dz_charge
    dx = a * _DX + piste(POUSSE, t)
    dy = piste(TIROIR, t)
    dx, dz = dx * (1 - r), dz * (1 - r)
    x, y, z = _K7_CASE
    penche = 0.0
    if t < resserre(2.62):
        k7, rot = (x, y, z), 0.0
    elif t < resserre(5.1):
        recul = COURSE - dy if t >= resserre(3.0) else 0.0
        k7 = (x + piste(GLISSE, t) + 0.0005 * secousse(t), y - recul, z + dz_charge - _DZ + piste(POSE, t))
        rot = 0.0
        penche = -1.2 * lisse((t - resserre(2.75)) / 0.2) * (1 - lisse((t - resserre(3.5)) / 0.14))   # tenue par l'avant, l'arrière pend un peu
    else:
        s = piste(SORTIE, t)
        k7, rot = (L(_FX), YB + 0.105 - s * 0.109, _FZ), -90.0
    return dx, dz, dy, k7, rot, penche


def applique_etat(t):
    dx, dz, dy, k7, rot, penche = etat_robot(t)
    for o in _GZ:
        o.location = _BASE[o.name].copy()
        o.location.z += dz
    for o in _GX:
        o.location.x += dx
    for o in _GY:
        o.location.y += dy
    e = piste(ECART, t) - PARQUE
    for s, pieces in _DOIGTS.items():
        for o in pieces:
            o.location.x += s * e
    K7.location = k7
    K7.rotation_euler = (math.radians(penche), math.radians(rot), 0)
    VOLET.rotation_euler = (math.radians(86.0) * piste(OUVRE_VOLET, t), 0, 0)   # 0 : fermé ; relevé vers l'intérieur
    # Les voisines frémissent : elles basculent d'une fraction de degré sur leur pied, chacune de son côté.
    for i, (o, base) in enumerate(zip(_VOISINES, _VOISINES_BASE)):
        ang = math.radians(0.45) * secousse(t, 30.0 + 5 * i, 8.0) * (1 if i else -1)
        o.rotation_euler = (0, ang, 0)
        o.location = (base.x + ang * K7_H / 2, base.y, base.z)


# ----- l'appareil : centre du cadre sur le mur (x local, z) et hauteur du cadre, en mètres -----
_ZR = _Z0
_E = F['ecran']
_EX, _EZ = (_E[0] + _E[1]) / 2, (_E[2] + _E[3]) / 2
_HE = (_E[1] - _E[0]) / 0.78 * HAUTEUR / LARGEUR      # l'écran occupe 78 % de la largeur, comme à la fin de l'approche
_HB = 2.24
FIXE = (5.30, 7.00)                # l'appareil ne bouge pas sur la fente entre ces deux instants (cadrage mixte)
CALQUES = (5.90, 6.95)             # ce que la page pose (tranche du film loué, afficheur) n'est visible qu'ici
if _CADRAGE == 'suit':
    CX_T = [(0, _EX), (1.1, 0.0), (1.3, 0.0), (2.3, -0.33), (4.3, -0.33), (5.2, _FX), (6.7, _FX), (8.0, _EX)]
    CZ_T = [(0, _EZ), (1.1, 1.06), (1.3, 1.06), (2.3, _ZR), (3.4, _ZR), (4.5, 0.93), (6.7, 0.95), (8.0, _EZ)]
    HH_T = [(0, _HE), (1.1, _HB), (1.3, _HB), (2.3, 0.70), (3.4, 0.70), (4.5, 0.80), (5.2, 0.64), (6.7, 0.64), (8.0, _HE)]
elif _CADRAGE == 'mixte':     # choix de Rusmir (21/11/2026) : fixe pendant la saisie, rapproché sur la fente seulement
    # (22/11 : l'appareil est fixe sur la fente de 5,30 à 7,00 s ; les calques de la page tiennent dans cet intervalle.)
    CX_T = [(0, _EX), (1.2, 0.0), (4.45, 0.0), (FIXE[0], _FX), (FIXE[1], _FX), (8.0, _EX)]
    CZ_T = [(0, _EZ), (1.2, 1.06), (4.45, 1.06), (FIXE[0], 0.95), (FIXE[1], 0.95), (8.0, _EZ)]
    HH_T = [(0, _HE), (1.2, _HB), (4.45, _HB), (FIXE[0], 0.64), (FIXE[1], 0.64), (8.0, _HE)]
elif _CADRAGE == 'vitrine':   # fixe sur la vitrine pendant la saisie (et non sur la borne entière), puis la fente
    CX_T = [(0, _EX), (1.2, -0.33), (3.8, -0.33), (5.2, _FX), (6.9, _FX), (8.0, _EX)]
    CZ_T = [(0, _EZ), (1.2, 1.30), (3.8, 1.30), (5.2, 0.95), (6.9, 0.95), (8.0, _EZ)]
    HH_T = [(0, _HE), (1.2, 0.80), (3.8, 0.80), (5.2, 0.64), (6.9, 0.64), (8.0, _HE)]
else:
    CX_T = [(0, _EX), (1.2, 0.0), (6.7, 0.0), (8.0, _EX)]
    CZ_T = [(0, _EZ), (1.2, 1.06), (6.7, 1.06), (8.0, _EZ)]
    HH_T = [(0, _HE), (1.2, _HB), (6.7, _HB), (8.0, _HE)]
# L'autocollant collé sur la vitre cache la descente de la K7 : retiré pour l'essai (à trancher avec Rusmir).
bpy.data.objects['autocollant_rosie'].hide_render = _CADRAGE in ('suit', 'fixe')   # Rusmir, 21/11 : il reste sur la vitre
_D_REF = 6.0                                          # distance au mur pour la borne entière
scene.render.use_border = False
scene.render.resolution_x, scene.render.resolution_y = LARGEUR, HAUTEUR
scene.render.resolution_percentage = 100
cam_data.shift_x = cam_data.shift_y = 0.0
cam_data.lens = 36 * _D_REF / _HB                      # focale fixe : le cadre ne change que parce que l'appareil bouge

# Essai d'éclairage (LUMIERE=douce) : le tube du haut brûlait la rangée du haut ; moins fort et plus large, les
# réglettes latérales prennent le relais pour éclairer les tranches de façon égale.
import os  # noqa: E402
print('VUE', scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure)
if os.environ.get('LUMIERE') == 'douce':
    _SORTIE = _OUT / ('film-' + _CADRAGE + '-douce')
    _SORTIE.mkdir(exist_ok=True)
    for _o in scene.objects:
        if _o.type == 'LIGHT' and _o.name.startswith('eclairage_vitrine'):
            _o.data.energy *= float(os.environ.get('TUBE', 0.10))
            _o.data.size_y = float(os.environ.get('LARGE', 0.18))
        if _o.type == 'LIGHT' and _o.name.startswith('reglette'):
            _o.data.energy *= float(os.environ.get('REGL', 0.5))
    for _m in bpy.data.materials:
        if _m.name.startswith('tube') and _m.node_tree:
            for _n in _m.node_tree.nodes:
                if _n.type == 'EMISSION':
                    _n.inputs['Strength'].default_value *= float(os.environ.get('EMIS', 0.15))
# QUALITE=photo : la passe de photoréalisme (Rusmir, 22/11/2026). Conversion de couleurs AgX (les hautes lumières
# s'arrondissent au lieu de se couper), reflets de la rue dans les vitres, profondeur de champ sur les plans serrés.
_PHOTO = os.environ.get('QUALITE') == 'photo'
if _PHOTO:
    _SORTIE = _OUT / ('film-' + _CADRAGE + '-photo')
    _SORTIE.mkdir(exist_ok=True)
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = os.environ.get('LOOK', 'AgX - High Contrast')
    except TypeError:
        print('LOOK refusé, looks disponibles à lire dans la doc')
    scene.view_settings.exposure = float(os.environ.get('EXPO', 0.15))
    # La rue derrière l'appareil : trois lueurs (deux lampadaires au sodium, une enseigne froide), que seuls les
    # reflets voient. Elles n'éclairent pas la borne, elles se reflètent dans ses vitres.
    for _k, (_x, _z, _w, _h, _c, _f) in enumerate(((-2.6, 3.4, 0.5, 0.25, (1.0, 0.62, 0.28, 1), 14), (3.1, 3.9, 0.5, 0.25, (1.0, 0.62, 0.28, 1), 10), (0.9, 1.9, 1.6, 0.5, (0.55, 0.75, 1.0, 1), 2.5))):
        _lu = plane(f'lueur_rue_{_k}', L(_x), -9.0, _z, _w, _h, emissive(f'lueur_rue_{_k}', color=_c, strength=_f * float(os.environ.get('RUE', 1.0))), normal='-Y')
        _lu.visible_diffuse = False
        _lu.visible_camera = False
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = float(os.environ.get('DIAPH', 8.0))
# ECHELLE=2 : image deux fois plus fine (1440 × 2580), pour juger les détails sans agrandir une image de 720 points.
scene.render.resolution_percentage = int(100 * float(os.environ.get('ECHELLE', 1)))
if _PHOTO:      # textures lues en bicubique : plus nettes que le bilinéaire quand l'appareil s'approche
    for _m in (spine, jaquette):
        for _n in _m.node_tree.nodes:
            if _n.type == 'TEX_IMAGE':
                _n.interpolation = 'Cubic'
if os.environ.get('DOSSIER'):          # autre dossier de sortie (images de contrôle, sans toucher au film en cours)
    _SORTIE = _OUT / os.environ['DOSSIER']
    _SORTIE.mkdir(exist_ok=True)
print('VUE FINALE', scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure)
print('ESSAI', _CADRAGE, N, 'images | écran', round(_EX, 3), round(_EZ, 3), round(_HE, 3), '| rangée', round(_ZR, 3), flush=True)
for _i in _CHOIX:
    _t = _i / IPS
    applique_etat(_t)
    _hh = piste(HH_T, _t)
    cam.location = (L(piste(CX_T, _t)), -_D_REF * _hh / _HB, piste(CZ_T, _t))
    if _PHOTO:      # la mise au point suit le sujet : les tranches tant que le robot travaille, puis la fente
        cam_data.dof.focus_distance = _D_REF * _hh / _HB + (Y_RACK_G if _t < 4.6 else YB)
    scene.render.filepath = str(_SORTIE / f'img_{_i:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('IMAGE', _i, round(_t, 3), flush=True)

# ----- l'arrêt sur la fente : où la page pose la tranche du film loué et le texte de l'afficheur -----
if _CADRAGE == 'mixte':
    import json  # noqa: E402
    from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
    from mathutils import Vector  # noqa: E402
    _t = 6.4
    assert CALQUES[0] >= ARRET_K7 and CALQUES[1] <= FIXE[1] and CALQUES[0] >= FIXE[0] and CALQUES[1] - CALQUES[0] >= 1.0
    applique_etat(_t)
    _hh = piste(HH_T, _t)
    cam.location = (L(piste(CX_T, _t)), -_D_REF * _hh / _HB, piste(CZ_T, _t))
    bpy.context.view_layer.update()

    def _boite(points):
        pr = [world_to_camera_view(scene, cam, Vector(p)) for p in points]
        xs, ys = [q.x for q in pr], [q.y for q in pr]
        return {'x0': round(min(xs), 5), 'y0': round(1 - max(ys), 5), 'x1': round(max(xs), 5), 'y1': round(1 - min(ys), 5)}

    _vs = [K7.matrix_world @ v.co for v in K7.data.vertices]
    _ymin = min(v.y for v in _vs)
    _face = [v for v in _vs if v.y < _ymin + 0.002]             # la tranche tournée vers nous
    _ax0, _ax1, _az0, _az1 = F['afficheur']
    _arret = {
        'debutS': CALQUES[0], 'finS': CALQUES[1],
        'tranche': _boite(_face),
        'afficheur': _boite([(L(x), YB, z) for x in (_ax0, _ax1) for z in (_az0, _az1)]),
    }
    (_OUT / 'arret.json').write_text(json.dumps(_arret, indent=2) + '\n')
    print('ARRÊT', _arret, flush=True)
    if len(_CHOIX) == N or os.environ.get('LUMIERE_TRANCHE'):
        # La lumière de l'arrêt : la même image, la tranche en blanc (albédo 0,8), recadrée sur la boîte. La fabrique
        # des tranches du site (distribution_tranches_site.py) en éclaire chaque tranche de film.
        _pb = jaquette.node_tree.nodes['Principled BSDF']
        for _lien in list(_pb.inputs['Base Color'].links):
            jaquette.node_tree.links.remove(_lien)
        _pb.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
        _b = _arret['tranche']
        scene.render.use_border = scene.render.use_crop_to_border = True
        scene.render.border_min_x, scene.render.border_max_x = _b['x0'], _b['x1']
        scene.render.border_min_y, scene.render.border_max_y = 1 - _b['y1'], 1 - _b['y0']
        scene.render.filepath = str(_OUT / 'lumiere-tranche.png')
        bpy.ops.render.render(write_still=True)
        print('LUMIÈRE DE LA TRANCHE', flush=True)
print('FINI', _CADRAGE, len(_CHOIX))
