"""Les films de la borne pour le site : un fichier H.264 pour tous, un fichier AV1 pour les appareils qui le lisent.

Rusmir, 26/11/2026 : « ceux qui sont compatibles AV1 reçoivent la vidéo AV1, les autres la vidéo H264 ». Mesuré sur le
film de location de 8 s : à qualité égale (SSIM 0,990 contre les images rendues), l'AV1 pèse 1 342 Ko et le H.264
2 267 Ko. Le H.264 garde son débit (c'est le film des appareils sans AV1 : les iPhone avant le 15 Pro, entre autres) ;
l'AV1 prend le poids le plus bas qui égale la qualité MESURÉE du H.264 — cherchée ici film par film, pas supposée.

Les images sont en sRGB : chaque film est étiqueté ainsi (matrice BT.709, plage réduite, transfert sRGB) par le filtre
setparams, et ses étiquettes sont relues (voir « encode » dans fabrique.sh : un film sans étiquette de transfert sort
plus clair que l'image fixe dans Chrome sur Mac). Le site choisit le fichier : src/utils/video-source.ts.
"""
import json
import subprocess
from pathlib import Path

ETIQUETTES = 'tv,bt709,iec61966-2-1,bt709'
# Recherche du réglage AV1 : du plus léger au plus lourd, de 2 en 2 ; au-delà de CRF_AV1_MIN on n'égale plus le H.264
# qu'à un poids voisin du sien, et l'AV1 ne sert plus à rien — la fabrique s'arrête.
CRF_AV1_MAX, CRF_AV1_MIN = 36, 20
TOLERANCE_SSIM = 0.0005       # l'écart de mesure entre deux encodages équivalents ; en deçà, l'œil ne le voit pas


def filtre(largeur, hauteur):
    return (f'scale={largeur}:{hauteur}:flags=lanczos:out_color_matrix=bt709:out_range=tv,'
            'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv')


def _son(son, duree_s, debit_son):
    if son is None:
        return ['-an']
    return ['-c:a', 'aac', '-b:a', debit_son, '-t', str(duree_s)]


def h264(images, sortie, largeur, hauteur, ips, *, debit=None, crf=None, son=None, duree_s=None, debit_son='128k'):
    """Deux passes à débit fixé (`debit`), ou une passe à qualité constante (`crf`). Avec ou sans son."""
    entree = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(ips), '-i', str(images)]
    video = ['-vf', filtre(largeur, hauteur), '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p']
    if debit:
        journal = ['-passlogfile', str(Path(sortie).with_suffix('.passe'))]
        duree = ['-t', str(duree_s)] if duree_s else []     # les deux passes voient les mêmes images
        subprocess.run(entree + video + ['-b:v', debit] + journal + ['-pass', '1', '-an'] + duree + ['-f', 'mp4', '/dev/null'], check=True)
        video += ['-b:v', debit] + journal + ['-pass', '2']
    else:
        video += ['-crf', str(crf)]
    sons = ['-i', str(son)] if son else []
    subprocess.run(entree + sons + video + _son(son, duree_s, debit_son) + ['-movflags', '+faststart', str(sortie)], check=True)
    controle_etiquettes(sortie)


def av1(images, sortie, largeur, hauteur, ips, crf, *, son=None, duree_s=None, debit_son='128k'):
    """SVT-AV1, qualité constante. Une image clé toutes les 2 s ; réglé sur la SSIM, la mesure qui le compare au H.264."""
    entree = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(ips), '-i', str(images)]
    sons = ['-i', str(son)] if son else []
    video = ['-vf', filtre(largeur, hauteur), '-c:v', 'libsvtav1', '-preset', '4', '-crf', str(crf), '-g', str(2 * ips),
             '-svtav1-params', 'tune=2', '-pix_fmt', 'yuv420p']
    subprocess.run(entree + sons + video + _son(son, duree_s, debit_son) + ['-movflags', '+faststart', str(sortie)],
                   check=True, stderr=subprocess.DEVNULL)
    controle_etiquettes(sortie)


