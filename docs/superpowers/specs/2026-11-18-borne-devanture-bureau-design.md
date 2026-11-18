# La borne sur la devanture du bureau, et l'approche filmée de la borne (lot 3, livraison B) — document de conception

- **Date** : 18/11/2026
- **Statut** : à approuver par Rusmir
- **Base de code** : `feat/borne-location` = `19f3e44` (worktree `../video-club-webgpu-borne`)
- **Document parent** : `2026-11-16-borne-location-design.md` (§ 3 parcours, § 5 devanture, § 9 fabrication des images)
- **Livraison A** (mobile, faite) : `docs/superpowers/plans/2026-11-18-borne-devanture-mobile.md`

Chaque décision porte sa provenance : **[R]** = dite par Rusmir, **[C]** = choix de Claude, à vérifier à la lecture.

## 1. Intention

Sur un téléphone, la devanture montre la borne à côté de la porte, et choisir la borne zoome sur son écran avant
d'ouvrir l'interface. Sur un ordinateur, la devanture est restée la photo d'origine avec un bouton provisoire
« BORNE 24/7 » posé sur le mur : on ne voit pas la borne. Rusmir veut sur PC **« quelque chose d'aussi abouti que sur
mobile »**. **[R]**

En cours de conception, il a remplacé le zoom par autre chose : **« au lieu d'un zoom qui de toute manière n'en est
pas un vrai, plutôt une animation de 3 secondes [qui] nous fait avancer jusqu'à la borne et fait apparaître l'écran
[…] ça rejoindrait l'idée de l'animation liée à la location de la K7 »**. **[R]** Il a validé l'essai de cette
animation sur PC le 18/11/2026 (« ok je valide l'animation ») et l'a étendue au téléphone (« on veut la même chose sur
le mobile »). **[R]** Ce document couvre donc trois choses : la devanture du bureau avec la borne, l'approche filmée
sur le bureau, et l'approche filmée sur le téléphone à la place du zoom de la livraison A.

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

- **L'approche filmée** (essai jetable n° 1, `.superpowers/lot3-essai-pc/anim/approche-borne-essai1.mp4`, validé le
  18/11/2026) : **3 secondes** **[R]** ; la caméra avance réellement, sans tourner, de 6 m à 1,32 m du mur ; la borne
  est recalculée par Blender à chaque image (91 images à 30 images par seconde) ; départ franc (0,55 s
  d'accélération), arrêt en douceur (1,10 s de freinage), vitesse maximale 2,15 m/s ; balancement de marche de 5 mm à
  1,8 Hz, éteint à l'arrêt ; flou de bougé ; pluie qui tombe. À l'arrivée l'écran de la borne occupe 94 % de la
  hauteur du cadre. **[C]** pour tous ces réglages, vus et validés sur le film.
- **Le néon « BORNE 24/7 » ne vacille pas** : il reste fixe, comme « Open 24/7 » à côté de lui. **[R]** (18/11/2026)

Mesures de l'image validée (5782 × 3072) : borne colonnes 91 à 1310, haut ligne 1401 ; écran 679-1082 × 1817-2421 ;
cadre de la porte 1487-2761, haut 916 ; plaque « PUSH » 2589 × 2290 ; échelle 1104 px/m.

## 3. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. La devanture du bureau affiche l'image validée, **animée comme aujourd'hui** : pluie, phares des véhicules,
   enseigne VIDEOCLUB qui vacille — et la borne en fait partie : ses vitres et sa carrosserie renvoient les phares
   comme la vitrine et le cadre de la porte, et son néon se comporte comme son voisin « Open 24/7 » (voir § 4 et 6.1).
2. La borne est un choix à part entière : toute la borne se clique, comme la porte ; le bouton provisoire disparaît.
3. Choisir la borne **joue l'approche filmée, puis fait apparaître l'interface** : au bout des 3 secondes, l'écran de
   la borne filmée est exactement là où se trouve l'écran de l'interface, qui prend sa place par un fondu.
4. **La même chose sur le téléphone** : l'approche filmée, en format portrait, remplace le zoom de la livraison A. **[R]**
5. Les images, le masque, les films et les positions sortent de la **même fabrique**, d'une commande.

**Non-objectifs**

- L'image de la devanture mobile, sa mise en page, sa barre de boutons, l'interface de la borne (`KioskView`), la
  pluie et les véhicules du bureau ne changent pas.
- Le robot et la vidéo de distribution (livraison 2) restent à part ; ce chantier en est la répétition technique
  (Blender → vidéo servie par le site).
- Pas d'approche filmée « à l'envers » au retour : « Quitter » ramène à la devanture, comme aujourd'hui.
- Pas de son.
- Pas d'alignement de l'écart borne-porte du mobile (12 cm) sur celui du bureau (16 cm) : non demandé.

**Anti-objectifs** (ce qui ferait un échec même si « ça marche »)

- Un raccord visible entre la photo, le mur prolongé et la borne ; une image qui s'écarte de l'essai validé.
- Une borne « collée » sur la scène : des phares qui glissent sur la vitrine et le cadre de la porte mais s'arrêtent
  net à la borne ; ou, à l'inverse, un néon « BORNE 24/7 » qui vacille seul à 16 cm d'un « Open 24/7 » qui ne bouge pas.
- Des reflets de vitre ou de métal sur le mur parce que le masque est décalé de l'image.
- Un film qui démarre par un saut (image, couleur ou lumière différente de la devanture affichée), qui saccade, ou
  qui arrive à côté de l'écran de l'interface.
- Une borne qu'on attend : si le film n'est pas chargé, pas lisible ou en panne, la borne s'ouvre quand même, tout
  de suite.
- Un écran noir, même bref, entre la devanture, le film et l'interface.
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
- **Jamais de lecteur vidéo tiers** : le film est un fichier servi par le site, lu par une balise `<video>` muette. **[R]**
  (règle du projet.)
- `prefers-reduced-motion` : pas de film, la borne s'ouvre directement (fondu court).
- **Le navigateur de vérification doit lire le H.264** : le Chromium livré avec Playwright ne le lit pas ; les
  vérifications à l'écran du film passent par le vrai Chrome installé (`channel: 'chrome'`).
- Sans WebGL, le bureau retombe sur la devanture mobile (image fixe) : inchangé.
- Poste de travail et tests : ceux du plan de la livraison A (`node --test`, 9 échecs connus, serveur de vérification
  sur le port 3002, `grep`/`rg`/`sed` par motif refusés).

## 5. Approches

**Pour passer de la devanture à l'écran de la borne**, cinq façons ont été pesées.

| Approche | Ce que c'est | Ce qu'elle coûte |
|---|---|---|
| **D. Approche filmée** (retenue, **[R]**) | Un film de 3 s rendu d'avance : la caméra avance jusqu'à la borne, recalculée par Blender à chaque image ; le site le joue par-dessus la devanture puis fait apparaître l'interface sur l'écran filmé. | Un fichier de plus par devanture (environ 2 Mo sur PC d'après l'essai), à précharger ; une chaîne de rendu d'animation dans la fabrique. Sert de répétition à la vidéo du robot. |
| A. Zoom par transformation de la page | Ce que fait la livraison A sur mobile : la scène est agrandie par une transformation CSS, une vue rapprochée nette se fond, un voile termine. | Écarté par Rusmir : « un zoom qui n'en est pas un vrai ». |
| B. Zoom dans la scène WebGL | La caméra de la scène animée avance vers l'écran. | Beaucoup de code dans le fichier le plus délicat de la devanture, et toujours un agrandissement d'image plate. |
| E. La borne en 3D temps réel dans le site | Charger le modèle et le rendre dans le navigateur. | Contraire au document parent (§ 9 : « tout est aplati en 2D pour l'affichage ») et à la raison d'être de la borne (les appareils faibles) ; le GPU doit être libéré au clic. |
| C. Aucune animation | Un fondu direct vers l'interface. | Contraire à la demande. Reste le repli quand le film ne peut pas être joué. |

**D remplace A partout**, y compris sur mobile où A est en service : le zoom, sa vue rapprochée
(`/storefront-borne-zoom.webp`) et son voile sont retirés, pour ne garder qu'une mécanique. **[C]** Le repli quand le
film n'est pas prêt est l'approche C (fondu court), pas l'ancien zoom.

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
  shader ajouterait du rose à un tube violet). **[R]**, validé le 18/11/2026. Le masque final = masque d'origine
  transformé comme la photo, puis la borne par-dessus ; à zéro sur le mur ajouté.
- **Nouvelle étape « approche »**, pour les deux variantes (bureau et mobile), reprise de l'essai
  (`anim_camera.py`, `anim_rendu.py`, `anim_compo.py`) :
  - **Le trajet** est calculé une fois (position de l'appareil, cadre, par image) et partagé par Blender et par
    l'assemblage. L'appareil ne tourne jamais : tout ce qui est dans le plan du mur se recale par un changement
    d'échelle et un glissement exacts, sans rien inventer. Réglages du bureau : ceux de l'essai validé (§ 2).
  - **Par image** : Blender rend la borne et la lumière que le mur renvoie, avec la scène de `borne.py` inchangée ;
    l'assemblage est celui de l'image fixe (mur de la photo recalé, lumière du mur, borne, halo du néon étalonné sur
    la surface réelle des tubes), puis flou de bougé et pluie.
  - **La première image du film est l'image fixe de la devanture** (essai : écart moyen de 0,88 niveau sur 255, pluie
    comprise) : c'est ce qui rend le départ invisible.
  - **Le cadrage d'arrivée** est réglé pour que l'écran filmé tombe sur l'écran de l'interface : sa place et sa taille
    dans la dernière image viennent de la position réelle de l'écran de `KioskView`, mesurée à l'écran sur une
    fenêtre de référence par plateforme, et sont écrites dans la mise en page. Sur l'essai l'écran était au milieu du
    cadre ; dans la page du bureau il a une vitrine à sa gauche : le cadrage d'arrivée bougera donc un peu par
    rapport à l'essai, et repasse devant Rusmir. **[C]**
  - **Sur mobile**, le ciel et la lune sont à l'infini : ils ne grossissent pas quand on avance. Ils forment une
    couche à part du bâtiment (le fond mobile les fabrique déjà séparément). Le trajet mobile dure aussi 3 secondes,
    avec le même rythme ; ses autres réglages se jugent sur un essai montré à Rusmir, comme pour le bureau. **[C]**
  - **Encodage** par `ffmpeg` (présent sur le Mac de développement) : H.264, 30 images par seconde, sans piste son,
    lisible dès le début du téléchargement (`+faststart`), couleurs étiquetées BT.709. Bureau : 1920 × 1020 (la
    devanture du site fait 2048 px de large aujourd'hui : même ordre de définition). Mobile : définition à choisir à
    la mesure, pour un téléphone.
  - **Budget de poids** : bureau ≤ 2,5 Mo (essai : 2 089 263 octets pour les 3 secondes) ; mobile ≤ 1,5 Mo, à
    mesurer. Les poids obtenus se disent.
- **Sorties pour le site** : `public/storefront.jpeg`, `public/storefront-mask.png`, les deux films
  (`public/storefront-borne-approche.mp4` et `public/storefront-mobile-borne-approche.mp4`, noms au choix du
  constructeur) et les **fichiers de mise en page** dans `src/data/` — celui du bureau (nouveau : image, borne, écran,
  porte, plaque PUSH) et celui du mobile (existant), chacun complété par son film : fichier, durée, taille, et
  rectangle de l'écran dans la dernière image, en fractions du cadre, projeté par la caméra. La vue rapprochée du
  mobile et le champ `zoom` de sa mise en page disparaissent.
- **Critères** : la composition du bureau refaite par la fabrique s'écarte de `essai3-compo.png` de moins de 1,5 niveau
  en moyenne par canal (bruit de rendu), comme pour le mobile ; la première image de chaque film s'écarte de l'image
  fixe de sa devanture de moins de 1,5 niveau en moyenne (hors pluie ajoutée).

### 6.2 La devanture du bureau (`ExteriorView`, `ExteriorScene`)

- **Format** lu dans la mise en page du bureau, par la scène animée et par le bloc qui porte les zones.
- **Zones** placées d'après la mise en page, plus aucun pourcentage écrit à la main :
  - **la borne entière** : zone cliquable, avec au survol un liseré discret et un libellé, comme la porte aujourd'hui ;
  - **la porte entière** devient cliquable elle aussi (aujourd'hui seule une petite zone autour de la plaque « PUSH »
    répond : à côté d'une borne cliquable partout, une porte qui ne répond que sur sa plaque paraîtrait en panne).
    **[R]**, validé le 18/11/2026. Le halo de survol et l'indicateur « PUSH ▼ » restent sur la plaque, recalés
    d'après la mise en page.
  - Un **indicateur flottant au-dessus de l'écran de la borne**, dans le style de « PUSH ▼ ». Libellé :
    **« BORNE LOCATION »**, en capitales **[R]** (18/11/2026, à la place de « LOUER ICI » proposé). La flèche « ▼ »
    de « PUSH ▼ » est reprise pour que les deux indicateurs se répondent : « BORNE LOCATION ▼ ». **[C]**
- **Le bouton provisoire disparaît**, avec son style.
- **Au clic sur la borne** : l'approche filmée (§ 6.3). La scène animée (pluie, phares) est masquée par le film et
  mise en pause pendant qu'il joue.

### 6.3 L'approche filmée dans le site (bureau et mobile)

Une seule mécanique pour les deux devantures. **[C]**

- **Préchargement** : le film de la devanture affichée se charge en tâche de fond une fois la devanture visible, sans
  retarder son affichage. Un seul film par visiteur (celui de sa plateforme).
- **Au choix de la borne** (clic sur PC ; bouton « BORNE 24/7 » ou appui sur la borne sur mobile) : l'intention part
  tout de suite (GPU et chargements du vidéoclub libérés, comme aujourd'hui), puis :
  1. le film démarre, posé exactement sur l'image de la devanture (même boîte : sur mobile, celle de la scène) ; il
     ne devient visible qu'une fois sa première image réellement affichée, par un fondu court qui absorbe ce que
     l'image fixe n'a pas (un phare en train de passer, le vacillement de l'enseigne) ; sur mobile la barre des
     boutons s'efface ;
  2. pendant le film, sa boîte glisse de la boîte de la devanture vers celle où l'écran filmé de la dernière image
     coïncide avec l'écran de l'interface (un petit ajustement d'échelle et de position, calculé par une fonction
     pure à partir de la mise en page et de la fenêtre — le rôle que tenait `zoomTransform`) ;
  3. à la dernière image, l'interface (déjà préchargée, montée sans repli d'attente — `KioskMount`) apparaît en fondu
     par-dessus ; l'écran ne bouge pas, c'est ce qui l'entoure qui devient la page de la borne. Puis le film est retiré.
- **Jamais d'attente** : film pas encore chargé, lecture refusée, erreur ou blocage en cours de route → la borne
  s'ouvre aussitôt par un fondu court. Un minuteur de garde, armé au début réel de la lecture (leçon de la livraison
  A), couvre un film qui ne finirait pas.
- **Passer le film** : un clic ou un appui pendant le film va directement à l'arrivée. **[C]**, proposé à Rusmir :
  3 secondes à chaque ouverture peuvent peser à la longue.
- **Une seule transition à la fois** : double clic, porte choisie pendant le film, retour — les garanties de la
  livraison A restent vraies.
- **Animations réduites** : pas de film.
- **Ce que le film montre sur l'écran de la borne** est la capture de l'accueil de l'interface, comme sur l'image
  fixe ; si l'accueil réel diffère (autre film à l'affiche), le fondu d'arrivée fait la bascule.
- **Fenêtres hors gabarit** : sur une fenêtre de bureau très haute, l'écran de l'interface plafonne à 1100 px
  (`min(94dvh, 1100px)`) alors que la devanture grandit avec la fenêtre : la boîte du film rétrécit alors un peu en
  fin de trajet et laisse voir autour d'elle le fond de la page de la borne. Accepté s'il n'y a ni saut ni bord dur
  choquant ; à juger sur une fenêtre 2560 × 1440. **[C]**

### 6.4 La devanture mobile

- L'image, les zones, la barre de boutons et leur placement ne changent pas.
- Le zoom par transformation, la vue rapprochée, son préchargement et le voile de fin sont retirés ; l'approche
  filmée (§ 6.3) les remplace. Les fonctions pures et les tests qui ne servaient qu'au zoom partent avec lui ; ceux
  qui servent encore (boîte de la scène, largeurs des boutons, boîte de l'écran de l'interface) restent.
- Pas de borne en paysage sur téléphone, geste retour qui ne quitte jamais la borne : inchangés. **[R]**

### 6.5 Vérification

- Tests `node --test` : fonctions pures de la géométrie du bureau et de la boîte du film ; cohérence des mises en
  page avec les images et les films (taille, durée, nombre d'images, absence de piste son, poids sous le budget) ;
  garde-fous de la fabrique (pas de dépendance à l'essai, étape en échec qui arrête tout).
- **À l'écran**, sur le build de production (port 3002), fenêtres 1280 × 720, 1440 × 900, 1920 × 1080 et une fenêtre
  très large (2560 × 1080) : zones contre la mise en page, double clic, animations réduites, retour, et **le masque** — une capture pendant le passage d'un véhicule doit montrer le reflet
  sur la carrosserie et les vitres de la borne, et **aucun reflet de vitre ou de métal sur le mur ajouté** (hors des
  14 % du bas, où la traînée du sol passe partout). Les scripts de la livraison A servent de base
  (`.superpowers/sdd/2026-11-18-borne-devanture-mobile/verification/`).
- **Le film, à l'écran**, dans le vrai Chrome, sur ces fenêtres plus 2560 × 1440, et sur trois fenêtres de téléphone
  (dont 412 × 915 et une fenêtre basse) : pas de saut au départ (capture juste avant et juste après l'apparition du
  film), écran filmé de la dernière image contre l'écran réel de l'interface (écart en pixels), aucune image noire
  d'un bout à l'autre, nombre d'images réellement présentées pendant les 3 secondes, film passé par un clic, film
  absent (fichier bloqué) → ouverture immédiate, animations réduites.
- **Non vérifié par ce chantier** : un vrai téléphone et Safari. Rusmir, le 18/11/2026 : les essais sur le Pixel 9a
  et le Chromecast se font **juste après** ce chantier, avec du ménage ; l'iPad, où il n'a « pas du tout réussi » le
  17/11, est à traiter dans la même passe. **[R]** Le film est en H.264 justement parce que tous les navigateurs le lisent ; cela reste à constater.
- **Le verdict visuel de Rusmir** sur la devanture animée du bureau et sur les deux approches filmées, dans le
  navigateur, avant de conclure.

## 7. Laissé au constructeur

- Le découpage de la fabrique en variantes (noms de fichiers, arguments, dossiers d'intermédiaire), tant qu'une
  commande refait tout et que la variante mobile ressort inchangée.
- Les tailles des images du site (définition de `storefront.jpeg` et du masque) : au moins celles d'aujourd'hui en
  hauteur ; le poids se mesure et se dit.
- La valeur exacte des aplats du masque sur la carrosserie de la borne (peinture sombre, moins réfléchissante que
  l'inox de la porte) : à régler en regardant les phares passer.
- Le dessin du survol de la borne et la place exacte de son indicateur.
- La façon de précharger le film et de savoir qu'il est jouable sans attente ; la durée des deux fondus (départ,
  arrivée) ; la valeur du minuteur de garde.
- La définition et le réglage d'encodage de chaque film, dans le budget de poids.
- Les réglages du trajet mobile (distance d'arrivée, balancement, pluie ajoutée ou non sur une devanture dont l'image
  fixe ne pleut pas), sur un essai montré à Rusmir.
- Le partage de code entre le bureau et le mobile (une seule mécanique de film, pas deux copies).
- L'ordre de construction. Proposé : la devanture du bureau (image, masque, zones), puis le film du bureau, puis
  le film du mobile et le retrait du zoom.

## 8. Risques

| Risque | Parade |
|---|---|
| Le masque ne tombe pas sur l'image (glissement, miroir des bords, passe de la borne) | Fabriqué par les mêmes opérations que l'image ; contrôle par superposition masque/image dans la fabrique ; capture pendant un passage de véhicule |
| Le shader suppose le format ou des positions de l'ancienne image | Seules deux hauteurs sont en dur et la hauteur ne change pas ; le format passe par la mise en page ; vérification à l'écran sur quatre fenêtres |
| Les phares sur la borne paraissent faux (point sur la carrosserie, traînée sur son pied) | Le shader n'est pas touché ; on juge sur la devanture animée, avec Rusmir. Si c'est faux, le réglage se fait d'abord par les aplats du masque de la borne, et seulement ensuite par une retouche du shader, qui serait une décision à part |
| Le film démarre par un saut de couleur (une vidéo et une image ne passent pas par le même traitement des couleurs dans le navigateur) | Couleurs étiquetées à l'encodage ; fondu court au départ ; mesure de l'écart entre la devanture et la première image affichée du film |
| Le film saccade ou tarde à démarrer sur un appareil faible (la borne leur est destinée) | Décodage matériel du H.264 partout ; définition mobile modeste ; mesure des images présentées ; repli immédiat ; à constater sur le Pixel quand Rusmir le branchera |
| Le film pèse sur le chargement de la devanture ou sur un forfait mobile | Chargé après l'affichage de la devanture ; budget de poids testé ; un seul film par visiteur |
| L'écran filmé n'arrive pas sur l'écran de l'interface (vitrine latérale du bureau, fenêtres étroites ou très hautes) | Cadrage d'arrivée tiré de la position réelle mesurée ; fonction pure testée ; mesure de l'écart à l'écran sur chaque fenêtre ; le fondu d'arrivée couvre le reste |
| L'accueil filmé ne ressemble plus à l'accueil réel (catalogue qui change) | Le fondu d'arrivée ; la capture se refait par la fabrique quand l'accueil change de dessin |
| De près, les traînées de pluie figées dans la photo grossissent avec le mur | Vu sur l'essai et accepté avec lui ; il ne reste presque plus de mur à l'arrivée |
| Sur mobile, le bâtiment et le ciel ne bougent pas ensemble | Ciel et lune en couche à part, à l'infini ; essai mobile montré à Rusmir avant de brancher |
| L'image refaite s'écarte de l'essai validé | Comparaison chiffrée à `essai3-compo.png` dans le plan ; toute différence visible repasse devant Rusmir |
| La devanture rétrécit trop sur un écran 16:9 | Déjà vu et accepté sur l'essai (1920 × 1020 sur 1920 × 1080) |

## 9. Pièces de référence

- Essai validé et récit : `.superpowers/lot3-essai-pc/` (`essai3-compo.png`, `REPRISE.md`, `geometrie.json`, scripts).
- Fabrique actuelle : `tools/devanture-borne/README.md`.
- Essai validé de l'approche filmée : `.superpowers/lot3-essai-pc/anim/approche-borne-essai1.mp4`, ses scripts
  `anim_camera.py`, `anim_rendu.py`, `anim_compo.py`, et la section « Essai de l'approche filmée » de `REPRISE.md`.
- Mécanique du mobile : `src/components/exterior/ExteriorView.tsx`, `storefront-layout.ts`, et la section
  « Devanture mobile » d'`AGENTS.md`.
