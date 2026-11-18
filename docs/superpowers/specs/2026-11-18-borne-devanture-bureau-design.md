# La borne sur la devanture du bureau (lot 3, livraison B) — document de conception

- **Date** : 18/11/2026
- **Statut** : à approuver par Rusmir
- **Base de code** : `feat/borne-location` = `a99853a` (worktree `../video-club-webgpu-borne`)
- **Document parent** : `2026-11-16-borne-location-design.md` (§ 3 parcours, § 5 devanture, § 9 fabrication des images)
- **Livraison A** (mobile, faite) : `docs/superpowers/plans/2026-11-18-borne-devanture-mobile.md`

Chaque décision porte sa provenance : **[R]** = dite par Rusmir, **[C]** = choix de Claude, à vérifier à la lecture.

## 1. Intention

Sur un téléphone, la devanture montre la borne à côté de la porte, et choisir la borne zoome sur son écran avant
d'ouvrir l'interface. Sur un ordinateur, la devanture est restée la photo d'origine avec un bouton provisoire
« BORNE 24/7 » posé sur le mur : on ne voit pas la borne. Rusmir veut sur PC **« quelque chose d'aussi abouti que sur
mobile »**. **[R]**

## 2. Ce qui est déjà décidé

L'image a été mise au point sur un essai jetable (`.superpowers/lot3-essai-pc/`, hors dépôt), en trois passes, et
**validée par Rusmir le 18/11/2026** (« ok parfait je valide ») : `essai3-compo.png`. Elle fixe :

- **Le cadrage.** La photo d'origine (5632 × 3072) est élargie de 150 px de mur à gauche : **5782 × 3072**, format
  1,882 au lieu de 1,833 (son choix « B », après avoir vu que 10 cm de mur à gauche de la borne étaient trop peu). **[R]**
  Sur un écran 1920 × 1080, l'image fait 1920 × 1020. Le bas de l'image (porte, vitrine) glisse de 897 px vers la
  droite ; le bord droit tombe entre les affiches « Scream » et « The Shining », aucune affiche n'est tranchée. **[C]**,
  vu et validé sur l'image. (Il avait proposé « 10 % » à couper ; il en faut 13 % pour loger la borne.)
- **L'enseigne VIDEOCLUB reste centrée sur l'image** : le haut de l'image (enseigne, rebord, mur qu'elle éclaire) ne
  suit pas le glissement du bas. **[C]**, validé sur l'image.
- **La borne** est celle du mobile, encastrée, à **16 cm du cadre de la porte**. **[R]** (« trop collée à la porte, alors
  qu'on voit le mur derrière éloigné de 10 cm de plus sur la gauche en profondeur » : encastrée, elle ne peut pas être
  là où l'on voit l'intérieur du vidéoclub.) Il reste 13,7 cm de mur à sa gauche.
- **Son écran est au format 2:3** (0,36 × 0,54 m) et montre l'interface du bureau. **[C]**, validé sur l'image.
  C'était la question laissée ouverte par le plan de la livraison A (écran modélisé 5:9 contre interface 2:3 sur PC) :
  l'interface du bureau, déjà validée, ne change pas ; c'est la borne modélisée qui prend son format.
- **Le néon « BORNE 24/7 »** est aligné en hauteur sur le « 24/7 » de la porte, comme sur mobile. **[R]** (décision du 18/11
  reprise telle quelle.)

Mesures de l'image validée (5782 × 3072) : borne colonnes 91 à 1310, haut ligne 1401 ; écran 679-1082 × 1817-2421 ;
cadre de la porte 1487-2761, haut 916 ; plaque « PUSH » 2589 × 2290 ; échelle 1104 px/m.

## 3. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. La devanture du bureau affiche l'image validée, **animée comme aujourd'hui** : pluie, phares des véhicules,
   enseigne VIDEOCLUB qui vacille — et la borne en fait partie : ses vitres et sa carrosserie renvoient les phares
   comme la vitrine et le cadre de la porte, et son néon se comporte comme son voisin « Open 24/7 » (voir § 4 et 6.1).
2. La borne est un choix à part entière : toute la borne se clique, comme la porte ; le bouton provisoire disparaît.
3. Cliquer la borne **zoome sur son écran, puis ouvre l'interface**, l'écran de la borne venant se poser sur celui de
   l'interface — comme sur mobile.
4. Les images, le masque et les positions sortent de la **même fabrique** que le mobile, d'une commande.

**Non-objectifs**

- La devanture mobile, l'interface de la borne (`KioskView`), la pluie et les véhicules ne changent pas.
- Le robot et la vidéo de distribution (livraison 2) restent à part.
- Pas d'alignement de l'écart borne-porte du mobile (12 cm) sur celui du bureau (16 cm) : non demandé.

**Anti-objectifs** (ce qui ferait un échec même si « ça marche »)

