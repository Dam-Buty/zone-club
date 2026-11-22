"""La distribution de la K7 : ce que le site reçoit (après distribution_film.py). python3 distribution_sorties.py

Encode les images du film (cadrage mixte, rendues à l'échelle 2) en 720 × 1290 avec la bande-son, contrôle le poids et
les étiquettes de couleur, puis écrit public/kiosk-distribution.mp4 et src/data/kiosk-distribution.json — la vidéo, sa
durée, et l'arrêt sur la fente (quand et où la page pose la tranche du film loué et le texte de l'afficheur).
"""
import json
import shutil
import subprocess

from variante import D, ICI

LARGEUR, HAUTEUR, IPS, DUREE_MS = 720, 1290, 24, 8000
PLAFOND = 2_600_000                 # octets — Rusmir, 22/11/2026 : « ok jusqu'à 2,6 méga »
DEBIT_VIDEO, DEBIT_SON = '2300k', '128k'
RACINE = ICI.parents[1]
IMAGES = D / 'distribution' / 'film' / 'img_%04d.png'      # rendues par : DOSSIER=film QUALITE=photo LUMIERE=douce ECHELLE=2 … distribution_film.py -- 128 mixte
SON = D / 'sons' / 'bande-son-film.wav'
SORTIE = D / 'distribution' / 'film.mp4'
assert SON.exists(), f'bande-son absente : {SON} (sh sons/mixe.sh depuis travail/sons/)'
n = len(list(IMAGES.parent.glob('img_*.png')))
assert n == IPS * DUREE_MS // 1000 + 1, f'{n} images rendues, il en faut {IPS * DUREE_MS // 1000 + 1}'

# Les images sont en sRGB : la vidéo est étiquetée ainsi par setparams (voir « encode » dans fabrique.sh).
filtre = (f'scale={LARGEUR}:{HAUTEUR}:flags=lanczos:out_color_matrix=bt709:out_range=tv,'
          'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv')
commun = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(IPS), '-i', str(IMAGES)]
video = ['-vf', filtre, '-c:v', 'libx264', '-preset', 'slow', '-b:v', DEBIT_VIDEO, '-pix_fmt', 'yuv420p',
         '-passlogfile', str(D / 'distribution' / 'passe')]
subprocess.run(commun + video + ['-pass', '1', '-an', '-f', 'mp4', '/dev/null'], check=True)
subprocess.run(commun + ['-i', str(SON)] + video + ['-pass', '2', '-c:a', 'aac', '-b:a', DEBIT_SON, '-t', str(DUREE_MS / 1000),
                                                    '-movflags', '+faststart', str(SORTIE)], check=True)
etiquettes = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                             'stream=color_space,color_range,color_primaries,color_transfer', '-of', 'csv=p=0', str(SORTIE)],
                            check=True, capture_output=True, text=True).stdout.strip()
if etiquettes != 'tv,bt709,iec61966-2-1,bt709':
    raise SystemExit(f'vidéo de distribution : étiquettes de couleur inattendues ({etiquettes})')
octets = SORTIE.stat().st_size
if octets > PLAFOND:
    raise SystemExit(f'vidéo de distribution : {octets} octets pour un plafond de {PLAFOND} — baisser DEBIT_VIDEO')

shutil.copyfile(SORTIE, RACINE / 'public' / 'kiosk-distribution.mp4')
donnees = {
    'film': {'src': '/kiosk-distribution.mp4', 'largeur': LARGEUR, 'hauteur': HAUTEUR, 'dureeMs': DUREE_MS, 'octets': octets},
    'arret': json.loads((D / 'distribution' / 'arret.json').read_text()),
}
(RACINE / 'src' / 'data' / 'kiosk-distribution.json').write_text(json.dumps(donnees, indent=2) + '\n')
print(f'kiosk-distribution.mp4 {octets / 1024:7.0f} Ko | src/data/kiosk-distribution.json', donnees['arret'])
