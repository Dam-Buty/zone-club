"""Graphe des traits de l'enseigne : squelette du texte → nœuds (bouts, embranchements) et arêtes (traits).

Sert à neon.py, qui en tire un parcours de tube fabricable. Lancé seul, il décrit le graphe et écrit une image
de contrôle :  python3 neon_graphe.py [<image de contrôle>]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi


def masque(E):
    font = ImageFont.truetype(E['police'], 560, index=E.get('police_index', 0))
    TEXT = E['texte']
    PAD = 70
    cuts = sorted((int(k), v) for k, v in E.get('ecarts', {}).items())
    bounds = [0] + [c for c, _ in cuts] + [len(TEXT)]
    big = Image.new('L', (int(font.getlength(TEXT)) + 900, 1100), 0)
    draw = ImageDraw.Draw(big)
    shift = 0.0
    for i, (a, b_) in enumerate(zip(bounds, bounds[1:])):
        if i > 0:
            shift += cuts[i - 1][1] * font.size
        draw.text((300 + font.getlength(TEXT[:a]) + shift, 250), TEXT[a:b_], font=font, fill=255)
    l, t, r, b = big.getbbox()
    img = Image.new('L', (r - l + 2 * PAD, b - t + 2 * PAD), 0)
    img.paste(big.crop((l, t, r, b)), (PAD, PAD))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(3))) > 127


def amincir(im):
    """Amincissement de Zhang-Suen."""
    im = im.astype(np.uint8).copy()
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            P = np.pad(im, 1)
            p2, p3, p4, p5 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:]
            p6, p7, p8, p9 = P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            c = ((p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)) if step == 0 else ((p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0))
            rm = (im == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                im[rm] = 0
                changed = True
    return im.astype(bool)


def graphe(E):
    """Rend (noeuds, aretes, demi_epaisseur, masque). noeuds : [x, y] en pixels ; aretes : {a, b, pts} où pts est la
    polyligne (x, y) de a vers b, extrémités posées sur les nœuds."""
    mask = masque(E)
    half = float(ndi.distance_transform_edt(mask).max())
    pts = {(int(y), int(x)) for y, x in zip(*np.nonzero(amincir(mask)))}

    def nbrs(p):
        y, x = p
        out = [(y + dy, x + dx) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)) if (y + dy, x + dx) in pts]
        for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            if (y + dy, x + dx) in pts and (y + dy, x) not in pts and (y, x + dx) not in pts:
                out.append((y + dy, x + dx))
        return out

    def trace():
        deg = {p: len(nbrs(p)) for p in pts}
        nodes = {p for p, d_ in deg.items() if d_ != 2}
        seen, paths = set(), []
        for n in nodes:
            for q in nbrs(n):
                if (n, q) in seen:
                    continue
                path, prev, cur = [n, q], n, q
                seen.update({(n, q), (q, n)})
                while cur not in nodes:
                    nxt = next(x for x in nbrs(cur) if x != prev)
                    seen.update({(cur, nxt), (nxt, cur)})
                    path.append(nxt)
                    prev, cur = cur, nxt
                paths.append(path)
        used = {p for path in paths for p in path}
        for p in sorted(pts - used):
            if p in used:
                continue
            path, prev, cur = [p], None, p
            while True:
                nx = [x for x in nbrs(cur) if x != prev and x not in path[1:]]
                if not nx or nx[0] == p:
                    break
                prev, cur = cur, nx[0]
                path.append(cur)
            used.update(path)
            if len(path) > 8:
                paths.append(path + [p])               # boucle sans nœud : fermée sur son point de départ
        return paths, deg

    # Barbes : un tracé court entre un bout libre et un embranchement n'est pas un trait de la lettre.
    while True:
        paths, deg = trace()
        spurs = [p for p in paths if p[0] != p[-1] and len(p) < 1.25 * half and ((deg[p[0]] == 1) != (deg[p[-1]] == 1))]
        if not spurs:
            break
        for p in spurs:
            pts.difference_update(p[:-1] if deg[p[0]] == 1 else p[1:])
    paths, deg = trace()

    # Les embranchements sont des paquets de pixels : on fond les nœuds reliés par un tracé très court.
    ends = sorted({p[0] for p in paths} | {p[-1] for p in paths})
    parent = {n: n for n in ends}

    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n
    court = 0.55 * half
    for p in paths:
        if p[0] != p[-1] and len(p) < court and deg[p[0]] >= 3 and deg[p[-1]] >= 3:
            parent[find(p[0])] = find(p[-1])
    groups = {}
    for n in ends:
        groups.setdefault(find(n), []).append(n)
    ids = {root: i for i, root in enumerate(sorted(groups))}
    noeuds = [None] * len(ids)
    for root, members in groups.items():
        a = np.array(members, float)
        noeuds[ids[root]] = [float(a[:, 1].mean()), float(a[:, 0].mean())]
    aretes = []
    for p in paths:
        a, b = ids[find(p[0])], ids[find(p[-1])]
        if a == b and len(p) < court:
            continue                                   # tracé interne à un paquet
        poly = [noeuds[a]] + [[float(x), float(y)] for y, x in p[1:-1]] + [noeuds[b]]
        aretes.append({'a': a, 'b': b, 'pts': poly})
    return noeuds, aretes, half, mask


def composantes(noeuds, aretes):
    parent = list(range(len(noeuds)))

    def find(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n
    for e in aretes:
        parent[find(e['a'])] = find(e['b'])
    comps = {}
    for i, e in enumerate(aretes):
        comps.setdefault(find(e['a']), []).append(i)
    return sorted(comps.values(), key=lambda ids: min(min(p[0] for p in aretes[i]['pts']) for i in ids))


if __name__ == '__main__':
    E = json.loads((Path(__file__).resolve().parent / 'geometrie.json').read_text())['enseigne_borne']
    noeuds, aretes, half, mask = graphe(E)
    degre = [0] * len(noeuds)
    for e in aretes:
        degre[e['a']] += 1
        degre[e['b']] += 1
    comps = composantes(noeuds, aretes)
    print('GRAPHE', len(noeuds), 'nœuds,', len(aretes), 'arêtes,', len(comps), 'composantes ; demi-épaisseur', round(half, 1), 'px')
    for ci, ids in enumerate(comps):
        ns = sorted({aretes[i]['a'] for i in ids} | {aretes[i]['b'] for i in ids})
        print(f'  composante {ci} : nœuds', [(n, degre[n]) for n in ns], '| arêtes', [(i, aretes[i]['a'], aretes[i]['b'], len(aretes[i]['pts'])) for i in ids])
    if len(sys.argv) > 1:
        img = Image.fromarray((mask * 60).astype(np.uint8)).convert('RGB')
        d = ImageDraw.Draw(img)
        f = ImageFont.truetype('/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', 30)
        rng = np.random.default_rng(3)
        for i, e in enumerate(aretes):
            col = tuple(int(v) for v in rng.integers(110, 255, 3))
            d.line([tuple(p) for p in e['pts']], fill=col, width=5)
            mid = e['pts'][len(e['pts']) // 2]
            d.text((mid[0] + 6, mid[1] - 14), 'a' + str(i), fill=col, font=f)
        for n, (x, y) in enumerate(noeuds):
            d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 255, 255))
            d.text((x + 10, y + 4), f'{n}/{degre[n]}', fill=(255, 255, 90), font=f)
        img.save(sys.argv[1])