- Un raccord visible entre la photo, le mur prolongé et la borne ; une image qui s'écarte de l'essai validé.
- Une borne « collée » sur la scène : des phares qui glissent sur la vitrine et le cadre de la porte mais s'arrêtent
  net à la borne ; ou, à l'inverse, un néon « BORNE 24/7 » qui vacille seul à 16 cm d'un « Open 24/7 » qui ne bouge pas.
- Des reflets de vitre ou de métal sur le mur parce que le masque est décalé de l'image.
- Un zoom flou jusqu'au bout, saccadé, ou qui arrive à côté de l'écran de l'interface.
- Une porte ou une borne dont la zone cliquable ne tombe plus sur l'objet.

## 4. Contraintes

- **Format.** `5632 / 3072` est écrit en dur à deux endroits (`ExteriorScene.ts`, `ExteriorView.tsx`). Le format doit
  désormais venir du fichier de mise en page fabriqué, pas d'une constante recopiée.
- **Noms des fichiers conservés** : `/storefront.jpeg` et `/storefront-mask.png` (préchargés par `app/layout.tsx`).
  Aujourd'hui : image 2048 × 1117, masque 2816 × 1536.
- **Le masque pilote le shader** (`ExteriorScene.ts`). État réel, mesuré le 18/11/2026 sur le masque d'origine et sur
  `public/storefront-mask.png` (l'en-tête du shader décrit des paliers qui n'existent pas) :
  - **rouge** : un dégradé doux, maximum 192, présent **seulement sur l'enseigne VIDEOCLUB** (lignes 93 à 674). « Open
    24/7 » est à 0 : **il ne vacille pas aujourd'hui** ;
  - **vert** : 255 sur les vitres (porte, imposte, vitrine) ; **bleu** : 255 sur le métal (cadres).
  - Le point de reflet des phares est à **55 % de la hauteur** de l'image (ligne 1690), pour les vitres comme pour le
    métal. La traînée « sol mouillé » couvre les **14 % du bas** de l'image **sans lire le masque** : elle passe déjà
    aujourd'hui sur le bas de la porte, du mur et de la vitrine.
  - **Le shader ne change pas.** **[C]** La hauteur de l'image est la même : ces deux hauteurs gardent leur sens. Sur la
    borne, la ligne 1690 tombe sur la carrosserie, entre le bandeau et les vitres (haut de la vitrine ligne 1748, de
    l'écran ligne 1817) : le point se reflète donc sur sa carrosserie (masque « métal ») et son halo descend sur ses
    vitres (masque « vitre ») ; la traînée du bas passe sur le pied de la borne et sur le mur ajouté comme elle passe
    sur le reste de la façade.
- **Décisions de Rusmir qui valent ici comme sur mobile** : le GPU et les chargements du vidéoclub sont libérés **dès
  le clic** sur la borne, avant toute animation ; pas de bouton `disabled` ; pas de `backdrop-filter` ; pas d'écran noir
  à l'ouverture de la borne ; rien de grossier visuellement.
- `prefers-reduced-motion` : pas de zoom, la borne s'ouvre directement.
- Sans WebGL, le bureau retombe sur la devanture mobile (image fixe) : inchangé.
- Poste de travail et tests : ceux du plan de la livraison A (`node --test`, 9 échecs connus, serveur de vérification
  sur le port 3002, `grep`/`rg`/`sed` par motif refusés).

## 5. Approches

**Pour le zoom**, trois façons ont été pesées. **[C]** — Rusmir a délégué le « comment ».

| Approche | Ce que c'est | Ce qu'elle coûte |
|---|---|---|
| **A. Zoom par transformation de la page** (retenue) | Le bloc qui porte la scène animée et ses zones reçoit une transformation CSS, exactement comme la scène du mobile ; une vue rapprochée nette de l'écran se fond pendant le trajet ; un voile au fond de la borne termine. | La scène animée est agrandie telle quelle (floue en fin de course) : c'est la vue rapprochée qui porte la netteté, comme sur mobile. |
| B. Zoom dans la scène WebGL | La caméra de la scène animée avance vers l'écran ; il faut une texture bien plus définie ou une seconde texture, et faire suivre la pluie. | Beaucoup plus de code dans le fichier le plus délicat de la devanture, pour un résultat que la vue rapprochée donne déjà. |
| C. Pas de zoom sur PC | Un fondu direct vers l'interface. | Contraire à la demande (« aussi abouti que sur mobile ») et au parcours du document parent (§ 3). |

**A** réutilise le mécanisme écrit, testé et vérifié pour le mobile (transformation, vue rapprochée décodée à
l'appui, voile, minuteur de garde armé au début réel du zoom, une seule transition) au lieu d'en écrire un second.

**Pour le masque**, une seule voie sérieuse : le fabriquer **avec l'image**, par les mêmes opérations (le masque
d'origine glisse comme la photo) et, pour la borne, par une passe de rendu de la même scène Blender où chaque
matière sort dans sa couleur de masque. Le dessiner à la main ou le déduire de l'image par seuils donnerait un
masque qui ne suit pas la borne au pixel près — l'anti-objectif « reflets à côté ».

## 6. La conception

### 6.1 Fabrication (`tools/devanture-borne/`)

La fabrique gagne une **seconde variante, « bureau »**, à côté de la variante « mobile ». Une commande refait les
deux ; chacune a sa géométrie et son dossier d'intermédiaire.

- **Entrent dans le dépôt** depuis l'essai : la photo d'origine 5632 × 3072 et son masque d'origine (aujourd'hui dans
  l'historique git : `git show f5123bb:public/storefront.jpeg` et `…/storefront-mask.png` ; copies dans l'essai), la
  capture de l'interface du bureau (texture de l'écran 2:3), la géométrie du bureau, le script du fond du bureau.
