"""Le retour de la K7 sur PC : ce que le site reçoit. DEVANTURE=bureau python3 retour_pc_sorties.py

Après le film du PC (retour_pc_trajet.py ; retour_rendu.py TRAJET=… sur main/retour-anim-pc.blend ; approche_rendu.py
mur et approche_compo.py avec ANIM=retour/pc), son relevé et ses passes (retour_rendu.py SUIVI=1, PASSES=1 dans
travail-bureau/retour/) et ses planches (DEVANTURE=bureau FILM=retour distribution_planches.py). Encode le film en
1920 × 1020 avec la bande-son du film du téléphone (mêmes instants : c'est le même geste), en H.264 et en AV1, et écrit
public/kiosk-retour-pc.mp4, -pc.av1.mp4, -pc-suivi.json, -pc-caches.webp, -pc-ombres.webp et la clé « pc » de
src/data/kiosk-retour.json (le reste du fichier, écrit par retour_sorties.py, est gardé).

Garde-fou du raccord (Rusmir, 27/11/2026 : « on doit faire attention à la transition entre vidéo et l'éclairage de la
scène […] on cherche l'harmonie ») : la page montre le DÉCOR (public/kiosk/decor-pc.webp, première image du film de
location, sans pluie) avant et après le film. La première et la dernière image du film de retour lui sont comparées
ici, zone par zone ; un écart de lumière arrête la fabrique.
"""
import json
import shutil

import numpy as np
from PIL import Image

from encodage import deux_films
from variante import D, G, ICI

FILM = G['approche']['film']
LARGEUR, HAUTEUR, IPS = FILM['w'], FILM['h'], 24
IMAGES_FILM = 143                                  # main/retour-anim-pc.blend, images 0 à 142
DUREE_MS = round(IMAGES_FILM / IPS * 1000)         # 5958 ms, comme le film du téléphone
# Les plafonds et le débit du film de location du PC (distribution_pc_sorties.py), ramenés à la durée de celui-ci.
PLAFOND, PLAFOND_AV1 = 3_500_000, 2_200_000        # octets
DEBIT_VIDEO = '4500k'
RACINE = ICI.parents[1]
PC = D / 'retour' / 'pc'
IMAGES = PC / 'film_%04d.png'
SON = ICI / 'travail' / 'sons' / 'bande-son-retour.wav'
SORTIE, SORTIE_AV1 = PC / 'film-retour.mp4', PC / 'film-retour.av1.mp4'
SITE = D / 'retour' / 'site'
DECOR = D / 'distribution' / 'pc' / 'decor_0000.png'
# Zones du cadre (fractions) hors de l'écran — que la page recouvre du sien — et écart toléré, en niveaux sur 255 : le
# biais (film − décor) vient de la pluie, que le décor n'a pas (+ 0,4 à + 0,7 mesuré sur le film de location).
ZONES = {'vitrine': (0.0, 0.0, 0.07, 1.0), 'montant gauche': (0.08, 0.0, 0.25, 1.0), 'montant droit': (0.61, 0.0, 0.76, 1.0), 'mur': (0.78, 0.0, 1.0, 1.0)}
BIAIS_MAX, ECART_MAX = 1.5, 3.0

assert SON.exists(), f'bande-son absente : {SON} (sh ../../sons/mixe-retour.sh depuis travail/sons/)'
n = len(list(PC.glob('film_*.png')))
assert n == IMAGES_FILM, f'{n} images assemblées, il en faut {IMAGES_FILM}'
suivi = json.loads((SITE / 'suivi.json').read_text())
assert suivi['images'] == IMAGES_FILM, 'le relevé et le film n\'ont pas le même nombre d\'images'
# Le film part du décor et y revient : même cadrage (l'écran), même lumière.
decor_ecran = json.loads((RACINE / 'src' / 'data' / 'kiosk-distribution.json').read_text())['pc']['decor']['ecran']
for i in (0, IMAGES_FILM - 1):
    assert max(abs(a - b) for a, b in zip(suivi['pas'][i]['e'], decor_ecran)) < 5e-4, f'image {i} : l\'écran n\'est pas celui du décor ({suivi["pas"][i]["e"]} / {decor_ecran})'
decor = np.asarray(Image.open(DECOR).convert('RGB').resize((LARGEUR, HAUTEUR), Image.LANCZOS), np.float32)
raccord = {}
for i in (0, IMAGES_FILM - 1):
    image = np.asarray(Image.open(PC / f'film_{i:04d}.png').convert('RGB'), np.float32)
    for nom, (x0, y0, x1, y1) in ZONES.items():
        d = (image - decor)[round(y0 * HAUTEUR):round(y1 * HAUTEUR), round(x0 * LARGEUR):round(x1 * LARGEUR)]
        ecart, biais = float(np.abs(d).mean()), float(d.mean())
        raccord[f'{i} {nom}'] = (round(ecart, 2), round(biais, 2))
        if abs(biais) > BIAIS_MAX or ecart > ECART_MAX:
            raise SystemExit(f'raccord avec le décor : image {i}, zone « {nom} » — écart {ecart:.2f}, biais {biais:+.2f} niveaux (maximum {ECART_MAX} et ± {BIAIS_MAX})')
print('raccord avec le décor (écart, biais) :', raccord)

films = deux_films(IMAGES, SORTIE, SORTIE_AV1, LARGEUR, HAUTEUR, IPS, debit=DEBIT_VIDEO, son=SON, duree_s=DUREE_MS / 1000)
octets, av1 = SORTIE.stat().st_size, films['av1']
if octets > PLAFOND:
    raise SystemExit(f'vidéo de retour du PC : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')
if av1['octets'] > PLAFOND_AV1:
    raise SystemExit(f'vidéo de retour du PC en AV1 : {av1["octets"]} octets pour un plafond de {PLAFOND_AV1}')
shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-retour-pc.mp4')
shutil.copyfile(SORTIE_AV1, RACINE / 'public' / 'kiosk-retour-pc.av1.mp4')
for source, cible in (('suivi.json', 'kiosk-retour-pc-suivi.json'), ('caches.webp', 'kiosk-retour-pc-caches.webp'), ('ombres.webp', 'kiosk-retour-pc-ombres.webp')):
    shutil.copyfile(SITE / source, RACINE / 'public' / cible)
fichier = RACINE / 'src' / 'data' / 'kiosk-retour.json'
donnees = json.loads(fichier.read_text())
donnees['pc'] = {
    'film': {'src': '/kiosk-retour-pc.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets,
             'av1': {'src': '/kiosk-retour-pc.av1.mp4', **av1}},
    'suivi': '/kiosk-retour-pc-suivi.json', 'caches': '/kiosk-retour-pc-caches.webp', 'ombres': '/kiosk-retour-pc-ombres.webp',
}
fichier.write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-retour-pc.mp4 et .av1.mp4 : {films["journal"]} | clé « pc » de src/data/kiosk-retour.json')
