"""L'étiquette de suivi du vidéoclub collée sur la cassette (pour k7_reference.py). python3 k7_etiquette.py"""
from variante import D


def etiquette_club():
    """L'étiquette de suivi du vidéoclub, collée sur la cassette : code-barres, titre, cote (comme sur la référence)."""
    from PIL import Image, ImageDraw, ImageFont
    import random
    r = random.Random(9426)
    w, h = 1400, 330
    im = Image.new('RGB', (w, h), (236, 234, 226))
    d = ImageDraw.Draw(im)
    f = lambda t: ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Narrow.ttf', t)  # noqa: E731
    x = 60
    while x < 620:
        e = r.choice((3, 3, 5, 8))
        d.rectangle([x, 28, x + e, 150], fill=(18, 18, 18))
        x += e + r.choice((3, 4, 6, 9))
    d.text((60, 162), '0009426 160', fill=(25, 25, 25), font=f(34))
    d.text((60, 204), 'LA MOUCHE', fill=(15, 15, 15), font=f(58))
    d.text((60, 270), 'HOR / SF     VF     2 CRÉDITS', fill=(40, 40, 40), font=f(34))
    d.rectangle([1010, 60, 1330, 250], outline=(120, 40, 160), width=6)
    d.text((1170, 122), 'ZONE', fill=(120, 40, 160), font=f(70), anchor='mm')
    d.text((1170, 196), 'CLUB', fill=(120, 40, 160), font=f(70), anchor='mm')
    # Coins arrondis, comme une étiquette découpée à l'emporte-pièce ; le reste de l'image est transparent.
    masque = Image.new('L', (w, h), 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, w - 1, h - 1], radius=34, fill=255)
    im.putalpha(masque)
    p = D / 'tex' / 'etiquette-club.png'
    im.save(p)
    return p


print('ÉTIQUETTE', etiquette_club())