- **Le fond du bureau** (`fond_pc.py` de l'essai) : image élargie, bas glissé, haut resté en place (prolongé en miroir
  sur ses bords), mur de gauche fait de vrais morceaux du mur de la photo, lumière de l'enseigne reportée sous le
  rebord.
- **La scène Blender est la même** (`borne.py`) ; ce qui diffère tient à la géométrie : échelle, axe de l'appareil
  (celui de la photo d'origine), zone de la passe « mur », écran 2:3 et sa texture, écart à la porte.
- **Nouvelle passe « masque »** : la borne rendue en aplats, sans éclairage — vitres de la borne (deux vitrines, vitre
  de l'écran) en vert « vitre », carrosserie et pièces métalliques en bleu « métal ». **Le néon « BORNE 24/7 » n'a pas
  de rouge** : il reste fixe, comme « Open 24/7 » à côté de lui, et garde exactement la teinte de l'image validée (le
  shader ajouterait du rose à un tube violet). **[C]**, à confirmer par Rusmir. Le masque final = masque d'origine
  transformé comme la photo, puis la borne par-dessus ; à zéro sur le mur ajouté.
- **La vue rapprochée du bureau** ne suit pas le gabarit du mobile (2 × 3 largeurs d'écran) : à l'arrivée du zoom, une
  fenêtre de bureau montre toute la largeur de la borne (1920 × 1080 : environ 2,8 largeurs d'écran pour une borne
  qui en fait 3). Elle couvre donc **la borne sur toute sa largeur** et la hauteur de fenêtre visible à l'arrivée
  (l'écran et un peu plus), composée sur le fond pour le peu de mur qu'elle contient. Au-delà (mur, cadre de la
  porte sur les fenêtres très larges), c'est la scène agrandie, donc douce, qui se voit jusqu'au voile : accepté. **[C]**
- **Sorties pour le site** : `public/storefront.jpeg`, `public/storefront-mask.png`, une vue rapprochée de l'écran pour
  le zoom (même principe que le mobile : centrée sur l'écran, tout entière dans la borne), et un **fichier de mise en
  page du bureau** dans `src/data/` — mêmes champs que celui du mobile (image, borne, écran, porte, plaque PUSH, zone
  de la vue rapprochée), en fractions de l'image, projetés par la caméra.
- **Critère** : la composition du bureau refaite par la fabrique s'écarte de `essai3-compo.png` de moins de 1,5 niveau
  en moyenne par canal (bruit de rendu), comme pour le mobile.

### 6.2 La devanture du bureau (`ExteriorView`, `ExteriorScene`)

- **Format** lu dans la mise en page du bureau, par la scène animée et par le bloc qui porte les zones.
- **Zones** placées d'après la mise en page, plus aucun pourcentage écrit à la main :
  - **la borne entière** : zone cliquable, avec au survol un liseré discret et un libellé, comme la porte aujourd'hui ;
  - **la porte entière** devient cliquable elle aussi (aujourd'hui seule une petite zone autour de la plaque « PUSH »
    répond : à côté d'une borne cliquable partout, une porte qui ne répond que sur sa plaque paraîtrait en panne).
    **[R]**, validé le 18/11/2026. Le halo de survol et l'indicateur « PUSH ▼ » restent sur la plaque, recalés
    d'après la mise en page.
  - Un **indicateur flottant au-dessus de l'écran de la borne**, dans le style de « PUSH ▼ ». Libellé :
    **« Borne Location »** **[R]** (18/11/2026, à la place de « LOUER ICI » proposé). La flèche « ▼ » et les capitales
    de « PUSH ▼ » sont reprises pour que les deux indicateurs se répondent : « BORNE LOCATION ▼ ». **[C]**
- **Le bouton provisoire disparaît**, avec son style.
- **Zoom** (approche A) : au clic sur la borne, l'intention part tout de suite (GPU et chargements libérés), puis le
  bloc de la scène reçoit la transformation qui amène l'écran de la borne sur l'écran de l'interface du bureau ; la
  vue rapprochée se fond ; le voile au fond de la borne monte ; la borne s'ouvre. La position de l'écran de
  l'interface du bureau (2:3, hauteur `min(94dvh, 1100px)`, entre la vitrine latérale et le bord du corps) est
  calculée par une fonction pure tenue alignée sur `KioskView.module.css` par un test, puis **vérifiée à l'écran**
  contre la position réelle — comme pour le mobile.
- Tout ce que le mobile garantit vaut ici : une seule transition (double clic, porte pendant le zoom), animations
  réduites, vue rapprochée absente, retour par « Quitter » sur une devanture dézoomée dont la préparation du
  vidéoclub repart.

### 6.3 Vérification

- Tests `node --test` : fonctions pures de la géométrie du bureau ; cohérence de la mise en page et des tailles
  d'images ; garde-fous de la fabrique (pas de dépendance à l'essai, étape en échec qui arrête tout).
- **À l'écran**, sur le build de production (port 3002), fenêtres 1280 × 720, 1440 × 900, 1920 × 1080 et une fenêtre
  très large (2560 × 1080) : zones contre la mise en page, zoom et arrivée sur l'écran de l'interface, double clic,
  animations réduites, retour, et **le masque** — une capture pendant le passage d'un véhicule doit montrer le reflet
  sur la carrosserie et les vitres de la borne, et **aucun reflet de vitre ou de métal sur le mur ajouté** (hors des
  14 % du bas, où la traînée du sol passe partout). Les scripts de la livraison A servent de base
  (`.superpowers/sdd/2026-11-18-borne-devanture-mobile/verification/`).
- **Le verdict visuel de Rusmir** sur la devanture animée, dans le navigateur, avant de conclure.

## 7. Laissé au constructeur

- Le découpage de la fabrique en variantes (noms de fichiers, arguments, dossiers d'intermédiaire), tant qu'une
  commande refait tout et que la variante mobile ressort inchangée.
- Les tailles des images du site (définition de `storefront.jpeg` et du masque) : au moins celles d'aujourd'hui en
  hauteur ; le poids se mesure et se dit.
- La valeur exacte des aplats du masque sur la carrosserie de la borne (peinture sombre, moins réfléchissante que
  l'inox de la porte) : à régler en regardant les phares passer.
- Le dessin du survol de la borne et la place exacte de son indicateur.
- La durée et la courbe du zoom du bureau (point de départ : celles du mobile).
- Le partage de code entre la scène mobile et le bloc du bureau (une seule mécanique de zoom, pas deux copies).

## 8. Risques

| Risque | Parade |
|---|---|
| Le masque ne tombe pas sur l'image (glissement, miroir des bords, passe de la borne) | Fabriqué par les mêmes opérations que l'image ; contrôle par superposition masque/image dans la fabrique ; capture pendant un passage de véhicule |
| Le shader suppose le format ou des positions de l'ancienne image | Seules deux hauteurs sont en dur et la hauteur ne change pas ; le format passe par la mise en page ; vérification à l'écran sur quatre fenêtres |
| Les phares sur la borne paraissent faux (point sur la carrosserie, traînée sur son pied) | Le shader n'est pas touché ; on juge sur la devanture animée, avec Rusmir. Si c'est faux, le réglage se fait d'abord par les aplats du masque de la borne, et seulement ensuite par une retouche du shader, qui serait une décision à part |
| La scène animée, agrandie par la page, se dégrade ou saccade pendant le zoom | C'est une image composée par le navigateur comme sur mobile ; mesure du nombre d'images pendant le zoom ; la vue rapprochée couvre l'essentiel du trajet |
| La position de l'écran de l'interface du bureau est mal calculée (vitrine latérale, fenêtres étroites) | Fonction pure + test sur la feuille de style + mesure réelle à l'écran ; l'écart éventuel reste sous le voile |
| L'image refaite s'écarte de l'essai validé | Comparaison chiffrée à `essai3-compo.png` dans le plan ; toute différence visible repasse devant Rusmir |
| La devanture rétrécit trop sur un écran 16:9 | Déjà vu et accepté sur l'essai (1920 × 1020 sur 1920 × 1080) |

## 9. Pièces de référence

- Essai validé et récit : `.superpowers/lot3-essai-pc/` (`essai3-compo.png`, `REPRISE.md`, `geometrie.json`, scripts).
- Fabrique actuelle : `tools/devanture-borne/README.md`.
- Mécanique du mobile : `src/components/exterior/ExteriorView.tsx`, `storefront-layout.ts`, et la section
  « Devanture mobile » d'`AGENTS.md`.
