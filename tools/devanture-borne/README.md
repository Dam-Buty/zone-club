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
| `public/storefront-mobile-borne-approche-hd.mp4` | Film d'approche du mobile, haute définition : 1080 × 1936, 3 s, 91 images (2 343 995 octets le 18/11/2026) |
| `public/storefront-mobile-borne-approche.mp4` | Le même, léger, pour les écrans modestes : 720 × 1290 (1 066 714 octets le 18/11/2026). Le site choisit selon l'écran |
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
| `fabrique.sh` | Enchaîne tout, par variante, et encode le film (H.264, matrice BT.709, **étiqueté sRGB** par `setparams` — sans cette étiquette Chrome sur Mac l'affiche plus clair que l'image fixe —, sans son, lisible dès le début du téléchargement), puis relit ses étiquettes par `ffprobe` |
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
Quand la géométrie porte un second film `film_hd` (mobile), les images sont rendues à sa taille et le film léger en
est réduit ; les hauteurs doivent être paires (le codage vidéo l'exige).
Changer l'arrivée, c'est aussi vérifier à l'écran que l'écran filmé tombe toujours sur l'écran de l'interface.

**La fin du film du PC arrive à la lumière du décor** (bloc `approche.lampadaire` de `geometrie-bureau.json`, Rusmir
27/11/2026). La devanture n'a pas le lampadaire du visiteur ; la borne que la page montre ensuite (son décor, première
image du film de location) l'a. `approche_rendu.py` avec `LAMPADAIRE=1` rend donc la borne sous ce lampadaire pour les
dernières images (`borne_lamp_NNNN.png`), et `approche_compo.py` (`LAMPADAIRE=<de>-<à>`) fait passer la borne de l'une
à l'autre : la dernière image est le décor à un demi-niveau près (7 à 14 niveaux d'écart avant). Contrôle sur la vraie
page : le montant gauche de la borne passait de 27 à 46 niveaux à l'apparition de l'écran, il reste à 46-47.

## Les sources (`sources/`)

- `storefront-mobile.jpeg` — la photo d'origine de la devanture mobile (1536 × 2752).
- `storefront-bureau.jpeg`, `storefront-mask-bureau.png` — la photo d'origine du bureau (5632 × 3072) et son
  masque de reflets, tels que le site les affichait avant la borne.
- `gyro-face.png`, `ecran-bureau.png` — des captures de l'interface de la borne (téléphone, bureau), posées
  sur son écran.
- `autocollant-*.{jpg,webp}` — les quatre autocollants collés sur la borne.
- `tranches.json` — les 96 films dont les K7 garnissent les vitrines, dans l'ordre des tranches, avec
  l'affiche et le logo retenus pour chacun (figés : le résultat ne dépend plus de ce que TMDB répond).

## Le film de retour de la K7 (`main/`, `retour_film.py`, `retour_rendu.py`)

Spec `docs/superpowers/specs/2026-11-26-borne-retour-k7-design.md`, § 5. Le visiteur rend sa K7 : la vue part de
l'écran, recule et s'incline vers la fente ; sa main droite apporte la K7 **pincée par l'arrière** (pouce à plat sur
le dessus, index recourbé dessous en face du pouce, les autres doigts à la même courbure — Rusmir, 26/11/2026),
l'enfonce sans la lâcher ; l'afficheur écrit « K7 REÇUE », les rouleaux la tirent des doigts, la main repart, le
clapet retombe, la vue revient sur l'écran (5,9 s).

