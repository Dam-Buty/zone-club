"""La distribution de la K7 : ce que le site reçoit (après distribution_film.py). python3 distribution_sorties.py

Encode les images du film (cadrage mixte, rendues à l'échelle 2) en 720 × 1290 avec la bande-son, deux fois : en H.264
pour tous, en AV1 pour les appareils qui le lisent (encodage.py). Contrôle les poids et les étiquettes de couleur, puis
écrit public/kiosk-distribution.mp4, public/kiosk-distribution.av1.mp4 et src/data/kiosk-distribution.json — les
vidéos, leur durée, et l'arrêt sur la fente (quand et où la page pose la tranche du film loué et le texte de l'afficheur).
"""
import json
import shutil

from encodage import deux_films
from variante import D, ICI

LARGEUR, HAUTEUR, IPS, DUREE_MS = 720, 1290, 24, 9250      # 8 s + l'étape du tiroir (distribution_film.PAUSE, 26/11/2026)
# Rusmir, 22/11/2026 : « ok jusqu'à 2,6 méga » ; le H.264 ne va plus qu'aux appareils sans AV1 (26/11/2026) : il garde le
# débit du film de 8 s, et son plafond suit la durée.
PLAFOND, PLAFOND_AV1 = 2_800_000, 1_800_000      # octets
DEBIT_VIDEO = '2300k'
RACINE = ICI.parents[1]
IMAGES = D / 'distribution' / 'film' / 'img_%04d.png'      # rendues par : DOSSIER=film QUALITE=photo LUMIERE=douce ECHELLE=2 … distribution_film.py -- 128 mixte
SON = D / 'sons' / 'bande-son-film.wav'
SORTIE, SORTIE_AV1 = D / 'distribution' / 'film.mp4', D / 'distribution' / 'film.av1.mp4'
assert SON.exists(), f'bande-son absente : {SON} (sh sons/mixe.sh depuis travail/sons/)'
n = len(list(IMAGES.parent.glob('img_*.png')))
assert n == IPS * DUREE_MS // 1000 + 1, f'{n} images rendues, il en faut {IPS * DUREE_MS // 1000 + 1}'

films = deux_films(IMAGES, SORTIE, SORTIE_AV1, LARGEUR, HAUTEUR, IPS, debit=DEBIT_VIDEO, son=SON, duree_s=DUREE_MS / 1000)
octets, av1 = SORTIE.stat().st_size, films['av1']
if octets > PLAFOND:
    raise SystemExit(f'vidéo de distribution : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')
if av1['octets'] > PLAFOND_AV1:
    raise SystemExit(f'vidéo de distribution en AV1 : {av1["octets"]} octets pour un plafond de {PLAFOND_AV1}')

shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-distribution.mp4')
shutil.copyfile(SORTIE_AV1, RACINE / 'public' / 'kiosk-distribution.av1.mp4')
donnees = {
    'film': {'src': '/kiosk-distribution.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets,
             'av1': {'src': '/kiosk-distribution.av1.mp4', **av1}},
    'arret': json.loads((D / 'distribution' / 'arret.json').read_text()),
}
# La tranche du film loué suit la K7 (spec § 13) : le suivi par image et les deux planches de distribution_planches.py.
for source, cible in (('suivi.json', 'kiosk-distribution-suivi.json'), ('caches.webp', 'kiosk-distribution-caches.webp'), ('ombres.webp', 'kiosk-distribution-ombres.webp')):
    shutil.copyfile(D / 'distribution' / 'site' / source, RACINE / 'public' / cible)
(RACINE / 'src' / 'data' / 'kiosk-distribution.json').write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-distribution.mp4 et .av1.mp4 : {films["journal"]} | src/data/kiosk-distribution.json', donnees['arret'])
