"""Le retour de la K7 : ce que le site reçoit. python3 retour_sorties.py

Après retour_rendu.py (le film, puis SUIVI=1 et PASSES=1 dans travail/retour/), FILM=retour distribution_planches.py
(LUMIERE_DE : la lumière du film de location) et la bande-son (sh ../../sons/mixe-retour.sh depuis travail/sons/).
Encode le film en 720 × 1290 avec sa bande-son, en H.264 et en AV1 (encodage.py), et écrit public/kiosk-retour.mp4,
public/kiosk-retour.av1.mp4, public/kiosk-retour-{suivi.json,caches.webp,ombres.webp} et src/data/kiosk-retour.json —
même forme que la variante téléphone de kiosk-distribution.json, que la borne lit avec le même lecteur.
"""
import json
import shutil

from encodage import deux_films
from variante import D, ICI

LARGEUR, HAUTEUR, IPS = 720, 1290, 24
IMAGES_FILM = 143                                  # main/retour-anim.blend, images 0 à 142
DUREE_MS = round(IMAGES_FILM / IPS * 1000)         # 5958 ms
PLAFOND = 2_800_000                                # octets : le plafond du H.264 du film de location
DEBIT_VIDEO = '2300k'                              # le débit du film de location, à qualité égale
RACINE = ICI.parents[1]
R = D / 'retour'
IMAGES = R / 'film' / 'img_%04d.png'
SON = D / 'sons' / 'bande-son-retour.wav'
SORTIE, SORTIE_AV1 = R / 'film-retour.mp4', R / 'film-retour.av1.mp4'
assert SON.exists(), f'bande-son absente : {SON} (sh ../../sons/mixe-retour.sh depuis travail/sons/)'
n = len(list(IMAGES.parent.glob('img_*.png')))
assert n == IMAGES_FILM, f'{n} images rendues, il en faut {IMAGES_FILM}'
suivi = json.loads((R / 'site' / 'suivi.json').read_text())
assert suivi['images'] == IMAGES_FILM, suivi['images']

films = deux_films(IMAGES, SORTIE, SORTIE_AV1, LARGEUR, HAUTEUR, IPS, debit=DEBIT_VIDEO, son=SON, duree_s=DUREE_MS / 1000)
octets = SORTIE.stat().st_size
if octets > PLAFOND:
    raise SystemExit(f'vidéo de retour : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')
shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-retour.mp4')
shutil.copyfile(SORTIE_AV1, RACINE / 'public' / 'kiosk-retour.av1.mp4')
for source, cible in (('suivi.json', 'kiosk-retour-suivi.json'), ('caches.webp', 'kiosk-retour-caches.webp'), ('ombres.webp', 'kiosk-retour-ombres.webp')):
    shutil.copyfile(R / 'site' / source, RACINE / 'public' / cible)
donnees = {
    'film': {'src': '/kiosk-retour.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets,
             'av1': {'src': '/kiosk-retour.av1.mp4', **films['av1']}},
    'suivi': '/kiosk-retour-suivi.json', 'caches': '/kiosk-retour-caches.webp', 'ombres': '/kiosk-retour-ombres.webp',
}
_fichier = RACINE / 'src' / 'data' / 'kiosk-retour.json'
if _fichier.exists() and 'pc' in json.loads(_fichier.read_text()):          # la variante du PC (retour_pc_sorties.py) est gardée
    donnees['pc'] = json.loads(_fichier.read_text())['pc']
_fichier.write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-retour.mp4 et .av1.mp4 : {films["journal"]} | src/data/kiosk-retour.json')
