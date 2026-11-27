"""Encode les sorties de la fabrique pour le site, pour la variante en cours.

mobile : la devanture (WebP et JPEG) et la mise en page.
bureau : la devanture (JPEG, texture de la scène animée), son masque de reflets (PNG) et la mise en page.
Pour toute variante qui a un bloc « approche » : le film d'approche de la borne (MP4, H.264 encodé par fabrique.sh, et
sa version AV1 pour les appareils qui la lisent, cherchée ici au niveau de qualité du H.264 : encodage.py), décrit dans
la mise en page.
La mise en page dit où sont la borne, son écran et la porte dans l'image, en fractions.

Usage : [DEVANTURE=bureau] python3 sorties.py   (à la fin de fabrique.sh)
"""
import json

from PIL import Image

import shutil

from encodage import av1_au_niveau
from variante import D, G, ICI, VARIANTE

RACINE = ICI.parent.parent
PUBLIC, DONNEES = RACINE / 'public', RACINE / 'src' / 'data'
# Bureau : la texture de la scène animée garde la hauteur qu'elle avait avant la borne (1117 px), à son nouveau format.
BUREAU_PX = (2102, 1117)

mise = json.loads((D / 'mise-en-page.json').read_text())
compo = Image.open(D / 'compo.png').convert('RGB')
assert compo.size == (mise['image']['w'], mise['image']['h']), compo.size
ecrits, journal = [], []


def version_av1(film_h264, reglage):
    """L'AV1 du film d'approche `film_h264` (à la taille `reglage`), copié dans public/ : ce que la mise en page en dit."""
    sortie = film_h264.with_suffix('.av1.mp4')
    r = av1_au_niveau(D / 'approche' / 'film_%04d.png', film_h264, sortie, reglage['w'], reglage['h'], G['approche']['ips'])
    fichier = reglage['fichier'].removesuffix('.mp4') + '.av1.mp4'
    shutil.copyfile(sortie, PUBLIC / fichier)
    ecrits.append(fichier)
    journal.append(f"{reglage['fichier']} : {r['journal']}")
    return {'src': '/' + fichier, **r['av1']}


if VARIANTE == 'mobile':
    compo.save(PUBLIC / 'storefront-mobile.webp', 'WEBP', quality=84, method=6)
    compo.save(PUBLIC / 'storefront-mobile.jpeg', 'JPEG', quality=88, optimize=True, progressive=True)
    ecrits += ['storefront-mobile.webp', 'storefront-mobile.jpeg']
    donnees = 'storefront-mobile.json'
elif VARIANTE == 'bureau':
    assert abs(BUREAU_PX[0] / BUREAU_PX[1] - compo.width / compo.height) < 0.002, 'la texture du site a le format de l\'image'
    compo.resize(BUREAU_PX, Image.LANCZOS).save(PUBLIC / 'storefront.jpeg', 'JPEG', quality=88, optimize=True, progressive=True)
    # Le masque de reflets, à la moitié de la taille de l'image (moyenne exacte de 2 × 2 pixels).
    masque = Image.open(D / 'masque.png').convert('RGB')
    assert masque.size == compo.size and compo.width % 2 == 0 and compo.height % 2 == 0, masque.size
    masque.reduce(2).save(PUBLIC / 'storefront-mask.png', optimize=True)
    ecrits += ['storefront.jpeg', 'storefront-mask.png']
    donnees = 'storefront-desktop.json'
else:
    raise SystemExit(f'sorties.py : variante « {VARIANTE} » sans sorties définies')

# Le film d'approche de la borne (approche_*.py, encodé par fabrique.sh) et ce que le site doit en savoir.
if 'approche' in G:
    AP = G['approche']
    film = D / 'approche' / 'film.mp4'
    octets = film.stat().st_size
    if octets > AP['film']['budget_octets']:
        raise SystemExit(f"sorties.py : le film d'approche pèse {octets} octets, pour un budget de {AP['film']['budget_octets']} — monter approche.film.crf")
    shutil.copyfile(film, PUBLIC / AP['film']['fichier'])
    mise['approche'] = {'src': '/' + AP['film']['fichier'], 'w': AP['film']['w'], 'h': AP['film']['h'], 'duree': AP['duree_s'],
                        'images': round(AP['ips'] * AP['duree_s']) + 1, 'octets': octets,
                        'ecran': json.loads((D / 'approche' / 'ecran-arrivee.json').read_text()),
                        'av1': version_av1(film, AP['film'])}
    ecrits += [AP['film']['fichier']]
    if 'film_hd' in AP:             # second film, en haute définition : même trajet, même cadrage, le site choisit selon l'écran
        HD = AP['film_hd']
        film_hd = D / 'approche' / 'film-hd.mp4'
        octets_hd = film_hd.stat().st_size
        if octets_hd > HD['budget_octets']:
            raise SystemExit(f"sorties.py : le film d'approche en haute définition pèse {octets_hd} octets, pour un budget de {HD['budget_octets']} — monter approche.film_hd.crf")
        shutil.copyfile(film_hd, PUBLIC / HD['fichier'])
        mise['approche']['hd'] = {'src': '/' + HD['fichier'], 'w': HD['w'], 'h': HD['h'], 'octets': octets_hd,
                                  'av1': version_av1(film_hd, HD)}
        ecrits += [HD['fichier']]

(DONNEES / donnees).write_text(json.dumps(mise, indent=2) + '\n')
for nom in ecrits:
    print(f'{nom:28} {(PUBLIC / nom).stat().st_size / 1024:7.0f} Ko')
print('src/data/' + donnees)
print('\n'.join(journal))
