# Devantures avec la borne — fabrication des images et des films

Les devantures du site sont des images fabriquées : la photo d'origine, un mur reconstitué à sa gauche,
et la borne de location rendue sous Blender puis raccordée à la photo. Ce dossier contient tout ce qu'il
faut pour les refaire d'une commande, avec ce que le site lit autour d'elles. Deux **variantes** :

| Variante | Géométrie | Intermédiaire | Devanture |
|---|---|---|---|
| `mobile` | `geometrie.json` | `travail/` | vue reculée 1536 × 2752 (toit, ciel, lune) ; écran de la borne 5:9 |
| `bureau` | `geometrie-bureau.json` | `travail-bureau/` | photo du bureau élargie à 5782 × 3072 ; écran de la borne 2:3 ; scène animée (masque) |

| Sortie | Rôle |
|---|---|
| `public/storefront-mobile.webp`, `.jpeg` | La devanture mobile, 1536 × 2752 |
| `public/storefront.jpeg` | La devanture du bureau (texture de la scène animée), 2102 × 1117 |
| `public/storefront-mask.png` | Son masque de reflets, 2891 × 1536 : rouge = néon qui vacille, vert = vitre, bleu = métal |
| `public/storefront-borne-approche.mp4` | Film d'approche du bureau : 1920 × 1020, 3 s, 91 images (2 072 820 octets le 18/11/2026) |
| `public/storefront-mobile-borne-approche.mp4` | Film d'approche du mobile : 720 × 1290, 3 s, 91 images (1 242 797 octets le 18/11/2026) |
| `src/data/storefront-mobile.json`, `storefront-desktop.json` | Mises en page : où sont la borne, son écran, la porte et la plaque « PUSH » dans l'image, en fractions, projetés par la caméra de la scène ; et le film d'approche (fichier, taille, durée, place de l'écran dans sa dernière image) |

Ne jamais retoucher ces sorties à la main : modifier la géométrie de la variante ou les scripts, puis relancer.

```bash
sh tools/devanture-borne/fabrique.sh                     # les deux variantes (256 échantillons pour la borne, 384 pour le mur)
DEVANTURES=bureau sh tools/devanture-borne/fabrique.sh   # une seule
sh tools/devanture-borne/fabrique.sh 128 256             # plus rapide, pour un essai
```

Compter environ 9 min pour le mobile et 16 min pour le bureau, films compris (mesuré le 18/11/2026).

Conception et décisions : `docs/superpowers/specs/2026-11-16-borne-location-design.md` (§§ 4, 5, 9) pour la borne
et la devanture mobile, `docs/superpowers/specs/2026-11-18-borne-devanture-bureau-design.md` pour la devanture du
bureau et l'approche filmée. Critère de réussite : le verdict visuel de Rusmir.

## Ce qu'il faut

- **Blender 5.3** dans `/Applications/Blender 5.3.app` (autre chemin : variable `BLENDER`). Rendu Cycles sur
  GPU Metal ; le premier rendu d'une session compile les noyaux (~3 min), les suivants prennent ~10 s.
- **ffmpeg** (libx264), pour encoder les films d'approche.
- **Python 3.11** avec PIL, numpy et scipy.
- **Les polices du Mac** : SignPainter (enseigne néon), DIN Condensed, Impact, Futura (étiquettes).
- **Le réseau au premier passage**, pour les affiches et les logos des tranches de K7 : 191 images
  téléchargées chez TMDB par `curl` (aucune clé), gardées dans `travail/tmdb-cache/` (commun aux variantes) —
  un second passage ne touche plus au réseau. Une image qui manque **arrête la fabrique**.

La fabrique s'arrête à la première erreur et n'écrit dans `public/` et `src/data/` qu'à la dernière étape de
chaque variante. Deux passages donnent la même image au bruit de rendu près (écart moyen inférieur à un
demi-niveau sur 255) : ne commiter des images refaites que si quelque chose a réellement changé.

## Les scripts, dans l'ordre de la fabrique

| Script | Rôle |
|---|---|
| `variante.py` | La variante en cours (variable `DEVANTURE`, `mobile` par défaut) : sa géométrie, son dossier d'intermédiaire. Tous les scripts passent par lui |
| `geometrie.json`, `geometrie-bureau.json` | L'échelle commune au fond 2D et à la scène Blender, les cotes de la borne et de sa façade, les réglages du néon, du mur, de la pluie, du masque et du film d'approche |
| `fond.py` (mobile), `fond_bureau.py` | Le fond sans la borne → `fond.png`, `repere.json`. Mobile : photo réduite et calée à droite, mur reconstitué, enseigne recentrée, toit, ciel de pluie et lune. Bureau : photo élargie, bas glissé vers la droite, enseigne restée centrée, mur de gauche fait de vrais morceaux du mur de la photo |
| `textures.py` | Les textures de la borne : autocollants usés, tranches de K7 (films figés dans `sources/tranches.json`), bandeau, usure de la façade, afficheur → `tex/` |
| `neon_graphe.py`, `neon.py` | Le parcours des tubes de l'enseigne « BORNE 24/7 », tracé comme un verrier les cintre → `neon-borne.json` |
| `borne.py` | La scène Blender, en passes. `borne` : la borne sur fond transparent, le mur en attrape-ombres, et la mise en page (`mise-en-page.json`). `mur` : la lumière que le mur mouillé renvoie du néon et d'un réverbère. `masque` (bureau) : la borne en aplats, sans éclairage ni tramage |
| `compo.py` | La composition : lumière du mur ajoutée à la photo, borne posée, halo du néon, pluie figée → `compo.png` |
| `masque.py` (bureau) | Le masque de reflets : celui de la photo d'origine, transformé comme elle, puis la borne en aplats. Ses garde-fous arrêtent la fabrique (ni néon ni reflet sur le mur ajouté, écran de la borne en vitre, enseigne toujours en rouge) |
| `approche_trajet.py` | Le film d'approche : le trajet de l'appareil, image par image (il avance sans jamais tourner) → `approche/trajet.json` |
| `approche_rendu.py` | Blender rend la borne et la lumière du mur à chaque image du trajet, avec la scène de `borne.py` inchangée |
| `approche_compo.py` | Assemble chaque image : mur de la photo recalé (un plan : échelle et glissement exacts), ciel à part sur mobile (à l'infini, il ne grossit pas), borne, halo, flou de bougé, pluie qui tombe. Compare la première image à l'image fixe : un écart arrête la fabrique |
| `fabrique.sh` | Enchaîne tout, par variante, et encode le film (H.264, BT.709, sans son, lisible dès le début du téléchargement) |
| `sorties.py` | L'encodage pour le site, le contrôle du poids du film (budget dans la géométrie) et la mise en page |

Outils de réglage, hors fabrique : `gros_plan.py` (gros plan Cycles d'une zone de la façade),
`mesure_neon.py` (coupe d'un tube comparée à un vrai tube de la photo), `charge.py` (recharge la scène dans
un Blender ouvert, pour la régler à vue).

## Le film d'approche

Rusmir, 18/11/2026 : plutôt qu'un zoom, une animation de 3 s qui avance jusqu'à la borne et fait apparaître
l'écran. Réglages dans le bloc `approche` de chaque géométrie : rythme (départ franc, arrêt en douceur),
balancement de marche, flou de bougé, **arrivée** — la place de l'écran dans la dernière image, réglée sur
l'écran de l'interface du site (bureau : 94 % de la hauteur du cadre, centre à 43 % de sa largeur ; mobile :
78 % de la largeur, centre à 47 % de la hauteur) —, taille, qualité (`crf`) et budget de poids du film.
Changer l'arrivée, c'est aussi vérifier à l'écran que l'écran filmé tombe toujours sur l'écran de l'interface.

## Les sources (`sources/`)

- `storefront-mobile.jpeg` — la photo d'origine de la devanture mobile (1536 × 2752).
- `storefront-bureau.jpeg`, `storefront-mask-bureau.png` — la photo d'origine du bureau (5632 × 3072) et son
  masque de reflets, tels que le site les affichait avant la borne.
- `gyro-face.png`, `ecran-bureau.png` — des captures de l'interface de la borne (téléphone, bureau), posées
  sur son écran.
- `autocollant-*.{jpg,webp}` — les quatre autocollants collés sur la borne.
- `tranches.json` — les 96 films dont les K7 garnissent les vitrines, dans l'ordre des tranches, avec
  l'affiche et le logo retenus pour chacun (figés : le résultat ne dépend plus de ce que TMDB répond).
