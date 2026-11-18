"""Trace les tubes de l'enseigne néon de la borne (« Borne 24/7 ») comme un verrier les cintrerait.

Un néon n'est pas un dessin de lettres : c'est un tube de verre CONTINU, parcouru par le courant d'une électrode à
l'autre. Il ne peut ni bifurquer ni s'arrêter en cul-de-sac. D'où les règles du métier, appliquées ici :

  - une « unité » (un tube) par mot : « Borne », puis « 24/7 », branchées en série ;
  - dans une unité, toutes les lettres sont parcourues d'UN SEUL trait. Entre deux lettres le tube continue, replié
    derrière et peint en noir (« occulté ») : il n'y a jamais de vide ;
  - là où le tracé doit repasser sur un trait déjà posé, le second passage se fait DERRIÈRE le premier, occulté ;
  - là où deux traits se croisent, celui qui arrive en second plonge derrière l'autre ;
  - aux deux bouts de l'unité, le tube se coude vers le mur et finit par une électrode (verre nu, éteint), coiffée
    d'un capuchon d'où part le fil haute tension.

Le texte est dessiné avec la police, aminci jusqu'à son squelette (neon_graphe.py), simplifié en graphe de traits,
puis chaque lettre reçoit son itinéraire : le plus court qui couvre tous ses traits (problème du postier chinois).

Usage : python3 neon.py   → travail/neon-borne.json (mètres) et travail/neon-axe.png (contrôle)
Points : [x, z, d] — x vers la droite, z vers le haut (origine au centre du texte), d = recul vers le mur depuis le
plan de face. Étiquettes, une lettre par point : L = allumé, N = occulté (peint en noir), E = électrode.
"""
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter1d

sys.path.insert(0, str(Path(__file__).resolve().parent))
from neon_graphe import composantes, graphe  # noqa: E402

from variante import D, G  # noqa: E402 — la variante en cours

E = G['enseigne_borne']
DIAM = E['tube_diam_m']
ENTRAXE = DIAM + 0.0015               # entre le plan de face et le plan arrière
FACE = E.get('face_m', 0.046)         # du mur à l'axe des tubes de face (supports de tube courants : 44 mm)
PAS = 0.0015
ESQUIVE = 1.3 * DIAM                  # demi-longueur d'un passage derrière, à un croisement

noeuds_px, aretes, half, mask = graphe(E)
allp = np.array([p for e in aretes for p in e['pts']])
xmin, xmax, ymin, ymax = allp[:, 0].min(), allp[:, 0].max(), allp[:, 1].min(), allp[:, 1].max()
M = E['largeur_texte_m'] / (xmax - xmin)               # mètres par pixel
cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
noeuds = [np.array([(x - cx) * M, (cy - y) * M]) for x, y in noeuds_px]
for e in aretes:
    e['pts'] = np.array([[(x - cx) * M, (cy - y) * M] for x, y in e['pts']])


def longueur(p):
    return float(np.hypot(*np.diff(p, axis=0).T).sum())


def reech(p, pas=PAS, n=None):
    """Rééchantillonne une polyligne à pas constant."""
    p = np.asarray(p, float)
    keep = np.concatenate([[True], np.hypot(*np.diff(p, axis=0).T) > 1e-9])
    p = p[keep]
    s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    if n is None:
        n = max(2, int(round(s[-1] / pas)) + 1)
    t = np.linspace(0.0, s[-1], n)
    return np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])


def lisse(p, sigma_m):
    """Adoucit une polyligne (le verre ne fait pas d'angle vif) sans déplacer ses extrémités."""
    k = sigma_m / PAS
    q = np.column_stack([gaussian_filter1d(p[:, i], k, mode='nearest') for i in (0, 1)])
    n = len(p)
    w = np.clip(np.minimum(np.arange(n), n - 1 - np.arange(n)) / (3 * k), 0, 1)[:, None]
    return q * w + p * (1 - w)


def degres():
    d = [0] * len(noeuds)
    for e in aretes:
        d[e['a']] += 1
        d[e['b']] += 1
    return d