def controle_etiquettes(film):
    lues = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                           'stream=color_space,color_range,color_primaries,color_transfer', '-of', 'csv=p=0', str(film)],
                          check=True, capture_output=True, text=True).stdout.strip()
    if lues != ETIQUETTES:
        raise SystemExit(f'{film} : étiquettes de couleur inattendues ({lues}), attendu {ETIQUETTES}')


def ssim(film, images, largeur, hauteur, ips):
    """La ressemblance du film aux images rendues, ramenées à sa taille (1 : identique)."""
    sortie = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', str(film), '-framerate', str(ips), '-i', str(images), '-lavfi',
         f'[1:v]scale={largeur}:{hauteur}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p[ref];'
         '[0:v]format=yuv420p[d];[d][ref]ssim', '-f', 'null', '-'],
        check=True, capture_output=True, text=True).stderr
    return float([l for l in sortie.splitlines() if 'All:' in l][-1].split('All:')[1].split()[0])


def codecs_av1(film):
    """La chaîne `codecs` du fichier (profil, niveau, palier, profondeur), lue dans le fichier : av01.0.05M.08 pour
    un 720 × 1290. Le site la passe telle quelle au navigateur pour lui demander s'il sait le lire."""
    flux = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                      'stream=codec_name,profile,level,pix_fmt', '-of', 'json', str(film)],
                                     check=True, capture_output=True, text=True).stdout)['streams'][0]
    assert flux['codec_name'] == 'av1' and flux['profile'] == 'Main' and flux['pix_fmt'] == 'yuv420p', flux
    return f"av01.0.{int(flux['level']):02d}M.08"


def av1_au_niveau(images, film_h264, sortie_av1, largeur, hauteur, ips, *, son=None, duree_s=None):
    """L'AV1 le plus léger qui égale la qualité mesurée de `film_h264` (encodé des mêmes images). Rend ce que le site
    doit savoir de lui et une ligne pour le journal."""
    cible = ssim(film_h264, images, largeur, hauteur, ips)
    essais = []
    for crf_av1 in range(CRF_AV1_MAX, CRF_AV1_MIN - 1, -2):
        av1(images, sortie_av1, largeur, hauteur, ips, crf_av1, son=son, duree_s=duree_s)
        mesure = ssim(sortie_av1, images, largeur, hauteur, ips)
        essais.append((crf_av1, round(mesure, 5)))
        if mesure >= cible - TOLERANCE_SSIM:
            break
    else:
        raise SystemExit(f'{sortie_av1} : aucun réglage AV1 n\'égale la qualité du H.264 ({cible:.5f}) — essais {essais}')
    octets_h264, octets_av1 = Path(film_h264).stat().st_size, Path(sortie_av1).stat().st_size
    if octets_av1 >= octets_h264:
        raise SystemExit(f'{sortie_av1} : {octets_av1} octets, pas plus léger que le H.264 ({octets_h264})')
    return {
        'av1': {'codecs': codecs_av1(sortie_av1), 'octets': octets_av1},
        'journal': f'H.264 {octets_h264 / 1024:.0f} Ko (SSIM {cible:.5f}) | AV1 {octets_av1 / 1024:.0f} Ko '
                   f'(CRF {essais[-1][0]}, SSIM {essais[-1][1]:.5f}, {100 * (1 - octets_av1 / octets_h264):.0f} % de moins)',
    }


def deux_films(images, sortie_h264, sortie_av1, largeur, hauteur, ips, *, debit=None, crf=None, son=None, duree_s=None):
    """Le H.264 (débit ou qualité constante), puis l'AV1 le plus léger qui égale sa qualité (av1_au_niveau)."""
    h264(images, sortie_h264, largeur, hauteur, ips, debit=debit, crf=crf, son=son, duree_s=duree_s)
    return av1_au_niveau(images, sortie_h264, sortie_av1, largeur, hauteur, ips, son=son, duree_s=duree_s)
