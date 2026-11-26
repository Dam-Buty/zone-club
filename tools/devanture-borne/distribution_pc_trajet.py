"""La distribution de la K7 sur PC : le trajet de l'appareil, image par image.

DEVANTURE=bureau python3 distribution_pc_trajet.py   →   <dossier de la variante>/distribution/pc/trajet.json

Sur PC la page montre la borne modélisée derrière son écran (la dernière image du film d'approche) : la distribution
doit partir de CETTE vue et y revenir (Rusmir, 23/11/2026 : « les K7, le robot sont absents […] il manque une étape »).
Même format et mêmes règles que le film d'approche (approche_trajet.py) : l'appareil avance, recule et glisse sans
jamais tourner, face au mur — le mur de la photo se recale donc par une échelle et un glissement exacts
(approche_compo.py), et Blender ne rend que la borne (distribution_film.py, TRAJET=…).

Trois vues, aux instants du film du téléphone (cadrage « mixte ») : l'arrivée du film d'approche (l'écran) ; la borne
et sa vitrine de gauche pendant que le robot saisit la K7 ; la fente quand elle sort.
"""
import json

from variante import D, G

R = json.loads((D / 'repere.json').read_text())
APP = json.loads((D / 'approche' / 'trajet.json').read_text())['images'][-1]     # l'arrivée du film d'approche
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
FILM = G['approche']['film']
PAUSE = 1.25                                           # l'étape du tiroir (distribution_film.PAUSE, 26/11/2026)
IPS, DUREE = 24, 8.0 + PAUSE                           # comme le film du téléphone (distribution_film.py)
FIXE = (5.30, 7.00 + PAUSE)                            # l'appareil ne bouge pas sur la fente entre ces deux instants
OBTURATEUR, SOUS_IMAGES = G['approche']['obturateur'], G['approche']['sous_images']
D0 = G['camera']['distance_mur_m']
HAUT0 = H / PPM
DCX, SOL = R['door_center_x'], R['ground_y']
KX = ((R['kiosk_left_x'] + R['kiosk_right_x']) / 2 - DCX) / PPM
F = G['facade']
FENTE = (KX + (F['fente'][0] + F['fente'][1]) / 2, (F['fente'][2] + F['fente'][3]) / 2)
BAS = (SOL - H) / PPM                                  # le bas de la photo : rien n'existe dessous


def vue(haut, gauche=None, cx=None, bas=None, cz=None):
    """Une vue : hauteur du cadre sur le mur (m), et sa place — par son bord gauche ou son centre, son bas ou son centre."""
    larg = haut * W / H            # le rapport de l'image d'origine, comme approche_trajet.py
    cx = gauche + larg / 2 if cx is None else cx
    cz = bas + haut / 2 if cz is None else cz
    return haut, cx, cz


_c0, _r0, _bw, _bh = APP['boite']
ARRIVEE = (APP['haut'], (_c0 + _bw / 2 - DCX) / PPM, (SOL - _r0 - _bh / 2) / PPM)
# La vitrine et l'écran : le cadre part du bord gauche de la photo (14 cm de mur à gauche de la borne) et s'arrête
# avant la porte du vidéoclub — plus large, la boutique éclairée prend la moitié de l'image et le robot ne se voit plus
# (essai du 23/11/2026 à 1,2 m de haut).
BORNE = vue(0.75, gauche=-DCX / PPM, bas=1.02)
FENTE_VUE = vue(0.5, cx=FENTE[0], cz=FENTE[1] + 0.03)
# (instant, vue, appareil x, appareil z) — l'appareil se place devant ce qu'il regarde.
CLES = [
    (0.0, ARRIVEE, APP['cam_x'], APP['cam_z']),
    (1.2, BORNE, KX - 0.15, 1.40),
    (3.7, BORNE, KX - 0.15, 1.40),
    (FIXE[0], FENTE_VUE, FENTE[0], 1.02),
    (FIXE[1], FENTE_VUE, FENTE[0], 1.02),
    (DUREE, ARRIVEE, APP['cam_x'], APP['cam_z']),
]


def lisse(v):
    v = min(1.0, max(0.0, v))
    return v * v * (3 - 2 * v)


def etat(t):
    t = min(DUREE, max(0.0, t))
    for (t0, v0, x0, z0), (t1, v1, x1, z1) in zip(CLES, CLES[1:]):
        if t <= t1:
            k = lisse((t - t0) / (t1 - t0))
            break
    mel = lambda a, b: a + (b - a) * k          # noqa: E731
    haut, cx, cz = (mel(a, b) for a, b in zip(v0, v1))
    cam_x, cam_z = mel(x0, x1), mel(z0, z1)
    d = D0 * haut / HAUT0
    bw, bh = haut * PPM * W / H, haut * PPM
    c0 = min(W - bw, max(0.0, DCX + cx * PPM - bw / 2))
    r0 = min(H - bh, max(0.0, SOL - cz * PPM - bh / 2))
    cx, cz = (c0 + bw / 2 - DCX) / PPM, (SOL - r0 - bh / 2) / PPM
    return {'t': round(t, 5), 'd': d, 'haut': haut, 'cam_x': cam_x, 'cam_z': cam_z,
            'shift_x': (cx - cam_x) / haut, 'shift_y': (cz - cam_z) / haut, 'boite': [c0, r0, bw, bh]}


images = []
for i in range(int(round(IPS * DUREE)) + 1):
    t = i / IPS
    e = etat(t)
    e['i'] = i
    e['bouge'] = [etat(t + (k / (SOUS_IMAGES - 1) - 0.5) * OBTURATEUR / IPS)['boite'] for k in range(SOUS_IMAGES)]
    images.append(e)
# Le départ et la fin sont l'arrivée du film d'approche, au chiffre près.
for cle in ('d', 'cam_x', 'cam_z', 'shift_x', 'shift_y'):
    assert abs(images[0][cle] - APP[cle]) < 1e-6 and abs(images[-1][cle] - APP[cle]) < 1e-6, cle
assert max(abs(a - b) for a, b in zip(images[0]['boite'], APP['boite'])) < 1e-3

sortie = D / 'distribution' / 'pc'
sortie.mkdir(parents=True, exist_ok=True)
(sortie / 'trajet.json').write_text(json.dumps({'ips': IPS, 'duree': DUREE, 'w': FILM['w'], 'h': FILM['h'], 'images': images}))
print('trajet', len(images), 'images', FILM['w'], '×', FILM['h'], '| arrivée', [round(v, 3) for v in ARRIVEE], '| borne', [round(v, 3) for v in BORNE],
      '| fente', [round(v, 3) for v in FENTE_VUE], '| distances', [round(etat(t)['d'], 2) for t in (0, 2, 6)])
