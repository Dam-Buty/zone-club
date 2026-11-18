"""Encode les sorties de la fabrique pour le site, pour la variante en cours.

mobile : la devanture (WebP et JPEG), la vue rapprochée de l'écran de la borne (WebP), la mise en page.
bureau : la devanture (JPEG, texture de la scène animée), son masque de reflets (PNG) et la mise en page.
Pour toute variante qui a un bloc « approche » : le film d'approche de la borne (MP4), décrit dans la mise en page.
La mise en page dit où sont la borne, son écran et la porte dans l'image, en fractions.

Usage : [DEVANTURE=bureau] python3 sorties.py   (après compo.py, et la passe « zoom » de borne.py pour le mobile)
"""
import json

from PIL import Image

import shutil

from variante import D, G, ICI, VARIANTE

RACINE = ICI.parent.parent
PUBLIC, DONNEES = RACINE / 'public', RACINE / 'src' / 'data'
# Bureau : la texture de la scène animée garde la hauteur qu'elle avait avant la borne (1117 px), à son nouveau format.
BUREAU_PX = (2102, 1117)

mise = json.loads((D / 'mise-en-page.json').read_text())
compo = Image.open(D / 'compo.png').convert('RGB')
assert compo.size == (mise['image']['w'], mise['image']['h']), compo.size
ecrits = []

if VARIANTE == 'mobile':
    zoom = Image.open(D / 'zoom.png').convert('RGB')
    assert zoom.size == (mise['zoom']['w'], mise['zoom']['h']), zoom.size
    compo.save(PUBLIC / 'storefront-mobile.webp', 'WEBP', quality=84, method=6)
    compo.save(PUBLIC / 'storefront-mobile.jpeg', 'JPEG', quality=88, optimize=True, progressive=True)
    zoom.save(PUBLIC / 'storefront-borne-zoom.webp', 'WEBP', quality=82, method=6)
    ecrits += ['storefront-mobile.webp', 'storefront-mobile.jpeg', 'storefront-borne-zoom.webp']
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
                        'ecran': json.loads((D / 'approche' / 'ecran-arrivee.json').read_text())}
    ecrits += [AP['film']['fichier']]

(DONNEES / donnees).write_text(json.dumps(mise, indent=2) + '\n')
for nom in ecrits:
    print(f'{nom:28} {(PUBLIC / nom).stat().st_size / 1024:7.0f} Ko')
print('src/data/' + donnees)
