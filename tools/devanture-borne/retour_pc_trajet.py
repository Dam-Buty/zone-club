"""Le retour de la K7 sur PC : le trajet de l'appareil, image par image.

DEVANTURE=bureau python3 retour_pc_trajet.py   →   <dossier de la variante>/retour/pc/trajet.json

Comme la distribution (distribution_pc_trajet.py) : sur PC la page montre la borne modélisée derrière son écran — le
décor, première image du film de location. Le film de retour part de CETTE vue et y revient, au chiffre près, pour que
son départ et sa fin ne se voient pas (Rusmir, 27/11/2026 : « on doit faire attention à la transition entre vidéo et
l'éclairage de la scène […] on cherche l'harmonie »). L'appareil avance, descend et glisse sans jamais tourner, face
au mur : le mur de la photo se recale par une échelle et un glissement exacts (approche_compo.py), Blender ne rend
que la borne et la main (retour_rendu.py, TRAJET=…).

Deux vues, aux instants du film du téléphone (main/retour-anim.blend, 143 images) : l'arrivée du film d'approche
(l'écran) ; la fente, vue d'un peu à droite et d'un peu au-dessus : le visiteur vient du côté de l'appareil, son bras
entre par le bas à droite pendant que la vue descend, coude plié, et repart par le haut à droite.
"""
import json

from variante import D, G

R = json.loads((D / 'repere.json').read_text())
APP = json.loads((D / 'approche' / 'trajet.json').read_text())['images'][-1]     # l'arrivée du film d'approche
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
FILM = G['approche']['film']
IPS, IMAGES = 24, 143                                  # main/retour-anim.blend : images 0 à 142
DUREE = (IMAGES - 1) / IPS
# L'appareil du téléphone part à l'image 4, s'arrête sur la fente de l'image 29 à l'image 104, revient pour la 142.
PART, ARRIVE, REPART = 4 / IPS, 29 / IPS, 104 / IPS
OBTURATEUR, SOUS_IMAGES = G['approche']['obturateur'], G['approche']['sous_images']
D0 = G['camera']['distance_mur_m']
HAUT0 = H / PPM
DCX, SOL = R['door_center_x'], R['ground_y']
KX = ((R['kiosk_left_x'] + R['kiosk_right_x']) / 2 - DCX) / PPM
F = G['facade']
FENTE = (KX + (F['fente'][0] + F['fente'][1]) / 2, (F['fente'][2] + F['fente'][3]) / 2)

_c0, _r0, _bw, _bh = APP['boite']
ARRIVEE = (APP['haut'], (_c0 + _bw / 2 - DCX) / PPM, (SOL - _r0 - _bh / 2) / PPM)
# La fente : (hauteur du cadre sur le mur, centre x, centre z), puis la place de l'appareil (x, z). Le cadre de la
# location (centre 3 cm au-dessus de la fente) laissait 1,3 cm du bas de l'écran en haut de l'image : ici il descend de
# 2 cm, l'écran sort du cadre — la page pose son vrai écran PAR-DESSUS la vidéo, la main ne doit jamais passer dessous.
FENTE_VUE = (0.50, FENTE[0], FENTE[1] + 0.01)
# L'appareil se place un peu à droite de la fente et un peu au-dessus (28 cm, et à 1,15 m du sol) : presque de face, la
# main reste lisible, et l'on voit le bras plié du visiteur (main/retour-anim-pc.blend : épaule, coude, poignet).
# Placé devant la fente à sa hauteur, comme dans le film de location (essai du 27/11/2026), il voyait l'avant-bras venir
# du coin de l'image comme un tube droit, le coude juste hors du cadre — Rusmir : « on devrait voir une pliure au niveau
# du coude, ou alors le bras tendu depuis un point plus central, pas sur le côté ». Par-dessus l'épaule (40 cm à droite,
# 1,30 m), la manche cachait la main.
FENTE_CAM = (FENTE[0] + 0.28, 1.15)
CLES = [
    (0.0, ARRIVEE, APP['cam_x'], APP['cam_z']),
    (PART, ARRIVEE, APP['cam_x'], APP['cam_z']),
    (ARRIVE, FENTE_VUE, *FENTE_CAM),
    (REPART, FENTE_VUE, *FENTE_CAM),
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
for i in range(IMAGES):
    t = i / IPS
    e = etat(t)
    e['i'] = i
    e['bouge'] = [etat(t + (k / (SOUS_IMAGES - 1) - 0.5) * OBTURATEUR / IPS)['boite'] for k in range(SOUS_IMAGES)]
    images.append(e)
# Le départ et la fin sont l'arrivée du film d'approche, au chiffre près : le décor de la page.
for cle in ('d', 'cam_x', 'cam_z', 'shift_x', 'shift_y'):
    assert abs(images[0][cle] - APP[cle]) < 1e-6 and abs(images[-1][cle] - APP[cle]) < 1e-6, cle
assert max(abs(a - b) for a, b in zip(images[0]['boite'], APP['boite'])) < 1e-3

sortie = D / 'retour' / 'pc'
sortie.mkdir(parents=True, exist_ok=True)
(sortie / 'trajet.json').write_text(json.dumps({'ips': IPS, 'duree': DUREE, 'w': FILM['w'], 'h': FILM['h'], 'images': images}))
print('trajet', len(images), 'images', FILM['w'], '×', FILM['h'], '| arrivée', [round(v, 3) for v in ARRIVEE], '| fente', [round(v, 3) for v in FENTE_VUE],
      '| distances', [round(etat(t)['d'], 2) for t in (0, 2)])
