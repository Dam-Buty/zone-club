"""L'approche filmée de la borne : le trajet de l'appareil, image par image.

[DEVANTURE=bureau] python3 approche_trajet.py   →   <dossier de la variante>/approche/trajet.json

Le film part de l'image fixe de la devanture et s'arrête devant l'écran de la borne. L'appareil avance pour de bon,
mais ne tourne jamais (il reste face au mur) : tout ce qui est dans le plan du mur se transforme donc par un simple
changement d'échelle et un glissement, exacts — la photo se recale sans rien inventer. Seule la borne, en relief, est
recalculée par Blender (approche_rendu.py). Réglages : bloc « approche » de la géométrie.
Repère de borne.py : X vers la droite (0 = centre de la porte), mur en Y = 0, Z vers le haut (0 = sol), en mètres.
"""
import json
import math

from variante import D, G

R = json.loads((D / 'repere.json').read_text())
A = G['approche']
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
IPS, DUREE = A['ips'], A['duree_s']
T_ACCEL, T_FREIN = A['accel_s'], A['frein_s']          # on part franchement, on s'arrête en douceur devant l'écran
PAS_HZ, PAS_M = A['pas_hz'], A['pas_m']                # le balancement de la marche, éteint à l'arrêt
OBTURATEUR, SOUS_IMAGES = A['obturateur'], A['sous_images']   # flou de bougé : part de la durée d'une image
BORD_EXP = A['bord_exp']                               # > 1 : le cadre ne quitte son bord de départ que sur la fin

D0, OEIL = G['camera']['distance_mur_m'], G['camera']['hauteur_oeil_m']
HAUT0 = H / PPM                                         # hauteur du cadre sur le mur, au départ
DCX, SOL = R['door_center_x'], R['ground_y']
CAM0_X = (G['camera'].get('axe_px', DCX) - DCX) / PPM
C0 = ((W / 2 - DCX) / PPM, (SOL - H / 2) / PPM)         # centre du cadre sur le mur, au départ : l'image entière
KX = ((R['kiosk_left_x'] + R['kiosk_right_x']) / 2 - DCX) / PPM
ex0, ex1, ez0, ez1 = G['facade']['ecran']
ECRAN = (KX + (ex0 + ex1) / 2, (ez0 + ez1) / 2)         # centre de l'écran
Y_ECRAN = G['borne']['saillie_m'] - 0.019               # l'écran est à cette distance en avant du mur

# L'arrivée : la place de l'écran dans la dernière image, réglée pour qu'il tombe sur l'écran de l'interface du site.
ARR = A['arrivee']
if 'hauteur_ecran' in ARR:                              # l'écran occupe cette part de la hauteur du cadre
    D1 = Y_ECRAN + (ez1 - ez0) * D0 / (ARR['hauteur_ecran'] * HAUT0)
else:                                                   # … ou cette part de sa largeur
    D1 = Y_ECRAN + (ex1 - ex0) * D0 * H / (ARR['largeur_ecran'] * HAUT0 * W)
HAUT1 = HAUT0 * D1 / D0


def ecran_vu(cam_x, cam_z, d):
    """Où l'écran (en avant du mur) se projette sur le plan du mur, vu de l'appareil."""
    k = d / (d - Y_ECRAN)
    return cam_x + (ECRAN[0] - cam_x) * k, cam_z + (ECRAN[1] - cam_z) * k


_e1 = ecran_vu(ECRAN[0], OEIL, D1)
# Centre du cadre à l'arrivée : l'écran a son centre en (cx, cy) du cadre (cy compté depuis le haut).
C1 = (_e1[0] + (0.5 - ARR['cx']) * HAUT1 * W / H, _e1[1] - (0.5 - ARR['cy']) * HAUT1)


def lisse(v):
    v = min(1.0, max(0.0, v))
    return v * v * (3 - 2 * v)


def vitesse(t):
    return lisse(t / T_ACCEL) * lisse((DUREE - t) / T_FREIN)


PAS_T = 0.0005
_cumul, _s = [0.0], 0.0
for k in range(int(round(DUREE / PAS_T))):
    _s += vitesse((k + 0.5) * PAS_T) * PAS_T
    _cumul.append(_s)


def avancee(t):
    """Part du trajet parcourue à l'instant t (0 au départ, 1 à l'arrêt)."""
    t = min(DUREE, max(0.0, t))
    x = t / PAS_T
    i = min(len(_cumul) - 2, int(x))
    return (_cumul[i] + (_cumul[i + 1] - _cumul[i]) * (x - i)) / _cumul[-1]


def etat(t):
    u = avancee(t)
    d = D0 + u * (D1 - D0)
    haut = HAUT0 * d / D0
    cam_x = CAM0_X + u * (ECRAN[0] - CAM0_X)
    pas = PAS_M * math.sin(2 * math.pi * PAS_HZ * t) * vitesse(t)
    cam_z = OEIL + pas
    # En hauteur, le cadre glisse en ligne droite vers sa place d'arrivée à mesure qu'on avance.
    k = (haut - HAUT1) / (HAUT0 - HAUT1)
    cz = C1[1] + (C0[1] - C1[1]) * k + pas
    # En largeur, il garde d'abord son bord de départ (la borne reste entière le plus longtemps possible), puis glisse
    # vers l'écran sur la fin (bord_exp > 1) ; avec bord_exp = 1 c'est la même ligne droite qu'en hauteur.
    larg, larg1 = haut * PPM * W / H, HAUT1 * PPM * W / H
    gauche1 = DCX + C1[0] * PPM - larg1 / 2
    cx = (gauche1 * ((W - larg) / (W - larg1)) ** BORD_EXP + larg / 2 - DCX) / PPM
    # La portion de l'image d'origine que ce cadre montre (colonne, ligne, largeur, hauteur), tenue dans l'image.
    bw, bh = larg, haut * PPM
    c0 = min(W - bw, max(0.0, DCX + cx * PPM - bw / 2))
    r0 = min(H - bh, max(0.0, SOL - cz * PPM - bh / 2))
    cx, cz = (c0 + bw / 2 - DCX) / PPM, (SOL - r0 - bh / 2) / PPM
    return {'t': round(t, 5), 'u': u, 'd': d, 'haut': haut, 'cam_x': cam_x, 'cam_z': cam_z,
            'shift_x': (cx - cam_x) / haut, 'shift_y': (cz - cam_z) / haut, 'boite': [c0, r0, bw, bh]}


images = []
for i in range(int(round(IPS * DUREE)) + 1):
    t = i / IPS
    e = etat(t)
    e['i'] = i
    e['bouge'] = [etat(t + (k / (SOUS_IMAGES - 1) - 0.5) * OBTURATEUR / IPS)['boite'] for k in range(SOUS_IMAGES)]
    images.append(e)

(D / 'approche').mkdir(exist_ok=True)
(D / 'approche' / 'trajet.json').write_text(json.dumps({'ips': IPS, 'duree': DUREE, 'images': images}))
v_max = max((etat(n / 100)['d'] - etat(n / 100 + 0.01)['d']) / 0.01 for n in range(0, int(DUREE * 100) - 1))
print('trajet', len(images), 'images | distance au mur', D0, '→', round(D1, 3), 'm | cadre haut de', round(HAUT0, 3), '→', round(HAUT1, 3),
      'm | vitesse maximale', round(v_max, 2), 'm/s | arrivée', [round(v) for v in images[-1]['boite']])
