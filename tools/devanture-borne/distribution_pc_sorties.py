"""La distribution de la K7 sur PC : ce que le site reçoit. DEVANTURE=bureau python3 distribution_pc_sorties.py

Après le film du PC (distribution_film.py TRAJET=…, approche_rendu.py mur, approche_compo.py — voir distribution_pc.sh),
son relevé et ses planches (distribution_planches.py) et son décor (decor_0000.png). Encode le film en 1920 × 1020 avec
la bande-son du film du téléphone (mêmes instants), contrôle son poids et ses étiquettes de couleur, puis écrit :

  public/kiosk-distribution-pc.mp4, -pc-suivi.json, -pc-caches.webp, -pc-ombres.webp ;
  public/kiosk/decor-pc.webp — la première image du film, deux fois plus fine, sans pluie : la borne modélisée que
  la page garde derrière l'écran (Rusmir, 23/11/2026 : « l'image doit être de bonne qualité ») ;
  la clé « pc » de src/data/kiosk-distribution.json (le reste du fichier, écrit par distribution_sorties.py, est gardé).
"""
import json
import shutil
import subprocess

from PIL import Image

from variante import D, G, ICI

FILM = G['approche']['film']
LARGEUR, HAUTEUR, IPS, DUREE_MS = FILM['w'], FILM['h'], 24, 8000
PLAFOND = 5_000_000                 # octets : un film de PC, 2,1 fois plus de points que celui du téléphone (plafonné à 2,6 Mo)
DEBIT_VIDEO, DEBIT_SON = '4500k', '128k'
RACINE = ICI.parents[1]
PC = D / 'distribution' / 'pc'
IMAGES = PC / 'film_%04d.png'
SON = ICI / 'travail' / 'sons' / 'bande-son-film.wav'
SORTIE = PC / 'film.mp4'
SITE = D / 'distribution' / 'site'
assert SON.exists(), f'bande-son absente : {SON}'
n = len(list(PC.glob('film_*.png')))
assert n == IPS * DUREE_MS // 1000 + 1, f'{n} images assemblées, il en faut {IPS * DUREE_MS // 1000 + 1}'

filtre = (f'scale={LARGEUR}:{HAUTEUR}:flags=lanczos:out_color_matrix=bt709:out_range=tv,'
          'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv')
commun = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(IPS), '-i', str(IMAGES)]
video = ['-vf', filtre, '-c:v', 'libx264', '-preset', 'slow', '-b:v', DEBIT_VIDEO, '-pix_fmt', 'yuv420p', '-passlogfile', str(PC / 'passe')]
subprocess.run(commun + video + ['-pass', '1', '-an', '-f', 'mp4', '/dev/null'], check=True)
subprocess.run(commun + ['-i', str(SON)] + video + ['-pass', '2', '-c:a', 'aac', '-b:a', DEBIT_SON, '-t', str(DUREE_MS / 1000),
                                                    '-movflags', '+faststart', str(SORTIE)], check=True)
etiquettes = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                             'stream=color_space,color_range,color_primaries,color_transfer', '-of', 'csv=p=0', str(SORTIE)],
                            check=True, capture_output=True, text=True).stdout.strip()
if etiquettes != 'tv,bt709,iec61966-2-1,bt709':
    raise SystemExit(f'vidéo de distribution du PC : étiquettes de couleur inattendues ({etiquettes})')
octets = SORTIE.stat().st_size
if octets > PLAFOND:
    raise SystemExit(f'vidéo de distribution du PC : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')

suivi = json.loads((SITE / 'suivi.json').read_text())
assert suivi['images'] == n, 'le relevé et le film n\'ont pas le même nombre d\'images'
decor = Image.open(PC / 'decor_0000.png').convert('RGB')
(RACINE / 'public' / 'kiosk').mkdir(exist_ok=True)
decor.save(RACINE / 'public' / 'kiosk' / 'decor-pc.webp', 'WEBP', quality=88, method=6)
shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-distribution-pc.mp4')
for source, cible in (('suivi.json', 'kiosk-distribution-pc-suivi.json'), ('caches.webp', 'kiosk-distribution-pc-caches.webp'), ('ombres.webp', 'kiosk-distribution-pc-ombres.webp')):
    shutil.copyfile(SITE / source, RACINE / 'public' / cible)
fichier = RACINE / 'src' / 'data' / 'kiosk-distribution.json'
donnees = json.loads(fichier.read_text())
donnees['pc'] = {
    'film': {'src': '/kiosk-distribution-pc.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets},
    'suivi': '/kiosk-distribution-pc-suivi.json', 'caches': '/kiosk-distribution-pc-caches.webp', 'ombres': '/kiosk-distribution-pc-ombres.webp',
    # L'écran de la borne dans le décor : celui de la première image du film (même appareil).
    'decor': {'src': '/kiosk/decor-pc.webp', 'largeur': decor.width, 'hauteur': decor.height, 'ecran': suivi['pas'][0]['e']},
}
fichier.write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-distribution-pc.mp4 {octets / 1024:7.0f} Ko | decor-pc.webp {(RACINE / "public" / "kiosk" / "decor-pc.webp").stat().st_size / 1024:5.0f} Ko '
      f'({decor.width} × {decor.height}) | écran du décor {donnees["pc"]["decor"]["ecran"]}')
