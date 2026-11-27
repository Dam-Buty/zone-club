"""La distribution de la K7 sur PC : ce que le site reçoit. DEVANTURE=bureau python3 distribution_pc_sorties.py

Après le film du PC (distribution_film.py TRAJET=…, approche_rendu.py mur, approche_compo.py — voir distribution_pc.sh),
son relevé et ses planches (distribution_planches.py) et son décor (decor_0000.png). Encode le film en 1920 × 1020 avec
la bande-son du film du téléphone (mêmes instants), en H.264 et en AV1 (encodage.py), contrôle les poids et les
étiquettes de couleur, puis écrit :

  public/kiosk-distribution-pc.mp4, -pc.av1.mp4, -pc-suivi.json, -pc-caches.webp, -pc-ombres.webp ;
  public/kiosk/decor-pc.webp — la première image du film, deux fois plus fine, sans pluie : la borne modélisée que
  la page garde derrière l'écran (Rusmir, 23/11/2026 : « l'image doit être de bonne qualité ») ;
  la clé « pc » de src/data/kiosk-distribution.json (le reste du fichier, écrit par distribution_sorties.py, est gardé).
"""
import json
import shutil

from PIL import Image

from encodage import deux_films
from variante import D, G, ICI

FILM = G['approche']['film']
LARGEUR, HAUTEUR, IPS, DUREE_MS = FILM['w'], FILM['h'], 24, 9250    # comme le film du téléphone (distribution_sorties.py)
# Un film de PC, 2,1 fois plus de points que celui du téléphone. Le H.264 ne va plus qu'aux navigateurs sans AV1
# (26/11/2026) : il garde le débit du film de 8 s, et son plafond suit la durée.
PLAFOND, PLAFOND_AV1 = 5_400_000, 3_400_000      # octets
DEBIT_VIDEO = '4500k'
RACINE = ICI.parents[1]
PC = D / 'distribution' / 'pc'
IMAGES = PC / 'film_%04d.png'
SON = ICI / 'travail' / 'sons' / 'bande-son-film.wav'
SORTIE, SORTIE_AV1 = PC / 'film.mp4', PC / 'film.av1.mp4'
SITE = D / 'distribution' / 'site'
assert SON.exists(), f'bande-son absente : {SON}'
n = len(list(PC.glob('film_*.png')))
assert n == IPS * DUREE_MS // 1000 + 1, f'{n} images assemblées, il en faut {IPS * DUREE_MS // 1000 + 1}'

films = deux_films(IMAGES, SORTIE, SORTIE_AV1, LARGEUR, HAUTEUR, IPS, debit=DEBIT_VIDEO, son=SON, duree_s=DUREE_MS / 1000)
octets, av1 = SORTIE.stat().st_size, films['av1']
if octets > PLAFOND:
    raise SystemExit(f'vidéo de distribution du PC : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')
if av1['octets'] > PLAFOND_AV1:
    raise SystemExit(f'vidéo de distribution du PC en AV1 : {av1["octets"]} octets pour un plafond de {PLAFOND_AV1}')

suivi = json.loads((SITE / 'suivi.json').read_text())
assert suivi['images'] == n, 'le relevé et le film n\'ont pas le même nombre d\'images'
decor = Image.open(PC / 'decor_0000.png').convert('RGB')
(RACINE / 'public' / 'kiosk').mkdir(exist_ok=True)
decor.save(RACINE / 'public' / 'kiosk' / 'decor-pc.webp', 'WEBP', quality=88, method=6)
shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-distribution-pc.mp4')
shutil.copyfile(SORTIE_AV1, RACINE / 'public' / 'kiosk-distribution-pc.av1.mp4')
for source, cible in (('suivi.json', 'kiosk-distribution-pc-suivi.json'), ('caches.webp', 'kiosk-distribution-pc-caches.webp'), ('ombres.webp', 'kiosk-distribution-pc-ombres.webp')):
    shutil.copyfile(SITE / source, RACINE / 'public' / cible)
fichier = RACINE / 'src' / 'data' / 'kiosk-distribution.json'
donnees = json.loads(fichier.read_text())
donnees['pc'] = {
    'film': {'src': '/kiosk-distribution-pc.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets,
             'av1': {'src': '/kiosk-distribution-pc.av1.mp4', **av1}},
    'suivi': '/kiosk-distribution-pc-suivi.json', 'caches': '/kiosk-distribution-pc-caches.webp', 'ombres': '/kiosk-distribution-pc-ombres.webp',
    # L'écran de la borne dans le décor : celui de la première image du film (même appareil).
    'decor': {'src': '/kiosk/decor-pc.webp', 'largeur': decor.width, 'hauteur': decor.height, 'ecran': suivi['pas'][0]['e']},
}
fichier.write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-distribution-pc.mp4 et .av1.mp4 : {films["journal"]} | decor-pc.webp {(RACINE / "public" / "kiosk" / "decor-pc.webp").stat().st_size / 1024:5.0f} Ko '
      f'({decor.width} × {decor.height}) | écran du décor {donnees["pc"]["decor"]["ecran"]}')
