"""Devanture mobile avec la borne : textures de la borne (autocollants usés, tranches de K7, bandeau, usure).

Usage : python3 textures.py   → travail/tex/
Les films des tranches, leur affiche et leur logo sont figés dans sources/tranches.json ; les images sont téléchargées
une fois chez TMDB (sans clé) et restent dans travail/tmdb-cache/. Une image attendue qui manque arrête la fabrique.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ICI = Path(__file__).resolve().parent
D = ICI / 'travail'                 # tout l'intermédiaire (ignoré par git)
D.mkdir(exist_ok=True)
SRC = ICI / 'sources'
T = D / 'tex'
T.mkdir(exist_ok=True)
rng = np.random.default_rng(2007)


def noise(h, w, scale, seed):
    r = np.random.default_rng(seed)
    g = r.random((h // scale + 2, w // scale + 2))
    return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize(((w // scale + 2) * scale, (h // scale + 2) * scale), Image.BICUBIC)).astype(float)[:h, :w] / 255


def fbm(h, w, scale, seed, octaves=4):
    out, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        out += amp * noise(h, w, max(2, scale // (2 ** o)), seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


def scratches(w, h, n, seed, length=(8, 90), alpha=(0.25, 0.8)):
    r = np.random.default_rng(seed)
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    for _ in range(n):
        x, y = r.random() * w, r.random() * h
        ang = r.uniform(0, np.pi)
        L = r.uniform(*length)
        pts = [(x, y)]
        for _s in range(4):
            ang += r.normal(0, 0.12)
            x += np.cos(ang) * L / 4
            y += np.sin(ang) * L / 4
            pts.append((x, y))
        d.line(pts, fill=int(255 * r.uniform(*alpha)), width=1)
    return np.asarray(m).astype(float) / 255


def wear(img, mask, fade=0.25, paper=(236, 230, 214), seed=0, n_scratch=60, torn=None, peel=None):
    """Usure d'un autocollant : couleurs passées au soleil, crasse, rayures qui montrent le papier,
    déchirure (torn : 'diag' = la moitié haute arrachée, il reste des fibres et de la colle) et coin
    décollé (peel : coin bas droit arraché, reste de colle)."""
    a = np.asarray(img.convert('RGB')).astype(float)
    h, w, _ = a.shape
    gray = a.mean(axis=2, keepdims=True)
    a = a * 0.8 + gray * 0.2                                         # couleurs moins vives
    a = a * (1 - fade) + np.array(paper) * fade                      # passées au soleil
    dirt = 0.82 + 0.18 * fbm(h, w, max(8, w // 10), seed + 1)[..., None]
    a = a * dirt
    sc = scratches(w, h, n_scratch, seed + 2, length=(w * 0.03, w * 0.25))[..., None]
    a = a * (1 - sc * 0.85) + np.array(paper) * sc * 0.85            # le papier apparaît sous l'encre
    alpha = mask.astype(float).copy()
    if torn == 'diag':
        yy, xx = np.mgrid[0:h, 0:w]
        edge = 0.55 * h - 0.35 * (xx - w / 2) + 26 * (fbm(h, w, 12, seed + 3) - 0.5) * h / 100
        gone = yy < edge
        # Lambeaux de papier le long de la déchirure (et quelques-uns plus loin), voile de colle ailleurs.
        near = (edge - yy) < 0.10 * h
        frag = fbm(h, w, 9, seed + 4)
        residue = gone & ((near & (frag > 0.52)) | (frag > 0.78))
        a[residue] = np.array([226, 220, 205]) * (0.85 + 0.15 * fbm(h, w, 5, seed + 5)[residue][:, None])
        alpha[gone & ~residue] = 0.10                                # voile de colle
        alpha[residue] = 0.9
    if peel:
        yy, xx = np.mgrid[0:h, 0:w]
        corner = (xx - w) + (yy - h) > -0.22 * (w + h) / 2 + 10 * (fbm(h, w, 10, seed + 6) - 0.5)
        a[corner] = np.array([210, 205, 195])
        alpha[corner] = 0.28
    out = np.dstack([np.clip(a, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def flood_mask(img, thr=232):
    """Fond blanc autour d'un autocollant découpé : rempli depuis les coins, il s'arrête au liseré."""
    g = np.asarray(img.convert('L'))
    h, w = g.shape
    bg = np.zeros((h, w), bool)
    stack = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= h or x >= w or bg[y, x] or g[y, x] < thr:
            continue
        bg[y, x] = True
        stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
    m = (~bg).astype(np.uint8) * 255
    return np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255


# ----- les quatre autocollants -----
ultra = Image.open(SRC / 'autocollant-ultramarines.jpg').convert('RGB')
yy, xx = np.mgrid[0:ultra.height, 0:ultra.width]
circle = np.clip((ultra.width / 2 - 3 - np.hypot(xx - ultra.width / 2, yy - ultra.height / 2)) / 1.5, 0, 1)
wear(ultra, circle, fade=0.18, seed=10, n_scratch=45).save(T / 'sticker-ultramarines.png')

rosie = Image.open(SRC / 'autocollant-rosie.jpg').convert('RGB')
wear(rosie, np.ones((rosie.height, rosie.width)), fade=0.34, paper=(240, 232, 205), seed=20, n_scratch=70, peel=True).save(T / 'sticker-rosie.png')

che = Image.open(SRC / 'autocollant-che.webp').convert('RGB')
wear(che, flood_mask(che), fade=0.12, seed=30, n_scratch=55).save(T / 'sticker-che.png')

anar = Image.open(SRC / 'autocollant-anarchiste.jpg').convert('RGB')
wear(anar, np.ones((anar.height, anar.width)), fade=0.22, seed=40, n_scratch=60, torn='diag').save(T / 'sticker-anarchiste.png')

# ----- tranches de K7 : tirées de TMDB -----
# Rusmir, 18/11/2026 : « la tranche des K7 devrait être reprise de la base de données TMDB et non juste aléatoire ».
# Le fond de chaque tranche vient de l'affiche du film (sa bande centrale, floutée : la palette du film, comme une
# jaquette qui se prolonge sur la tranche) ; le titre est le logo officiel du film quand TMDB en a un (français
# d'abord), sinon le titre en lettres. Tout est gardé dans tmdb-cache/ : un second passage ne touche plus au réseau.
import io  # noqa: E402
import time  # noqa: E402
import subprocess  # noqa: E402

# Les 96 films sont figés dans sources/tranches.json, dans l'ordre du tirage d'origine (fait le 18/11/2026 parmi les
# 315 films alors disponibles du catalogue). On rejoue ce tirage à blanc pour que la suite de nombres au hasard — donc
# les étiquettes, l'usure et les rayures de chaque tranche — reste celle de l'image validée.
# Le logo retenu pour chaque film est figé lui aussi (logo_path ; null = titre en lettres) : rechoisi chez TMDB à
# chaque fabrication, selon des votes qui bougent, il pouvait changer d'un mois à l'autre.
films = [(f['tmdb_id'], f['title'], f['poster_url'], f['logo_path']) for f in json.loads((SRC / 'tranches.json').read_text())]
rng.shuffle(list(range(315)))
fonts = [f for f in ['/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', '/System/Library/Fonts/Supplemental/Impact.ttf',
                     '/System/Library/Fonts/Supplemental/Futura.ttc', '/System/Library/Fonts/Avenir Next Condensed.ttc'] if Path(f).exists()]
N, LW, LH = 96, 512, 80
CACHE = D / 'tmdb-cache'
CACHE.mkdir(exist_ok=True)
NET = {'ok': 0}


def fetch(url, dest):
    """Télécharge une fois, puis relit le cache. Un téléchargement impossible ARRÊTE la fabrique : sans cela elle
    écrivait dans le site des tranches dégradées (titre en lettres, fond uni), sans rien dire.
    Par curl : le Python de cette machine refuse la chaîne de certificats (CERTIFICATE_VERIFY_FAILED) que curl
    accepte ; la vérification n'est pas désactivée."""
    if dest.exists():
        return dest.read_bytes()
    tmp = dest.with_suffix(dest.suffix + '.part')
    res = subprocess.run(['curl', '-sf', '--max-time', '20', '-A', 'devanture-borne/1.0', '-o', str(tmp), '-K', '-'],
                         input=f'url = "{url}"\n', text=True, capture_output=True)
    if res.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f'textures.py : téléchargement impossible ({url}) — réseau coupé ou image retirée de TMDB ; '
                         f'la fabrique s\'arrête plutôt que de produire des tranches dégradées.')
    tmp.rename(dest)
    NET['ok'] += 1
    time.sleep(0.03)
    return dest.read_bytes()