- `retour_film.py` monte la scène (celle du film de location, le visiteur et le lampadaire, la main de l'atelier) ;
  `ENREGISTRE=<fichier.blend>` l'enregistre sans rien rendre, pour animer **dans le Blender ouvert** (MCP).
- L'animation est faite à vue dans Blender et vit dans `main/retour-anim.blend` : la K7 a sa trajectoire, la main
  suit des repères attachés à la K7 (contraintes Copy Transforms à influence animée : « tient », puis « part »), la
  manche suit le poignet sans tourner avec la main. Doigts posés dans les amplitudes articulaires normales
  (limites IK sur chaque articulation : MCP −20/90°, IPP 0/100°, IPD 0/70°, pouce MCP 0/55°, IP −15/80°).
- `main/prise_auto.py` : les outils de pose employés (placer la main, plier chaque doigt jusqu'au contact de la K7,
  au rayon d'un doigt). `main/prise.py` : banc de pose dans l'atelier.
- `retour_rendu.py` rend l'animation image par image et change le message de l'afficheur
  (`textures.py` → `afficheur-recue.png`).
- Contrôle : à chaque image, aucune phalange (rayon du doigt) ni os de la paume (12 mm) n'entre dans la K7 ni ne
  passe la façade : `main/controle_retour.py`, à relancer dans le Blender ouvert après toute retouche.

### La variante du PC (`retour_pc.sh`)

Sur PC la page montre la borne modélisée dans la rue — le **décor**, première image du film de location du PC — et le
film de retour doit en partir et y revenir sans que rien ne change à l'image (Rusmir, 27/11/2026 : « on doit faire
attention à la transition entre vidéo et l'éclairage de la scène […] on cherche l'harmonie »).

- `main/retour-anim-pc.blend` : la borne du PC (`DEVANTURE=bureau … ENREGISTRE=… retour_film.py`, avec `TRAJET`,
  `QUALITE=photo`, `LUMIERE=douce` comme le film de location) et **le geste du téléphone reporté tel quel à partir de
  l'image 57** (prise, poussée, lâcher, retrait) — la K7, la main, leurs repères et le clapet viennent de
  `main/retour-anim.blend`, glissés de − 6,72 cm (l'écart entre les deux fentes) par leur parent `decalage_pc` ; écart
  mesuré avec l'original : 0 mm.
  Ce que le cadre large du PC a demandé en plus (on y voit ce que le téléphone laissait hors champ) :
  - **l'arrivée** — le visiteur (`decalage_pc`) avance de 90 cm vers la borne pendant que la vue descend (images 4 à
    28) ; quand la vue se pose sur la fente, la main présente déjà la K7 à 6 cm de sa place d'engagement (la pose de
    l'image 50 du geste, tenue jusqu'à l'image 34), puis le bras se tend un peu (images 34 à 57). L'animation de
    `k7_servie` est cuite image par image depuis `k7_valide`. Rusmir, 27/11/2026 : « il n'a qu'à tendre légèrement le
    bras » — la longue approche du téléphone (39 cm), reprise telle quelle, faisait traverser tout le cadre à la K7 ;
  - **un bras articulé** — `epaule` (1,375 m du sol), l'armature `bras_arm` (bras 32,7 cm, avant-bras 25,7 cm :
    proportions de Drillis et Contini pour 1,76 m), cinématique inverse vers `poignet` avec `pole_coude`, coude limité
    de 0 à 145°, et la manche `bras_manche` qui remplace `manche`. Tant que la main est à l'image : coude entre 51 et
    128° de flexion, poignet à 49° d'extension et 24° d'inclinaison au plus. Un avant-bras droit venu du coin de
    l'image était lu comme un tube (Rusmir : « on devrait voir une pliure au niveau du coude ») ;
  - **la sortie** — la main et l'épaule reculent de 90 cm (images 100 à 126, `delta_location` de `repere_part` et
    d'`epaule`) pour être hors du champ quand la vue remonte sur l'écran ;
  - `k7_case`, une K7 dans la case E4 de la vitrine — celle que le visiteur tient en est une autre, la case est pleine
    dans le décor.
  **Un mouvement se juge sur une vidéo rapide** (12 échantillons, demi-taille, 143 images en quelques minutes) avant
  toute image soignée : des images clés seules n'avaient pas montré le défaut de l'arrivée.
- `retour_pc_trajet.py` : l'appareil part de l'arrivée du film d'approche (le décor), descend sur la fente sans jamais
  tourner, et y revient ; cadré 2 cm plus bas que la location pour que l'écran sorte du cadre (la page pose son vrai
  écran par-dessus la vidéo : la main ne doit jamais passer dessous). Il se place 28 cm à droite de la fente, à 1,15 m
  du sol : presque de face, la main reste lisible et l'on voit le bras plié.
- `retour_rendu.py` avec `TRAJET=…` : la borne et la main sur fond transparent ; le flou de bougé de Cycles seulement
  quand l'appareil est arrêté (son propre flou est fait à l'assemblage). `approche_rendu.py mur` et `approche_compo.py`
  (`ANIM=retour/pc`) ajoutent le mur de la photo, sa lumière, la pluie.
- `retour_pc_sorties.py` : compare la première et la dernière image au décor, zone par zone (un écart de lumière
  arrête la fabrique), encode et livre `public/kiosk-retour-pc*` et la clé « pc » de `src/data/kiosk-retour.json`.
  Mesuré le 27/11/2026 : biais de + 0,3 à + 0,6 niveau sur les montants et le mur, + 1,2 sur la vitrine (la pluie, que
  le décor n'a pas) ; H.264 3,39 Mo, AV1 1,90 Mo.
- La chaîne entière prend environ une heure (48 min pour la borne et la main). Sur la vraie page, le raccord se vérifie
  avec `tests/e2e/borne-retour-pc.e2e.cjs` : la page est capturée avant le film, à sa première image, à sa dernière et
  après, et comparée hors de l'écran (au plus 1,6 niveau d'écart le 27/11/2026).

**Crédit — la main** : « Rigged hand » par **Elena FF**, licence **CC BY-SA 4.0**,
https://sketchfab.com/3d-models/eae97cc2a742413cb5338ab942b12c1e — `main/atelier-main.blend` et
`main/textures/` (textures d'origine : couleur, rugosité, normales). La pose et la manche sont ajoutées ici ; ces
fichiers dérivés restent sous CC BY-SA 4.0.
