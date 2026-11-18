"""Encode les sorties de la fabrique pour le site : la devanture mobile (WebP et JPEG), la vue rapprochée de l'écran de
la borne (WebP) et la mise en page (où sont la borne, son écran et la porte dans l'image).

Usage : python3 sorties.py   (après compo.py et la passe « zoom » de borne.py)
"""
import json
from pathlib import Path

from PIL import Image

ICI = Path(__file__).resolve().parent
D = ICI / 'travail'
RACINE = ICI.parent.parent
PUBLIC, DONNEES = RACINE / 'public', RACINE / 'src' / 'data'

mise = json.loads((D / 'mise-en-page.json').read_text())
compo = Image.open(D / 'compo.png').convert('RGB')
zoom = Image.open(D / 'zoom.png').convert('RGB')
assert compo.size == (mise['image']['w'], mise['image']['h']), compo.size
assert zoom.size == (mise['zoom']['w'], mise['zoom']['h']), zoom.size

compo.save(PUBLIC / 'storefront-mobile.webp', 'WEBP', quality=84, method=6)
compo.save(PUBLIC / 'storefront-mobile.jpeg', 'JPEG', quality=88, optimize=True, progressive=True)
zoom.save(PUBLIC / 'storefront-borne-zoom.webp', 'WEBP', quality=82, method=6)
(DONNEES / 'storefront-mobile.json').write_text(json.dumps(mise, indent=2) + '\n')

for nom in ('storefront-mobile.webp', 'storefront-mobile.jpeg', 'storefront-borne-zoom.webp'):
    print(f'{nom:28} {(PUBLIC / nom).stat().st_size / 1024:7.0f} Ko')
print('src/data/storefront-mobile.json')