def ouvre(data, mode, quoi):
    """Une image téléchargée ; illisible, elle arrête la fabrique (même raison que fetch)."""
    try:
        return Image.open(io.BytesIO(data)).convert(mode)
    except Exception as err:
        raise SystemExit(f'textures.py : {quoi} illisible ({err}) — vider travail/tmdb-cache/ et relancer.')


def tmdb_logo(tmdb_id, logo_path):
    """Logo-titre du film, figé dans tranches.json (choisi le 18/11/2026 : français d'abord, puis anglais, puis sans
    langue, le mieux noté). None si le film n'en a pas : son titre est alors écrit en lettres."""
    if not logo_path:
        return None
    return ouvre(fetch('https://image.tmdb.org/t/p/w300' + logo_path, CACHE / f'{tmdb_id}-logo.png'), 'RGBA', f'logo du film {tmdb_id}')


spine_stats = {'logo': 0, 'texte': 0, 'sans affiche': 0}


def spine(tmdb_id, title, poster_url, logo_path, i):
    """Une tranche de 512 × 80 (le haut de la K7 à gauche, le titre se lit de gauche à droite)."""
    poster = None
    if poster_url:
        poster = ouvre(fetch(poster_url.replace('/w500/', '/w185/'), CACHE / f'{tmdb_id}-poster.jpg'), 'RGB', f'affiche du film {tmdb_id}')
    if poster is None:
        spine_stats['sans affiche'] += 1
        bg = np.zeros((LH, LW, 3)) + np.array([18.0, 18.0, 22.0])
    else:
        w, h = poster.size
        band = poster.crop((int(w * 0.30), 0, int(w * 0.70), h)).resize((LH, LW), Image.LANCZOS).filter(ImageFilter.GaussianBlur(7))
        bg = np.asarray(band.rotate(90, expand=True)).astype(float)
    logo = tmdb_logo(tmdb_id, logo_path) if poster is not None else None
    zone = (58, LW - 84)                                      # place du titre, avant l'étiquette du vidéoclub
    if logo is not None and logo.split()[3].getbbox():
        logo = logo.crop(logo.split()[3].getbbox())
        la = np.asarray(logo).astype(float)
        opaque = la[..., 3] > 128
        light = (la[..., :3][opaque].mean() if opaque.any() else 255) > 105
    else:
        logo, light = None, True
    # Le fond s'efface derrière le titre : sombre sous un titre clair, clair sous un titre sombre.
    bg = bg * 0.42 if light else bg * 0.30 + 205 * 0.70
    lab = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))
    if logo is not None:
        k = min((zone[1] - zone[0]) / logo.width, 54 / logo.height)
        lg = logo.resize((max(1, round(logo.width * k)), max(1, round(logo.height * k))), Image.LANCZOS)
        lab.paste(lg, (zone[0] + (zone[1] - zone[0] - lg.width) // 2, (LH - lg.height) // 2), lg)
        spine_stats['logo'] += 1
    else:
        d = ImageDraw.Draw(lab)
        t = title.upper()
        font = ImageFont.truetype(fonts[0], 44)
        while d.textlength(t, font=font) > zone[1] - zone[0] and font.size > 16:
            font = ImageFont.truetype(font.path, font.size - 2)
        d.text(((zone[0] + zone[1]) / 2, LH / 2 + 2), t, fill=(238, 232, 218) if light else (22, 20, 18), font=font, anchor='mm')
        if poster is not None:
            spine_stats['texte'] += 1
    d = ImageDraw.Draw(lab)
    if rng.random() < 0.6:                                     # étiquette du vidéoclub : code-barres
        x0 = LW - int(rng.integers(56, 70))
        d.rectangle([x0, 12, x0 + 40, LH - 12], fill=(232, 228, 214))
        for bx in range(x0 + 4, x0 + 37, 2):
            if rng.random() < 0.55:
                d.line([(bx, 18), (bx, LH - 22)], fill=(20, 20, 20), width=1)
    arr = np.asarray(lab.filter(ImageFilter.GaussianBlur(0.5))).astype(float)
    fade = rng.uniform(0.04, 0.28)                             # passées, inégalement
    g = arr.mean(axis=2, keepdims=True)
    arr = arr * (1 - 0.5 * fade) + g * 0.5 * fade
    arr = arr * (1 - 0.3 * fade) + np.array([150, 144, 130]) * 0.3 * fade
    arr *= (0.76 + 0.24 * fbm(LH, LW, 30, 100 + i))[..., None]  # crasse
    sc = scratches(LW, LH, int(rng.integers(5, 28)), 500 + i, length=(8, 160), alpha=(0.15, 0.55))[..., None]
    arr = arr * (1 - sc * 0.5) + 190 * sc * 0.5
    arr[:5] *= 0.25                                            # lèvres du boîtier
    arr[-5:] *= 0.25
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


atlas = Image.new('RGB', (LW, N * LH))
for i in range(N):
    tmdb_id, title, poster_url, logo_path = films[i % len(films)]
    atlas.paste(spine(tmdb_id, title, poster_url, logo_path, i), (0, i * LH))
atlas.save(T / 'tranches.png')
print('TRANCHES', N, 'tranches :', spine_stats, '| réseau :', NET, '| fichiers en cache :', len(list(CACHE.iterdir())))

# ----- bandeau : caisson lumineux usé (diffuseur, deux tubes, un bout noirci, crasse, insectes, une fêlure) -----
bw, bh = 2048, 300
yy = np.linspace(0, 1, bh)[:, None]
xx = np.linspace(0, 1, bw)[None, :]
base = Image.new('RGB', (bw, bh), (52, 18, 104))
d = ImageDraw.Draw(base)
font = ImageFont.truetype(fonts[0], 186)
txt = 'VIDÉOCLUB  ·  LOCATION K7'
d.text((bw / 2, bh / 2 + 10), txt, fill=(236, 226, 250), font=font, anchor='mm')
x_left = bw / 2 - d.textlength(txt, font=font) / 2
k_x0 = x_left + d.textlength(txt[:txt.index('K7')], font=font)       # le « K » de K7 s'éteint à moitié
k_x1 = k_x0 + d.textlength('K', font=font)
kmask_img = Image.new('L', (bw, bh), 0)
ImageDraw.Draw(kmask_img).text((bw / 2, bh / 2 + 10), txt, fill=255, font=font, anchor='mm')
base = base.filter(ImageFilter.GaussianBlur(2.2))                   # le diffuseur adoucit les bords
a = np.asarray(base).astype(float)
tubes = 0.45 + 0.42 * np.exp(-((yy - 0.32) / 0.16) ** 2) + 0.42 * np.exp(-((yy - 0.70) / 0.16) ** 2)
ends = 0.55 + 0.45 * np.sin(np.pi * np.clip(xx, 0.02, 0.98)) ** 0.6
blackened = 1 - 0.45 * np.clip((xx - 0.86) / 0.1, 0, 1) * np.exp(-((yy - 0.70) / 0.2) ** 2)
lum = tubes * ends * blackened
a *= lum[..., None]
col = (np.arange(bw)[None, :] >= k_x0 - 4) & (np.arange(bw)[None, :] <= k_x1 + 4)
kl = np.asarray(kmask_img.filter(ImageFilter.GaussianBlur(2.2))).astype(float) / 255 * col
a *= (1 - 0.55 * kl)[..., None]
a *= (0.72 + 0.28 * fbm(bh, bw, 160, 600))[..., None]
specks = Image.new('L', (bw, bh), 0)
ds = ImageDraw.Draw(specks)
for _ in range(70):                                                 # insectes morts au fond du caisson
    x = rng.uniform(0, bw)
    y = bh - abs(rng.normal(0, 30)) - 6
    r_ = rng.uniform(2, 6)
    ds.ellipse([x - r_, y - r_ * 0.6, x + r_, y + r_ * 0.6], fill=int(rng.uniform(120, 230)))
sp = np.asarray(specks.filter(ImageFilter.GaussianBlur(1.2))).astype(float)[..., None] / 255
a = a * (1 - sp * 0.85)
crack = Image.new('L', (bw, bh), 0)
dc = ImageDraw.Draw(crack)
pts, x, y = [], 1480.0, 0.0
while y < bh * 0.8:
    pts.append((x, y))
    x += rng.normal(-6, 14)
    y += rng.uniform(8, 22)
dc.line(pts, fill=255, width=2)
cr = np.asarray(crack.filter(ImageFilter.GaussianBlur(0.8))).astype(float)[..., None] / 255
a = a * (1 - cr * 0.7)
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(T / 'bandeau.png')


def worn_label(w, h, seed, fade=0.2):
    """Usure commune aux étiquettes plastiques : voile, crasse, rayures claires."""
    def apply(img):
        arr = np.asarray(img.convert('RGB')).astype(float)
        arr = arr * (1 - fade) + np.array([120, 118, 112]) * fade
        arr *= (0.78 + 0.22 * fbm(h, w, 40, seed))[..., None]
        sc = scratches(w, h, 50, seed + 1, length=(6, 90), alpha=(0.2, 0.7))[..., None]
        arr = arr * (1 - sc * 0.5) + 200 * sc * 0.5
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return apply


# ----- étiquette de la fente (le triangle est dessiné : la police n'a pas le glyphe ▼) -----
lw, lh = 600, 90
lab = Image.new('RGB', (lw, lh), (16, 16, 18))
d = ImageDraw.Draw(lab)
f58 = ImageFont.truetype(fonts[0], 58)
d.text((lw / 2 - 22, lh / 2 + 2), 'RETOUR DES K7', fill=(220, 220, 214), font=f58, anchor='mm')
tx = lw / 2 - 22 + d.textlength('RETOUR DES K7', font=f58) / 2 + 22
d.polygon([(tx, 30), (tx + 30, 30), (tx + 15, 58)], fill=(220, 220, 214))
worn_label(lw, lh, 700)(lab).save(T / 'etiquette-fente.png')

# ----- étiquette CB : logo de paiement + consigne -----
cw, ch = 900, 264
lab = Image.new('RGB', (cw, ch), (18, 18, 20))
logo = np.zeros((ch - 40, 300, 3))
gy, gx = np.mgrid[0:ch - 40, 0:300]
t_ = np.clip((gx / 300 * 0.6 + gy / (ch - 40) * 0.4), 0, 1)[..., None]
logo[:] = np.array([0, 72, 160]) * (1 - t_) + np.array([0, 150, 86]) * t_
logo_img = Image.fromarray(logo.astype(np.uint8))
lm = Image.new('L', logo_img.size, 0)
ImageDraw.Draw(lm).rounded_rectangle([0, 0, 299, ch - 41], radius=26, fill=255)
lab.paste(logo_img, (20, 20), lm)
d = ImageDraw.Draw(lab)
d.text((170, ch / 2 + 6), 'CB', fill=(250, 250, 250), font=ImageFont.truetype(fonts[1], 150), anchor='mm')
d.text((350, 78), 'PAIEMENT PAR', fill=(228, 228, 222), font=ImageFont.truetype(fonts[0], 70), anchor='lm')
d.text((350, 150), 'CARTE BANCAIRE', fill=(228, 228, 222), font=ImageFont.truetype(fonts[0], 70), anchor='lm')
d.text((350, 218), 'INSÉREZ VOTRE CARTE', fill=(170, 200, 120), font=ImageFont.truetype(fonts[0], 44), anchor='lm')
ax = 790
d.polygon([(ax, 196), (ax + 44, 196), (ax + 22, 236)], fill=(170, 200, 120))
worn_label(cw, ch, 710, fade=0.15)(lab).save(T / 'etiquette-cb.png')

# ----- touches du clavier en métal : légendes gravées, encre usée sur les touches les plus tapées -----
CELL = 256
legends = [('1', 'k'), ('2', 'k'), ('3', 'k'), ('ANNUL', 'r'),
           ('4', 'k'), ('5', 'k'), ('6', 'k'), ('CORR', 'y'),
           ('7', 'k'), ('8', 'k'), ('9', 'k'), ('', 'k'),
           ('*', 'k'), ('0', 'k'), ('#', 'k'), ('VALID', 'g')]
inks = {'k': (14, 14, 14), 'r': (200, 30, 26), 'y': (230, 180, 20), 'g': (24, 150, 60)}
worn_keys = {'1': 0.45, '0': 0.5, 'VALID': 0.55, '2': 0.75, '5': 0.7, 'ANNUL': 0.8}
keys = np.zeros((4 * CELL, 4 * CELL, 4))
for k, (txt_, ink) in enumerate(legends):
    r_, c_ = divmod(k, 4)
    cell = Image.new('L', (CELL, CELL), 0)
    dk = ImageDraw.Draw(cell)
    if len(txt_) == 1:
        dk.text((CELL / 2, CELL / 2 + 6), txt_, fill=255, font=ImageFont.truetype(fonts[2] if len(fonts) > 2 else fonts[0], 150), anchor='mm')
    elif txt_:
        dk.text((CELL / 2, CELL / 2 + 4), txt_, fill=255, font=ImageFont.truetype(fonts[0], 74), anchor='mm')
    if txt_ == '5':                                                  # repère tactile
        dk.ellipse([CELL / 2 - 9, CELL - 52, CELL / 2 + 9, CELL - 34], fill=255)
    m = np.asarray(cell.filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255
    keep = worn_keys.get(txt_, 0.95)
    m *= np.clip(keep + (1 - keep) * 1.6 * (fbm(CELL, CELL, 20, 800 + k) - 0.5) + (1 - keep) * 0.0, 0, 1) if keep < 0.95 else keep
    keys[r_ * CELL:(r_ + 1) * CELL, c_ * CELL:(c_ + 1) * CELL, :3] = inks[ink]
    keys[r_ * CELL:(r_ + 1) * CELL, c_ * CELL:(c_ + 1) * CELL, 3] = m * 255
Image.fromarray(keys.astype(np.uint8), 'RGBA').save(T / 'touches.png')

# ----- usure de la peinture sur les flancs (uniforme, discrète ; 1 m = 2048 px) -----
S = 2048
sc = scratches(S, S, 900, 7, length=(6, 140), alpha=(0.15, 0.7))
sc = np.maximum(sc, scratches(S, S, 60, 8, length=(60, 400), alpha=(0.1, 0.4)))
Image.fromarray((sc * 255).astype(np.uint8)).save(T / 'rayures.png')
streak = noise(S, S // 16, 6, 9)
streak = np.asarray(Image.fromarray((streak * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)).astype(float) / 255
streak = np.clip((streak - 0.45) * 2.5, 0, 1) * (0.5 + 0.5 * fbm(S, S, 200, 10))
Image.fromarray((streak * 255).astype(np.uint8)).save(T / 'coulures.png')
grime = fbm(S, S, 256, 11)
Image.fromarray((grime * 255).astype(np.uint8)).save(T / 'crasse.png')

# ----- usure LOCALISÉE de la façade : là où vont les mains, les clés et les cartes -----
# R = rayure profonde (le métal apparaît), G = éraflure claire de la peinture, B = gras des mains (poli).
F = json.loads((ICI / 'geometrie.json').read_text())['facade']
PXM = 2048                                                            # 2 px par mm : lisible en gros plan
FW, FH = round(1.05 * PXM), round(2.05 * PXM)
X, Z = np.meshgrid((np.arange(FW) + 0.5) / PXM - 0.525, 2.05 - (np.arange(FH) + 0.5) / PXM)


def rdist(r):
    x0, x1, z0, z1 = r
    dx = np.maximum(np.maximum(x0 - X, X - x1), 0)
    dz = np.maximum(np.maximum(z0 - Z, Z - z1), 0)
    return np.hypot(dx, dz)


def inside(r):
    return (X >= r[0]) & (X <= r[1]) & (Z >= r[2]) & (Z <= r[3])


d_scr = rdist(F['ecran'])
hand = (F['boitier'][0], F['boitier'][1], F['boitier'][2], F['ecran'][2])
near_slots = np.minimum(np.minimum(rdist(F['lecteur_cb']), rdist(F['fente'])), rdist(F['clavier']))
e = F['ecran']
low = 0.35 + 0.65 * np.clip((e[3] - Z) / (e[3] - e[2]), 0, 1)        # le bas de l'écran est plus touché que le haut
dens = 0.03 + 1.0 * np.exp(-(d_scr / 0.05) ** 2) * (d_scr > 0) * low * (0.3 + 1.4 * fbm(FH, FW, 60, 301))
dens += 0.18 * np.exp(-(rdist(hand) / 0.03) ** 2) * fbm(FH, FW, 90, 302)
dens += 1.2 * np.exp(-(rdist(F['lecteur_cb']) / 0.035) ** 2)
dens += 0.8 * np.exp(-(rdist(F['clavier']) / 0.03) ** 2)
dens += 0.9 * np.exp(-(rdist(F['fente']) / 0.04) ** 2)
dens += 0.28 * np.exp(-(Z / 0.22) ** 2)                               # coups de pied
dens += 0.16 * np.exp(-((0.525 - np.abs(X)) / 0.025) ** 2)            # arêtes verticales
dens *= 0.35 + 1.3 * fbm(FH, FW, 180, 300)                            # par plaques, pas en tapis
dens[inside(F['ecran'])] = 0
dens[inside(F['etiquette_cb'])] *= 0.5
dens[inside(F['lecteur_cb'])] *= 1.4                                   # le plastique du lecteur prend les ratés de carte
r2 = np.random.default_rng(31)


def sample(n, weight):
    p = (weight / weight.sum()).ravel()
    idx = r2.choice(p.size, size=n, p=p)
    yy_, xx_ = np.divmod(idx, FW)
    return xx_ + r2.random(n), yy_ + r2.random(n)


def draw(img, n, weight, med_len_m, sigma, widths, alpha, curve):
    d_ = ImageDraw.Draw(img)
    xs, ys = sample(n, weight)
    for x, y in zip(xs, ys):
        xi, yi = min(int(x), FW - 1), min(int(y), FH - 1)
        if near_slots[yi, xi] < 0.05 and r2.random() < 0.7:
            ang = r2.normal(0, 0.35) + (np.pi if r2.random() < 0.5 else 0)   # les ratés de carte et de K7 : horizontaux
        else:
            ang = r2.uniform(0, 2 * np.pi)
        L = np.exp(np.log(med_len_m * PXM) + r2.normal(0, sigma))
        segs = max(2, int(L / 12))
        pts = [(x, y)]
        bend = r2.normal(0, curve)
        for _s in range(segs):
            ang += bend / segs + r2.normal(0, curve * 0.3)
            x += np.cos(ang) * L / segs
            y += np.sin(ang) * L / segs
            pts.append((x, y))
        d_.line(pts, fill=int(255 * r2.uniform(*alpha)), width=int(r2.choice(widths)))


deep = Image.new('L', (FW, FH), 0)
draw(deep, 1100, dens, 0.012, 0.6, [1, 1, 1, 2], (0.35, 0.9), 0.08)           # fines, courtes
draw(deep, 140, dens, 0.05, 0.5, [1, 1, 2], (0.5, 1.0), 0.35)                 # coups de clé en arc
draw(deep, 6, np.sqrt(dens), 0.2, 0.35, [2, 3], (0.7, 1.0), 0.12)             # quelques balafres longues
reader = np.exp(-(rdist(F['lecteur_cb']) / 0.004) ** 2)               # le lecteur lui-même : ratés de carte
draw(deep, 220, reader, 0.012, 0.5, [1, 1, 2], (0.5, 1.0), 0.05)
scuff = Image.new('L', (FW, FH), 0)
draw(scuff, 700, reader, 0.008, 0.6, [1, 2], (0.3, 0.8), 0.05)
draw(scuff, 4200, dens, 0.008, 0.7, [1, 1, 2], (0.2, 0.7), 0.15)
R_ = np.asarray(deep.filter(ImageFilter.GaussianBlur(0.5))).astype(float) / 255
G_ = np.asarray(scuff.filter(ImageFilter.GaussianBlur(0.7))).astype(float) / 255
rub = np.exp(-(rdist(F['clavier']) / 0.03) ** 2) * 0.7 + np.exp(-(rdist(F['lecteur_cb']) / 0.025) ** 2) * 0.6 \
    + np.exp(-(d_scr / 0.02) ** 2) * (d_scr > 0) * low * 0.35
rub = np.clip(rub, 0, 1) * np.clip(fbm(FH, FW, 50, 303) * 1.6 - 0.2, 0, 1)
G_ = np.clip(G_ + 0.18 * rub * fbm(FH, FW, 40, 310) + 0.2 * np.exp(-(Z / 0.12) ** 2) * fbm(FH, FW, 30, 311), 0, 1)
B_ = np.clip(rub * (0.4 + 0.8 * fbm(FH, FW, 60, 320)), 0, 1)
B_[inside(F['ecran'])] = 0
Image.fromarray((np.dstack([R_, G_, B_]) * 255).astype(np.uint8), 'RGB').save(T / 'usure-facade.png')
# ----- afficheur fluorescent 2 × 20 caractères, au repos (matrices 5 × 7) -----
GLYPHS = {
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
}
DOT, VCOLS, VROWS = 8, 128, 25
lit = np.zeros((VROWS, VCOLS), bool)
cells = np.zeros((VROWS, VCOLS), bool)
for li, text in enumerate(['RETRAIT / RETOUR', 'DES K7']):
    for ci, ch in enumerate(text.center(20)):
        gx, gy = 4 + ci * 6, 4 + li * 10
        cells[gy:gy + 7, gx:gx + 5] = True
        for r_, bits in enumerate(GLYPHS.get(ch, [])):
            for c_, b_ in enumerate(bits):
                lit[gy + r_, gx + c_] = b_ == '1'
up = lambda m: np.kron(m, np.ones((DOT, DOT), bool))  # noqa: E731
yy, xx = np.mgrid[0:VROWS * DOT, 0:VCOLS * DOT]
disk = ((xx % DOT - (DOT - 1) / 2) ** 2 + (yy % DOT - (DOT - 1) / 2) ** 2) <= (DOT * 0.41) ** 2
vfd = np.zeros((VROWS * DOT, VCOLS * DOT, 3))
vfd[:] = (5, 12, 11)                                            # verre fumé
vfd[up(cells) & disk] = (9, 26, 23)                             # points éteints, à peine visibles
aging = 0.62 + 0.38 * fbm(VROWS * DOT, VCOLS * DOT, 90, 820)    # vieux tube : des zones plus faibles
on = (up(lit) & disk)[..., None] * np.array([105.0, 255.0, 214.0]) * aging[..., None]
glow = np.asarray(Image.fromarray(np.clip(on, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(float)
vfd = np.clip(vfd + on + glow * 0.55, 0, 255)
Image.fromarray(vfd.astype(np.uint8)).save(T / 'afficheur.png')

# ----- repères de case du casier (A1 … H13) : petites étiquettes jaunies -----
RC, RR, CW_, CH_ = 13, 8, 96, 32
rep = Image.new('RGB', (RC * CW_, RR * CH_), (222, 216, 196))
dr = ImageDraw.Draw(rep)
frep = ImageFont.truetype(fonts[0], 26)
for r_ in range(RR):
    for c_ in range(RC):
        dr.rectangle([c_ * CW_, r_ * CH_, (c_ + 1) * CW_ - 1, (r_ + 1) * CH_ - 1], outline=(120, 116, 104))
        dr.text((c_ * CW_ + CW_ / 2, r_ * CH_ + CH_ / 2 + 2), f'{"ABCDEFGH"[r_]}{c_ + 1}', fill=(26, 24, 22), font=frep, anchor='mm')
arr = np.asarray(rep).astype(float) * (0.72 + 0.28 * fbm(RR * CH_, RC * CW_, 60, 830))[..., None]
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(T / 'reperes.png')
print('textures :', sorted(p_.name for p_ in T.iterdir()))