# ---------- 1. Simplifier le graphe : ce qu'une police dessine et qu'un tube ne peut pas faire ----------
journal = []
# a) deux traits courts entre les mêmes nœuds (l'œil d'un plein) : un seul trait, leur milieu.
changed = True
while changed:
    changed = False
    for i, j in itertools.combinations(range(len(aretes)), 2):
        ei, ej = aretes[i], aretes[j]
        if ei['a'] != ei['b'] and {ei['a'], ei['b']} == {ej['a'], ej['b']} and max(longueur(ei['pts']), longueur(ej['pts'])) < 0.06:
            pj = ej['pts'] if ej['a'] == ei['a'] else ej['pts'][::-1]
            ei['pts'] = (reech(ei['pts'], n=40) + reech(pj, n=40)) / 2
            del aretes[j]
            journal.append('œil fondu en un trait')
            changed = True
            break
# a') deux embranchements plus proches que l'épaisseur d'un tube n'en font qu'un (la taille du « R ») : le tube
#     n'irait pas faire un aller-retour d'un centimètre.
changed = True
while changed:
    changed = False
    d = degres()
    for i, e in enumerate(aretes):
        if e['a'] != e['b'] and d[e['a']] >= 3 and d[e['b']] >= 3 and longueur(e['pts']) < 1.2 * DIAM:
            garde, ote = e['a'], e['b']
            noeuds[garde] = (noeuds[garde] + noeuds[ote]) / 2
            del aretes[i]
            for f in aretes:
                if f['a'] == ote:
                    f['a'] = garde
                if f['b'] == ote:
                    f['b'] = garde
                if f['a'] == garde:
                    f['pts'][0] = noeuds[garde]
                if f['b'] == garde:
                    f['pts'][-1] = noeuds[garde]
            journal.append('embranchements voisins fondus')
            changed = True
            break
# b) les barbes de moins de 2,2 cm (empattements) : un tube n'y irait pas faire demi-tour. Au-delà, c'est un vrai
#    trait (le haut du jambage du « N ») : le tube y monte et en revient par derrière.
changed = True
while changed:
    changed = False
    d = degres()
    for i, e in enumerate(aretes):
        if e['a'] != e['b'] and (d[e['a']] == 1 or d[e['b']] == 1) and longueur(e['pts']) < 0.022:
            del aretes[i]
            journal.append('empattement retiré')
            changed = True
            break
# c) un nœud qui ne relie plus que deux traits n'en est plus un : les deux traits n'en font qu'un.
changed = True
while changed:
    changed = False
    d = degres()
    for n in range(len(noeuds)):
        inc = [i for i, e in enumerate(aretes) if n in (e['a'], e['b'])]
        if d[n] == 2 and len(inc) == 2:
            e1, e2 = aretes[inc[0]], aretes[inc[1]]
            p1 = e1['pts'] if e1['b'] == n else e1['pts'][::-1]
            p2 = e2['pts'] if e2['a'] == n else e2['pts'][::-1]
            a = e1['a'] if e1['b'] == n else e1['b']
            b = e2['b'] if e2['a'] == n else e2['a']
            aretes[inc[0]] = {'a': a, 'b': b, 'pts': np.vstack([p1, p2[1:]])}
            del aretes[inc[1]]
            changed = True
            break
for e in aretes:
    e['pts'] = lisse(reech(e['pts']), 0.003)
    e['len'] = longueur(e['pts'])


# ---------- 2. L'itinéraire d'une lettre : couvrir tous ses traits d'un seul tenant ----------
def plus_courts(ids):
    ns = sorted({aretes[i]['a'] for i in ids} | {aretes[i]['b'] for i in ids})
    dist = {u: {v: (0.0 if u == v else math.inf) for v in ns} for u in ns}
    via = {u: {v: [] for v in ns} for u in ns}
    for i in ids:
        e = aretes[i]
        if e['a'] != e['b'] and e['len'] < dist[e['a']][e['b']]:
            dist[e['a']][e['b']] = dist[e['b']][e['a']] = e['len']
            via[e['a']][e['b']] = via[e['b']][e['a']] = [i]
    for k in ns:
        for u in ns:
            for v in ns:
                if dist[u][k] + dist[k][v] < dist[u][v]:
                    dist[u][v] = dist[u][k] + dist[k][v]
                    via[u][v] = via[u][k] + via[k][v]
    return ns, dist, via


