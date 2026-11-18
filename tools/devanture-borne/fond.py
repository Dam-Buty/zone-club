"""Devanture mobile avec la borne : le fond de la vue reculée (sans la borne).

Photo mobile réduite et calée à droite, mur reconstitué à gauche et à la place de l'ancienne
enseigne, enseigne VIDEOCLUB déplacée et agrandie au-dessus de l'ensemble porte + borne, arête du
toit, ciel de pluie avec la lune. Écrit travail/fond.png et travail/repere.json (positions utiles à la scène 3D).

Usage : python3 fond.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ICI = Path(__file__).resolve().parent
D = ICI / 'travail'                 # tout l'intermédiaire (ignoré par git)
D.mkdir(exist_ok=True)
G = json.loads((ICI / 'geometrie.json').read_text())
W, H, PPM = G['sortie']['w'], G['sortie']['h'], G['sortie']['px_par_m']
rng = np.random.default_rng(1984)

photo = Image.open(ICI / 'sources' / G['photo']['fichier']).convert('RGB')
k = PPM / G['photo']['px_par_m']
pw, ph = round(photo.width * k), round(photo.height * k)
x0, y0 = W - pw + G['photo'].get('decalage_px', 0), H - ph
vis = min(pw, W - x0)   # largeur de la photo restée dans le cadre

# Hauteur réelle d'une ligne de la sortie (mètres au-dessus du sol).
bar_out = y0 + G['photo']['barre_de_poussee_px'] * k
ground_y = bar_out + G['photo']['hauteur_barre_m'] * PPM
def y_of(h_m):
    return ground_y - h_m * PPM

door_l = x0 + G['photo']['cadre_porte_px'][0] * k
door_r = x0 + G['photo']['cadre_porte_px'][1] * k
door_c = (door_l + door_r) / 2
B = G['borne']
kiosk_r = door_l - B['ecart_porte_m'] * PPM
kiosk_l = kiosk_r - B['largeur_m'] * PPM


def value_noise(h, w, scale, octaves=4, seed=0):
    """Bruit fractal lisse, de 0 à 1."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale / (2 ** o)))
        gh, gw = h // s + 2, w // s + 2
        grid = r.random((gh, gw))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((gw * s, gh * s), Image.BICUBIC)
        out += amp * (np.asarray(img).astype(float)[:h, :w] / 255)
        total += amp
        amp *= 0.5
    return out / total


def wall(h, w, seed):
    """Mur peint bleu nuit : couleur moyenne et grain relevés sur la photo (RVB 7,6 / 12,8 / 25,6)."""
    base = np.array([7.6, 12.8, 25.6])
    low = value_noise(h, w, 260, 3, seed)[..., None]
    grain = rng.normal(0, 1.3, (h, w, 1))
    return np.clip(base * (0.85 + 0.3 * low) + grain, 0, 255)


