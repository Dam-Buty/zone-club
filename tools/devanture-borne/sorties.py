"""Encode les sorties de la fabrique pour le site, pour la variante en cours.

mobile : la devanture (WebP et JPEG), la vue rapprochée de l'écran de la borne (WebP), la mise en page.
bureau : la devanture (JPEG, texture de la scène animée) et la mise en page.
La mise en page dit où sont la borne, son écran et la porte dans l'image, en fractions.

Usage : [DEVANTURE=bureau] python3 sorties.py   (après compo.py, et la passe « zoom » de borne.py pour le mobile)
"""
import json

from PIL import Image

from variante import D, ICI, VARIANTE

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
    ecrits += ['storefront.jpeg']
    donnees = 'storefront-desktop.json'
else:
    raise SystemExit(f'sorties.py : variante « {VARIANTE} » sans sorties définies')

(DONNEES / donnees).write_text(json.dumps(mise, indent=2) + '\n')
for nom in ecrits:
    print(f'{nom:28} {(PUBLIC / nom).stat().st_size / 1024:7.0f} Ko')
print('src/data/' + donnees)