def couplage(rest, dist):
    """Apparie les nœuds impairs restants au moindre coût (traits à doubler)."""
    if not rest:
        return 0.0, []
    u, best = rest[0], (math.inf, None)
    for v in rest[1:]:
        c, pairs = couplage([w for w in rest[1:] if w != v], dist)
        if dist[u][v] + c < best[0]:
            best = (dist[u][v] + c, [(u, v)] + pairs)
    return best


def parcours(ids, depart, doubles):
    """Suit tous les traits d'un seul tenant (Fleury), en allant tout droit quand c'est possible."""
    inst = list(ids) + list(doubles)
    used = [False] * len(inst)

    def reste_joignable(k, dest):
        rem = [j for j in range(len(inst)) if not used[j] and j != k]
        seen, grew = {dest}, True
        while grew:
            grew = False
            for j in rem:
                e = aretes[inst[j]]
                if (e['a'] in seen) != (e['b'] in seen):
                    seen |= {e['a'], e['b']}
                    grew = True
        return all(aretes[inst[j]]['a'] in seen for j in rem)

    trail, node, direction, fois = [], depart, None, {}
    while not all(used):
        choix = []
        for k, i in enumerate(inst):
            if used[k]:
                continue
            e = aretes[i]
            sens = (True, False) if e['a'] == e['b'] == node else (True,) if e['a'] == node else (False,) if e['b'] == node else ()
            for fwd in sens:
                pts = e['pts'] if fwd else e['pts'][::-1]
                v = pts[min(len(pts) - 1, 8)] - pts[0]
                v = v / (np.linalg.norm(v) + 1e-12)
                dest = e['b'] if fwd else e['a']
                choix.append((reste_joignable(k, dest), float(v @ direction) if direction is not None else 0.0, k, dest, pts))
        _, _, k, dest, pts = max(choix, key=lambda c: (c[0], c[1]))
        used[k] = True
        fois[inst[k]] = fois.get(inst[k], 0) + 1
        trail.append({'eid': inst[k], 'pts': pts, 'second': fois[inst[k]] == 2, 'de': node, 'vers': dest})
        w = pts[-1] - pts[max(0, len(pts) - 9)]
        direction = w / (np.linalg.norm(w) + 1e-12)
        node = dest
    return trail


def itineraire(ids, arrivee, suivant, premier):
    """Choisit par où entrer dans la lettre et par où en sortir, puis rend le parcours.
    arrivee : où finit la lettre précédente ; suivant : vers où il faudra repartir ; premier : première de l'unité."""
    ns, dist, via = plus_courts(ids)
    deg = {n: 0 for n in ns}
    for i in ids:
        deg[aretes[i]['a']] += 1
        deg[aretes[i]['b']] += 1
    if len(ids) == 1 and aretes[ids[0]]['a'] == aretes[ids[0]]['b'] and deg[ns[0]] == 2:
        # Un anneau (le « o ») : il s'ouvre au point le plus commode pour arriver et repartir.
        e = aretes[ids[0]]
        p = e['pts'][:-1]
        k = int(np.hypot(*(p - arrivee).T).argmin()) if arrivee is not None else int(p[:, 0].argmin())
        tour = np.vstack([p[k:], p[:k + 1]])
        trail = [{'eid': ids[0], 'pts': tour, 'second': False, 'de': e['a'], 'vers': e['a'], 'anneau': True}]
        if suivant is not None:
            # La sortie se fait au point de l'anneau le plus proche de la lettre suivante : le tube y va en
            # repassant DERRIÈRE l'anneau allumé (occulté), par le plus court des deux sens.
            ks = int(np.hypot(*(tour[:-1] - suivant).T).argmin())
            if ks > len(tour) // 2:
                tour = tour[::-1]
                trail[0]['pts'] = tour
                ks = len(tour) - 1 - ks
            if ks > 2:
                trail.append({'eid': ids[0], 'pts': tour[:ks + 1], 'second': True, 'de': e['a'], 'vers': None, 'anneau': True})
        noeuds[e['a']] = tour[0].copy()
        return trail, 0.0
    impairs = [n for n in ns if deg[n] % 2]
    xs_ = [noeuds[n][0] for n in ns]
    best = None
    for s, t in (itertools.permutations(impairs, 2) if impairs else [(n, n) for n in ns]):
        c, pairs = couplage([n for n in impairs if n not in (s, t)], dist)
        cost = c
        cost += 0.6 * float(np.hypot(*(noeuds[s] - arrivee))) if arrivee is not None else 0.0
        cost += 0.3 * (noeuds[s][0] - min(xs_)) if premier else 0.0
        cost += 0.3 * float(np.hypot(*(noeuds[t] - suivant))) if suivant is not None else -0.05 * noeuds[t][0]
        if best is None or cost < best[0]:
            best = (cost, s, pairs, c)
    _, s, pairs, c = best
    doubles = [i for u, v in pairs for i in via[u][v]]
    trail = parcours(ids, s, doubles)
    if suivant is not None:
        t = trail[-1]['vers']
        q = min(ns, key=lambda n: float(np.hypot(*(noeuds[n] - suivant))) + 0.05 * dist[t][n])
        node = t
        for i in (via[t][q] if q != t else []):
            e = aretes[i]
            fwd = e['a'] == node
            trail.append({'eid': i, 'pts': e['pts'] if fwd else e['pts'][::-1], 'second': True, 'de': node, 'vers': e['b'] if fwd else e['a']})
            node = trail[-1]['vers']
    return trail, c