def rain(h, w, density, seed, length=(10, 34), alpha=(0.05, 0.22)):
    """Traînées de pluie claires, presque verticales, comme sur la photo."""
    r = np.random.default_rng(seed)
    layer = Image.new('L', (w, h), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(layer)
    for _ in range(int(w * h * density)):
        x, y = r.random() * w, r.random() * h
        L = r.uniform(*length)
        dx = L * 0.06
        a = int(255 * r.uniform(*alpha))
        d.line([(x, y), (x + dx, y + L)], fill=a, width=1)
    return np.asarray(layer.filter(ImageFilter.GaussianBlur(0.6))).astype(float)[..., None] / 255


canvas = wall(H, W, 7)
# Pluie sur le mur reconstitué (la photo a déjà la sienne).
canvas = canvas + rain(H, W, 0.00016, 11) * np.array([150, 165, 190])

# La photo, avec un fondu de 90 px sur sa bande de mur à gauche.
P = np.asarray(photo.resize((pw, ph), Image.LANCZOS)).astype(float)
ramp = np.clip((np.arange(pw) - 4) / 90, 0, 1)[None, :, None]
region = canvas[y0:y0 + ph, x0:x0 + vis]
canvas[y0:y0 + ph, x0:x0 + vis] = region * (1 - ramp[:, :vis]) + P[:, :vis] * ramp[:, :vis]

# L'ancienne enseigne : effacée (mur reconstitué), puis reposée plus grande au centre de l'ensemble.
e0, e1 = G['enseigne']['lignes_photo']
src = np.asarray(photo.crop((0, e0, photo.width, e1))).astype(float)
wall_mean = np.array([7.6, 12.8, 25.6])
light = np.clip(src - wall_mean, 0, None)
ry0, ry1 = int(y0 + e0 * k), int(y0 + e1 * k)
fade = np.ones((ry1 - ry0, 1, 1))
f = 40
fade[:f, 0, 0] = np.linspace(0, 1, f)
fade[-f:, 0, 0] = np.linspace(1, 0, f)
canvas[ry0:ry1, x0:x0 + vis] = canvas[ry0:ry1, x0:x0 + vis] * (1 - fade) + wall(ry1 - ry0, vis, 21) * fade
s = k * G['enseigne']['agrandissement']
lw, lh = round(src.shape[1] * s), round(src.shape[0] * s)
L = np.asarray(Image.fromarray(np.clip(light, 0, 255).astype(np.uint8)).resize((lw, lh), Image.LANCZOS)).astype(float)
center_x = (kiosk_l + door_r) / 2
center_y = y0 + (e0 + e1) / 2 * k
lx0, ly0 = int(center_x - lw / 2), int(center_y - lh / 2)
cx0, cy0 = max(0, lx0), max(0, ly0)
cx1, cy1 = min(W, lx0 + lw), min(H, ly0 + lh)
canvas[cy0:cy1, cx0:cx1] += L[cy0 - ly0:cy1 - ly0, cx0 - lx0:cx1 - lx0]

# Le rebord de façade au-dessus de la porte (photo, lignes ~670-800) court sur tout le mur : son
# profil vertical, relevé sur la bande de mur à gauche de la porte, est reporté à gauche de la photo.
# Au-dessus du rebord, l'éclaircissement vient de l'enseigne : il suit son étendue ; l'ombre sous le
# rebord, elle, est partout.
pa = np.asarray(photo).astype(float)
r0, r1 = 640, 830
prof = pa[r0:r1, 30:230].mean(axis=1)                    # (lignes, RVB)
ref = pa[800:860, 30:230].reshape(-1, 3).mean(axis=0)    # mur ordinaire sous le rebord
mult = prof / ref                                        # > 1 éclairé, < 1 ombre
oy0 = int(y0 + r0 * k)
rows = int((r1 - r0) * k)
mult_o = np.asarray(Image.fromarray((np.clip(mult, 0, 4) * 60).astype(np.uint8)[:, None, :].repeat(4, axis=1)).resize((4, rows), Image.BICUBIC)).astype(float)[:, :1, :] / 60
xs = np.arange(W)
sign_l = center_x - lw / 2
hx = np.clip((xs - (sign_l - 160)) / 160, 0, 1)          # éclairage : estompé au-delà de l'enseigne
blend = np.clip((x0 + 70 - xs) / 70, 0, 1)               # seulement à gauche de la photo, fondu de 70 px
for i in range(rows):
    m = mult_o[i, 0]
    light = np.where(m > 1, 1 + (m - 1) * hx[:, None], m)  # (W, 3)
    row = canvas[oy0 + i]
    canvas[oy0 + i] = row * (1 - blend[:, None]) + row * light * blend[:, None]

# Arête du toit et ciel de pluie avec la lune.
roof_y = int(y_of(G['toit_m']))
sky_h = roof_y
yy = np.linspace(0, 1, sky_h)[:, None, None]
sky = np.array([2, 4, 12]) * (1 - yy) + np.array([10, 14, 30]) * yy
clouds = value_noise(sky_h, W, 420, 5, 3)[..., None]
clouds = np.clip((clouds - 0.38) * 2.2, 0, 1)
moon_x, moon_y, moon_r = W * 0.72, sky_h * 0.26, 46
gy, gx = np.mgrid[0:sky_h, 0:W]
dist = np.sqrt((gx - moon_x) ** 2 + (gy - moon_y) ** 2)[..., None]
glow = np.exp(-dist / 260) * 0.9 + np.exp(-dist / 70) * 0.6
cloud_col = np.array([28, 34, 58]) + glow * np.array([120, 125, 145])
sky = sky * (1 - clouds) + cloud_col * clouds
disk = np.clip((moon_r - dist) / 2.0, 0, 1)
moon_tex = 205 + 25 * value_noise(sky_h, W, 18, 3, 5)[..., None]
veil = np.clip(clouds * 1.4, 0, 0.85)
sky = sky * (1 - disk * (1 - veil)) + moon_tex * np.array([0.93, 0.95, 1.0]) * disk * (1 - veil)
sky = sky + glow * np.array([30, 32, 42]) * (1 - clouds * 0.5)
sky = sky + rng.normal(0, 1.2, sky.shape) + rain(sky_h, W, 0.00012, 13) * np.array([120, 130, 160])
canvas[:sky_h] = sky
# L'arête : un couronnement métallique sombre, son bord supérieur pris par la lune.
edge = 18
canvas[roof_y:roof_y + edge] = np.array([14, 17, 28]) + rng.normal(0, 1.2, (edge, W, 3))
canvas[roof_y:roof_y + 2] += np.array([40, 44, 60])
canvas[roof_y + edge:roof_y + edge + 10] *= np.linspace(0.55, 1, 10)[:, None, None]

out = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
out.save(D / 'fond.png')
repere = {
    'ground_y': ground_y, 'door_left_x': door_l, 'door_right_x': door_r, 'door_center_x': door_c,
    'kiosk_left_x': kiosk_l, 'kiosk_right_x': kiosk_r, 'roof_y': roof_y, 'photo_x0': x0, 'photo_y0': y0,
    'sign_center_x': center_x, 'sign_center_y': center_y, 'sign_w': lw,
}
(D / 'repere.json').write_text(json.dumps(repere, indent=1))
print(json.dumps({k: round(v, 1) for k, v in repere.items()}))