# ---------- 3. Les unités : un tube par mot ----------
comps = composantes(noeuds, aretes)
boxes = [(min(aretes[i]['pts'][:, 0].min() for i in ids), max(aretes[i]['pts'][:, 0].max() for i in ids)) for ids in comps]
gaps = [boxes[i + 1][0] - boxes[i][1] for i in range(len(comps) - 1)]
coupe = int(np.argmax(gaps)) + 1
groupes = [('Borne', comps[:coupe]), ('24/7', comps[coupe:])]


def centre(ids):
    return np.vstack([aretes[i]['pts'] for i in ids]).mean(axis=0)


# Première passe : où chaque lettre commence (la précédente doit le savoir pour choisir sa sortie).
entrees = {}
for nom, lettres in groupes:
    fin = None
    for li, ids in enumerate(lettres):
        trail, _ = itineraire(ids, fin, centre(lettres[li + 1]) if li + 1 < len(lettres) else None, li == 0)
        entrees[(nom, li)] = trail[0]['pts'][0].copy()
        fin = trail[-1]['pts'][-1]

unites, total_double, nb_demi_tours = [], 0.0, 0
for nom, lettres in groupes:
    P, C, L = [], [], []                       # points (x, z), recul visé (0 = face, 1 = arrière), étiquette
    fin, demi_tours = None, []
    for li, ids in enumerate(lettres):
        suivant = entrees[(nom, li + 1)] if li + 1 < len(lettres) else None
        trail, double = itineraire(ids, fin, suivant, li == 0)
        total_double += double
        # Si le tracé doit repasser par son nœud de départ, le tube part de DERRIÈRE ce nœud : il cède le passage au
        # trait qui y passera, et son électrode se loge derrière lui.
        rogne = any(t['de'] == trail[0]['de'] for t in trail[1:]) and not trail[0].get('anneau')
        rebrousse = False
        if fin is not None:
            # Liaison occultée depuis la lettre précédente : elle file derrière et remonte en face juste avant d'arriver.
            lien = reech(np.vstack([fin, trail[0]['pts'][0]]))[1:-1]
            # Si elle arrive à contresens du premier trait (le haut du « E », abordé par son bout), elle reste derrière
            # jusqu'au bout et le tube fait un vrai demi-tour pour revenir en face.
            p0 = trail[0]['pts']
            d_lien = (p0[0] - fin) / (np.linalg.norm(p0[0] - fin) + 1e-12)
            d_trait = p0[min(len(p0) - 1, 12)] - p0[0]
            d_trait /= np.linalg.norm(d_trait) + 1e-12
            rebrousse = len(lien) > 8 and float(d_lien @ d_trait) < -0.6
            n_face = 0 if rebrousse else min(int(round(0.014 / PAS)), len(lien) // 2)
            P.extend(lien)
            C.extend([1.0] * (len(lien) - n_face) + [0.0] * n_face)
            L.extend('N' * len(lien))
        base, visites = len(P), []
        for k, t in enumerate(trail):
            if k > 0 and t['eid'] == trail[k - 1]['eid'] and aretes[t['eid']]['a'] != aretes[t['eid']]['b'] and not t.get('anneau'):
                demi_tours.append(len(P) - 1)          # le tube rebrousse chemin au bout de ce trait
            pts = t['pts'] if k == 0 else t['pts'][1:]
            if k == 0:
                if rebrousse:
                    demi_tours.append(len(P))
                visites.append((t['de'], len(P), not t['second'], rogne))
            else:
                visites.append((t['de'], len(P) - 1, (not t['second']) or (not trail[k - 1]['second']), False))
            P.extend(pts)
            C.extend([1.0 if t['second'] else 0.0] * len(pts))
            L.extend(('N' if t['second'] else 'L') * len(pts))
        if rogne:
            for q in range(base, min(len(P), base + int(round(ESQUIVE / PAS)))):
                C[q] = 1.0
        if rebrousse:
            C[base] = 1.0
        if trail[-1]['vers'] is not None:
            visites.append((trail[-1]['vers'], len(P) - 1, not trail[-1]['second'], False))
        occupes = set()
        for node, idx, en_face, cede in visites:
            if cede:
                continue
            if node in occupes:                # croisement : ce passage-ci plonge derrière celui qui est déjà là
                n_ = int(round(ESQUIVE / PAS))
                for q in range(max(base, idx - n_), min(len(P) - 1, idx + n_) + 1):
                    C[q] = 1.0
            elif en_face:
                occupes.add(node)
        fin = np.asarray(P[-1])
    P, C = np.asarray(P, float), np.asarray(C, float)
    P = lisse(P, 0.0025)
    # Le recul s'adoucit le long du tube, mais pas à travers un demi-tour (l'aller y reste en face jusqu'au bout).
    dpt = np.empty(len(C))
    bornes = [0] + [h + 1 for h in demi_tours] + [len(C)]
    for a_, b_ in zip(bornes, bornes[1:]):
        dpt[a_:b_] = gaussian_filter1d(C[a_:b_], 0.0055 / PAS, mode='nearest') * ENTRAXE
    # Demi-tours : au bout d'un trait sans issue, le tube tourne à 180° vers le mur et revient exactement derrière
    # lui-même — un demi-cercle dont le rayon est la moitié de l'entraxe des deux plans.
    L = list(L)
    for h in sorted(demi_tours, reverse=True):
        r_u = ENTRAXE / 2
        n_ = max(2, int(round(r_u / PAS)))
        i0, i1 = max(0, h - n_), min(len(P) - 1, h + n_ + 1)
        tg = P[h] - P[max(0, h - n_ - 4)]
        tg /= np.linalg.norm(tg)
        base_ = P[h] - r_u * tg
        ths = np.radians(np.arange(15, 180, 15))
        arc_p = np.array([base_ + r_u * math.sin(th) * tg for th in ths])
        arc_d = np.array([dpt[i0] + (dpt[i1] - dpt[i0]) * (1 - math.cos(th)) / 2 for th in ths])
        arc_l = [L[i0] if th < math.pi / 2 else L[i1] for th in ths]
        P = np.vstack([P[:i0], [base_], arc_p, [base_], P[i1 + 1:]])
        dpt = np.concatenate([dpt[:i0 + 1], arc_d, dpt[i1:]])
        L = L[:i0 + 1] + arc_l + L[i1:]
        assert len(P) == len(dpt) == len(L), (len(P), len(dpt), len(L))

    # Électrodes : aux deux bouts le tube se coude vers le mur (rayon 1 cm) et finit à 8 mm de lui.
    def coude(pt, sens, d0):
        r, out = 0.010, []
        for th in np.radians(np.arange(10, 91, 10)):
            out.append((pt[0] + r * math.sin(th) * sens[0], pt[1] + r * math.sin(th) * sens[1], d0 + r * (1 - math.cos(th))))
        bout = (pt[0] + r * sens[0], pt[1] + r * sens[1])
        for dd in np.arange(d0 + r + PAS, FACE - 0.008, PAS):
            out.append((bout[0], bout[1], float(dd)))
        return out, (bout[0], bout[1], d0 + r)
    t0 = P[0] - P[5]
    t0 /= np.linalg.norm(t0)
    t1 = P[-1] - P[-6]
    t1 /= np.linalg.norm(t1)
    debut, bout0 = coude(P[0], t0, float(dpt[0]))
    fin_, bout1 = coude(P[-1], t1, float(dpt[-1]))
    points = [list(p) for p in debut[::-1]] + [[p[0], p[1], float(d_)] for p, d_ in zip(P, dpt)] + [list(p) for p in fin_]
    labels = 'E' * len(debut) + ''.join(L) + 'E' * len(fin_)
    nb_demi_tours += len(demi_tours)
    # Supports : sous les tubes de face allumés, tous les 28 cm environ (un verrier en pose le moins possible).
    supports, run = [], 0.16
    for q in range(1, len(P)):
        run += float(np.hypot(*(P[q] - P[q - 1])))
        if L[q] == 'L' and dpt[q] < 0.0008 and run >= 0.28:
            supports.append([round(float(P[q][0]), 5), round(float(P[q][1]), 5)])
            run = 0.0
    unites.append({'nom': nom, 'points': [[round(float(v), 5) for v in p] for p in points], 'labels': labels, 'supports': supports,
                   'bouts': [[round(float(v), 5) for v in bout0], [round(float(v), 5) for v in bout1]]})

# ---------- 4. Bilan, contrôles ----------
lit = np.vstack([[p[0], p[1]] for u in unites for p, lb in zip(u['points'], u['labels']) if lb == 'L'])
lit_247 = np.vstack([[p[0], p[1]] for p, lb in zip(unites[1]['points'], unites[1]['labels']) if lb == 'L'])
bilan = {}
for u in unites:
    a = np.array(u['points'])
    seg = np.linalg.norm(np.diff(a, axis=0), axis=1)
    for lb in 'LNE':
        m = np.array([c == lb for c in u['labels'][1:]])
        bilan[lb] = bilan.get(lb, 0.0) + float(seg[m].sum())
# Deux portions du tube ne doivent pas se traverser : distance d'axe à axe ≥ un diamètre (hors voisinage immédiat).
pire = (math.inf, None)
for u in unites:
    a = np.array(u['points'])
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(a, axis=0), axis=1))])
    for i in range(0, len(a), 3):
        far = np.abs(s - s[i]) > 0.05
        if far.any():
            d_ = np.linalg.norm(a[far] - a[i], axis=1)
            if d_.min() < pire[0]:
                pire = (float(d_.min()), u['nom'], a[i].round(3).tolist())
result = {'texte': E['texte'], 'unites': unites, 'largeur_m': round(float(lit[:, 0].max() - lit[:, 0].min()), 4),
          'hauteur_m': round(float(lit[:, 1].max() - lit[:, 1].min()), 4),
          'centre_m': [round(float((lit[:, 0].max() + lit[:, 0].min()) / 2), 5), round(float((lit[:, 1].max() + lit[:, 1].min()) / 2), 5)],
          'milieu_247_m': round(float((lit_247[:, 1].max() + lit_247[:, 1].min()) / 2), 5), 'face_m': FACE, 'entraxe_m': ENTRAXE}
(D / 'neon-borne.json').write_text(json.dumps(result))

img = Image.fromarray((mask * 50).astype(np.uint8)).convert('RGB')
dr = ImageDraw.Draw(img)
for u in unites:
    for p, lb in zip(u['points'], u['labels']):
        x, y = p[0] / M + cx, cy - p[1] / M
        col = (120, 255, 160) if lb == 'E' else (110, 120, 160) if lb == 'N' else (255, 170, 60) if p[2] > ENTRAXE / 2 else (255, 120, 235)
        r_ = 3 if lb == 'L' else 2
        dr.ellipse([x - r_, y - r_, x + r_, y + r_], fill=col)
    for x_, z_, _ in u['bouts']:
        x, y = x_ / M + cx, cy - z_ / M
        dr.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(120, 255, 160), width=3)
img.save(D / 'neon-axe.png')
print('NEON', repr(E['texte']), '|', len(unites), 'tubes |', ', '.join(sorted(set(journal))) or 'graphe inchangé', '| traits doublés', round(total_double * 100, 1), 'cm |', nb_demi_tours, 'demi-tours')
print('     allumé', round(bilan['L'], 2), 'm ; occulté', round(bilan['N'], 2), 'm ; électrodes', round(bilan['E'], 2), 'm ; supports', sum(len(u['supports']) for u in unites),
      '| texte', result['largeur_m'], 'x', result['hauteur_m'], 'm | plus petit écart entre deux portions', round(pire[0] * 1000, 1), 'mm, tube', pire[1], 'en', pire[2],
      ', pour un tube de', round(DIAM * 1000), 'mm')
