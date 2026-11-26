# Borne 24/7 — rendre sa K7 à la borne — document de conception

- **Date** : 26/11/2026
- **Statut** : relu par un constructeur neuf le 26/11 (volet, voyant, règle de la critique intégrés) ; questions de Rusmir tranchées le 26/11 (rembobinage manuel, CC BY-SA) ; **validé par Rusmir le 26/11** (« je valide »), avec deux ajouts du même jour intégrés : le rembobinage sonore (§ 6.2) et les exemplaires (§ 7 bis)
- **Base** : branche `feat/borne-rendre-k7` (worktree `../video-club-webgpu-borne`), partie de `origin/main` = `2a9a1da`.
  Elle porte déjà, non commité, le bouton « Rendre » de « Mon compte » (voir § 6).
- **Documents voisins** : `2026-11-17-borne-distribution-k7-design.md` (le film de location, §§ 12 et 13 : la vidéo,
  la tranche posée par la page, l'écran réel placé dans l'écran filmé), `2026-11-17-borne-mon-compte-design.md`,
  `2026-11-20-credits-au-moment-de-l-action-design.md`.

Chaque décision porte sa provenance : **[R]** = dite ou validée par Rusmir, **[C]** = choix de Claude, à vérifier à la
relecture.

## 1. Intention

Aujourd'hui, rendre un film n'est possible que depuis la fiche K7 du vidéoclub 3D (« RETOURNER LA K7 ») et, sur cette
branche, depuis « Mon compte » de la borne. Rusmir trouve « Mon compte » obscur : personne n'ira y chercher le retour.
**[R]**

Ce qu'il veut : quand le visiteur revient à la borne après avoir vu son film, la borne **lui propose** de le rendre,
sans l'y obliger ; s'il accepte, il **voit** sa K7 rentrer dans la borne — un petit film immersif, le pendant du film
de location —, il reçoit son crédit s'il y a droit, et la borne l'emmène écrire sa critique. **[R]**

Le pourquoi : le retour devient un geste de vidéoclub (on rend la cassette à la fente) plutôt qu'une ligne de compte,
et il nourrit les critiques, qui font vivre le catalogue.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

1. Une **proposition** de retour à l'arrivée sur la borne, pour un film vu à 80 % ou plus. **[R]**
2. Un **film de retour** de 4 à 5 s, du point de vue du visiteur (§ 5). **[R]**
3. Le **bonus de retour anticipé passe de 24 h à 8 h, pour tout le monde** : borne, vidéoclub 3D, serveur. **[R]**
   Le bonus reste le **+1 crédit actuel** (pas un remboursement du prix de la location). **[R]**
4. À la fin du film, le crédit s'affiche, puis la borne **enchaîne sur la critique**. **[R]**
5. Un **rembobinage à la borne**, lancé à la main, qui s'**entend** (§ 6.2). **[R, 26/11]**
6. Des **exemplaires** limités et **visibles** : 2 pour une nouveauté, 1 pour tout autre film, et l'état de chaque
   exemplaire sur la fiche du film (§ 7 bis). **[R, 26/11]**

**Non-objectifs**

- Proposer le retour ailleurs que sur la borne (fin du film dans le lecteur, vidéoclub 3D) : plus tard, si Rusmir le
  demande. **[C]**
- Changer le film de location, la fiche K7 du vidéoclub 3D (hors textes du délai) ou le serveur (hors délai).
- Un retour sans être connecté : la borne ne propose rien à un visiteur anonyme.

**Anti-objectifs** — ce qui ferait échouer la fonction même si elle marche :

- Un retour **obligatoire**, ou une proposition qui revient à chaque passage : « Plus tard » ne rend rien, et la
  question n'est posée qu'**une fois par location**. **[R]**
- Une **main qui fait faux** (plastique, proportions, peau de mannequin) : la règle du photoréalisme de la borne
  (mémoire `feedback-photorealisme-borne`) prime sur l'idée. D'où le garde-fou du § 5.4.
- Une borne qui **fait attendre** : même règle que le film de location (`useDistributionFilm`) — vidéo pas
  téléchargée, lecture refusée, image qui ne vient pas → on passe directement au résultat.

## 3. Approches envisagées

| | Approche | Ce qu'elle coûte | Verdict |
|---|---|---|---|
| A | La vidéo de location **lue à l'envers** | Rien | **Écartée** : sur PC la pluie monterait ; la remontée de la location montre la K7 encore sortie de la fente pendant 0,5 s (elle quitte l'image à 7,54 s, `kiosk-distribution-suivi.json`), elle « ressortirait » après être rentrée ; 8 s au lieu de « quelques secondes » |
| B | Un court film Blender de 3 s : devant la fente, la K7 rentre, la caméra remonte | Un rendu court | Proposée par Claude, **dépassée** par C |
| C | **Le film du point de vue du visiteur** : la vue recule et s'incline, la fente s'ouvre, une main insère la K7, la borne la détecte et l'avale, la fente se ferme, la vue revient sur l'écran | Un rendu de ~100 images par variante, une main réaliste | **Retenue [R]** (« un peu plus complet ») |
| D | Une animation dessinée (CSS) | Faible | **Écartée** : contraire au photoréalisme de la borne |

## 4. Le parcours

### 4.1 La proposition à l'arrivée

- **Quand** : à l'arrivée sur la borne, juste après l'écran d'accueil (`welcome` passe à faux dans `KioskView`), le
  visiteur étant connecté. La session dure 7 jours : en pratique, c'est « la reconnexion » dont parlait Rusmir. **[R]**
- **Pour quel film** : une location en cours dont `watchProgress >= 80` (le seuil du serveur pour le rembobinage et
  `watchCompletedAt`). **[R]** (« pas 2 h », remplacé par « film vu »)
- **Une fois par location** : la question est retenue par location (utilisateur, film, `rentedAt`), qu'on ait répondu
  « Rendre » ou « Plus tard ». Retenue **sur l'appareil** (stockage local, lectures et écritures protégées) : un
  visiteur qui a deux appareils peut la voir deux fois, c'est sans gravité. **[C]**
- **Plusieurs films vus** : une seule question par arrivée, pour la location vue la plus récente (`watchCompletedAt`
  le plus récent) ; les autres attendent la prochaine arrivée ou « Mon compte ». **[C]**
- **Pas de question** tant qu'un autre message de la borne est à l'écran (fin de location, erreur…) : elle attend
  qu'il soit fermé. **[C]**

Le panneau, dans le style des messages de la borne (`KioskNotice`) :

```
┌──────────────────────────────────────────┐
│  Vous avez fini « Alien » ?              │
│                                          │
│  Rendez la K7 à la borne :               │
│   · rendue avant 8 h : +1 crédit         │  ← seulement si le délai court encore
│   · rembobinez-la d'abord dans           │  ← seulement si pas encore rembobinée (§ 6.2)
│     « Mon compte » : +1 crédit           │
│   · votre critique ensuite : +1 crédit   │
│                                          │
│      [ RENDRE LA K7 ]    [ Plus tard ]   │
└──────────────────────────────────────────┘
```

Les lignes ne promettent que ce que le serveur donnera : le délai est lu sur `rentedAt` au moment d'afficher, et c'est
la réponse du serveur qui fait foi au § 4.4. **[C]**

### 4.2 « Plus tard »

Ferme le panneau, ne rend rien, ne repose pas la question pour cette location. Le bouton « Rendre » de « Mon compte »
reste là. **[R]**

### 4.3 « RENDRE LA K7 »

1. La borne appelle le serveur **d'abord** — même ordre que la location, dont le film part à la réponse du serveur.
   **[C]**
   - Le retour **ne rembobine pas** et ne donne **jamais** le crédit de rembobinage : ce crédit ne vient que d'un
     rembobinage lancé à la main par le visiteur — dans le lecteur, ou dans « Mon compte » de la borne (§ 6.2).
     **[R, 26/11]** Le panneau du § 4.1 le rappelle quand la K7 n'est pas rembobinée ; rendre sans rembobiner fait
     perdre ce crédit, en connaissance de cause.
   - Échec du retour : pas de film, le message « Le retour n'a pas abouti — Réessayez dans un instant » existant
     (`returnDoneText`).
2. À la réponse, le **film de retour** part (§ 5). Un appui le passe, comme le film de location.
3. Si le film est sur la TV (Cast), le retour l'arrête : c'est le comportement actuel du retour (`RENTAL_GONE`), et
   le message du § 4.4 le dit (« Le film sur la télé est arrêté »), comme dans « Mon compte ».

### 4.4 La fin du film

L'écran de la borne revient à sa place et affiche le résultat, d'après la réponse du serveur :

```
┌──────────────────────────────────────────┐
│  K7 rendue                               │
│  Rendue en avance : +1 crédit.           │
│                                          │
│  [ ÉCRIRE MA CRITIQUE ]     [ Fermer ]   │
└──────────────────────────────────────────┘
```

- « ÉCRIRE MA CRITIQUE » ouvre la critique de la borne (`KioskReview`) sur ce film. **[R]**
- Si le visiteur a déjà écrit une critique de ce film, le bouton est remplacé par « Fermer » seul. **[C]**
- La critique suit la règle existante (`lib/review-eligibility.ts` : vu à 80 % **et** 80 % de la durée écoulés depuis
  le lancement — un film avancé rapidement sur la TV ne la débloque pas). Si elle n'est pas encore permise, la ligne
  « votre critique ensuite » du § 4.1 n'est pas affichée, et la fin dit « Critique possible à partir du … » (la phrase
  de la règle) avec « Fermer » seul. Même règle que le bouton de critique de « Mon compte ». **[C]**
- Le solde de crédits de la borne est rafraîchi (`fetchMe`), comme après le retour de « Mon compte ».

## 5. Le film de retour

### 5.1 Ce qu'on voit **[R]**, minutage **[C]**

| Temps | Image | Son **[C]** |
|---|---|---|
| 0 → 0,8 s | La vue part de l'écran (comme l'image 0 du film de location), **recule et s'incline légèrement vers le bas en gardant sa hauteur** : la fente « RETRAIT / RETOUR DES K7 » entre dans le cadre | — |
| 0,6 → 1,0 s | La fente s'ouvre | « clac » du volet |
| 1,0 → 2,0 s | Une main entre par le bas du cadre, du côté droit — **la main du visiteur** —, tient la K7 à plat, tranche vers nous, et l'engage à moitié | frottement |
| 2,0 → 2,5 s | La borne la **détecte** : l'afficheur de la fente écrit « K7 REÇUE » ; des rouleaux l'avalent d'un coup ; la main se retire | bip, moteur bref |
| 2,6 → 3,0 s | La fente se referme | « clac » |
| 3,0 → 4,2 s | La vue se redresse et revient sur l'écran, cadrée comme l'image 0 | — |

Durée visée : **4 à 4,5 s** (Rusmir : « 3 à 5 secondes »). La caméra ne descend pas comme dans la location : elle
pivote. **[R]**

La détection passe par l'**afficheur au-dessus de la fente** (le rectangle `afficheur` de `kiosk-distribution.json`,
qui porte déjà le titre pendant la location) : le titre, puis « K7 REÇUE ». **Aucun voyant nouveau sur la façade** :
il n'apparaîtrait que dans ce film, pas dans la devanture ni dans la location (les voyants existants sont celui du
lecteur de carte et celui du robot, `borne.py` l. 585 et 632). **[C]**

### 5.2 La fente et son volet **[C]** (corrige la préconisation du 26/11)

La scène a **déjà** un volet : `volet_fente` (`distribution_poses.py`, l. 164-177), un clapet de plastique noir
1,5 mm derrière la façade, articulé en haut, que la machine relève vers l'intérieur (`OUVRE_VOLET`,
`distribution_film.py` l. 87 et 137, entre 4,95 et 5,2 s avant resserrement). Le film de retour **réutilise ce
clapet** : il se relève, la K7 passe, il retombe. Les deux films montrent ainsi le même mécanisme, et la location n'est
pas refaite. Le « volet en retrait » proposé puis validé le 26/11 reposait sur l'idée, fausse, qu'il n'existait pas
de volet : il est abandonné (relevé par la relecture du 26/11).

### 5.3 La K7 et sa tranche

La K7 est l'étui carton du vidéoclub, celle du film de location (`distribution_poses.py`). Comme pour la location,
**la vidéo est la même pour tous les films** et la page pose la tranche du film rendu à chaque image : suivi de la
tranche image par image, planche des caches (les **doigts** passent devant la tranche comme la pince du robot
aujourd'hui) et planche des ombres. Mêmes formats que `kiosk-distribution-suivi.json` et les planches, écrits par la
même fabrique (`distribution_planches.py`). Une fois la K7 avalée, la tranche disparaît (`t: null`).

L'écran de la borne dans le film est le **vrai écran**, placé par la page dans le rectangle `e` de chaque image,
comme dans la location (§ 13 de la spec de distribution). Pendant le film, il montre l'écran tel qu'il était sous le
panneau de la question. **[C]**

### 5.4 La main — le risque principal, et son garde-fou **[R]**

- On ne la modélise pas : on part d'une **main réaliste publiée sous licence libre**. Recherche du 26/11 sur Sketchfab
  (API publique, modèles téléchargeables) — candidates :
  - « Rigged hand » (Elena FF, `eae97cc2a742413cb5338ab942b12c1e`) : texturée, articulée, 29 000 triangles,
    **CC BY-SA** — **première candidate** (licence acceptée par Rusmir le 26/11) ;
  - « Female Hand » (yanix, `0144539af191427fb6b8185a17bac675`) et « Hand Rig » (CreativeMachine,
    `a348cf6087eb4fd98a83b026593823ad`) : sculptures détaillées, **CC BY**, sans texture de peau (à peindre, par
    exemple avec le skill `texturer-modele-3d`, ou un matériau de peau Cycles à diffusion sous la surface).
  - D'autres plateformes ont été explorées par la session Countrizz (jeton Sketchfab dans Vault `secret/sketchfab`,
    MyMiniFactory et Cults par le Chrome connecté de Rusmir) ; on peut y revenir si aucune ne convient.
- Elle sort d'une **manche de veste sombre** (mouillée sur PC, où il pleut). La scène est sombre, le geste rapide, avec
  le flou de bougé : c'est favorable.
- **Garde-fou** : avant toute animation, **une image fixe** — la main tenant la K7 devant la fente ouverte, à la lumière
  de la scène — est montrée à Rusmir. Sans son accord, pas de rendu. Si aucune main ne convainc : **repli sans main**,
  la K7 est déjà engagée dans la fente ouverte et la borne l'avale (le reste du film inchangé).
- **Crédits** : la licence de la main retenue est notée dans `tools/devanture-borne/README.md` et dans le fichier des
  sources de la fabrique, auteur + licence + lien.

### 5.5 Fabrication et contrôle

- Deux variantes, comme la location : **téléphone** 720 × 1290 (borne seule) et **PC** 1920 × 1020 (dans la rue, avec
  la pluie, le décor et les fichiers qui l'accompagnent). 24 images/s, ~100 à 110 images chacune.
- Mêmes outils : la scène de `distribution_poses.py`, un script de film à part (sur le modèle de
  `distribution_film.py` / `distribution_pc_trajet.py`), les sorties encodées comme la location (H.264, sans piste
  inutile, étiquettes vérifiées par `ffprobe`), un fichier de données `src/data/kiosk-retour.json` sur le modèle de
  `kiosk-distribution.json`.
- **Images clés avant tout rendu long** (mémoire `feedback-images-cles-avant-rendu-long`) : ① la main seule (§ 5.4),
  ② puis par variante quatre images — vue inclinée sur la fente ouverte, K7 à moitié engagée, fente refermée, retour
  sur l'écran — montrées à Rusmir avant le rendu complet.
- Le son est fabriqué comme celui de la location (dossier `tools/devanture-borne/sons`).

### 5.6 Après l'image fixe de la main — décisions du 26/11 **[R]**

- **La pose.** La main retenue est la « Rigged hand ». Le visiteur est **collé à la borne**, un peu à droite de la fente : coude à
  ~26 cm de la fente, à hauteur de taille ; l'avant-bras **descend** du coude vers la main, la main pousse la K7 du
  bout des doigts. On ne voit que **la main et le départ de la manche**, qui sort du cadre par la droite (Rusmir : « on
  veut pas voir le bras entier »). La manche cache le poignet (le modèle s'arrête là).
- **Le visiteur invisible.** Torse, tête, bras et jambes simplifiés, absents de l'image mais qui **arrêtent la
  lumière** : son ombre tombe sur la borne et sur le bras.
- **Le lampadaire.** La lumière de rue existante (grand panneau à ~29° de hauteur) mettait toute la fente dans l'ombre
  du corps, sans limite visible. On ajoute un **lampadaire derrière le visiteur, presque au-dessus** (~70°), blanc
  chaud, qui passe au-dessus de ses épaules : main éclairée, ombre du corps sur la borne. **120 W sur la borne**, plus
  un complément qui ne porte que sur la main, la manche et la K7 (350 W en tout pour elles). La teinte violette de la
  peau venait des enseignes : elle disparaît.
- **Uniformisé** (Rusmir : « pourquoi pas tout uniformiser dans les 120 W ») : le lampadaire et le visiteur invisible
  sont dans **la scène commune aux films de la borne** — location et retour, téléphone et PC, et le décor du PC (la
  première image du film PC). Ni la devanture de la rue ni le film d'approche ne changent (autre scène). Le film de
  location est donc **refait**.
- **Le film de location gagne une étape** (Rusmir : entre la remise de la K7 au tiroir et sa sortie, « il manque une
  bonne seconde ») : **1,25 s** entre le moment où la K7 disparaît derrière la tôle et l'ouverture du clapet. La K7
  reste cachée, le robot commence son retour ; on entend le transport interne puis un « clac » quand elle se cale ;
  l'afficheur de la fente écrit **« PRÉPARATION… »**, puis **« RETIREZ VOTRE K7 »** quand le clapet s'ouvre. Le film
  passe de 8 s à 9,25 s ; l'arrêt d'au moins une seconde sur la K7 sortie est gardé ; la bande-son
  (`sons/mixe.sh`) est recalée.
- Images clés de la location refaite montrées à Rusmir avant le rendu complet.

## 6. « Mon compte » de la borne

### 6.1 « Rendre »

Déjà codé sur cette branche (non commité) : un « Rendre » par location en cours, une question, puis le message de
résultat. Il **reste**. **[R]** Il passe par le même chemin que § 4.3 et § 4.4 — film de retour compris —, pour qu'un
retour à la borne se voie de la même façon d'où qu'il parte. **[C]**

### 6.2 « Rembobiner » **[R, 26/11]**

Chaque location en cours vue à 80 % ou plus et pas encore rembobinée (`rewindClaimed` faux) reçoit un bouton
« Rembobiner », à côté de « Regarder » et « Rendre ». Rien ne rembobine tout seul. Le rembobinage du lecteur
(« BE KIND REWIND ») est inchangé.

**La séquence est uniquement sonore, et ne bloque pas le visiteur** **[R, 26/11]** — pas d'écran de bobines ni de
compteur ; il continue à se servir de la borne pendant ce temps :

1. **Le rembobinage, ~60 s**, avec un début, un milieu et une fin : la bande démarre, **accélère fortement** jusqu'à un
   régime aigu au milieu, puis **ralentit sur les 10 dernières secondes**.
2. **Un « clac »** à l'arrêt de la bande. **C'est là que tombe le +1** (`api.rentals.claimRewind`,
   `POST /api/rentals/{id}/rewind`, même règle serveur que le lecteur), comme dans le lecteur. La ligne passe à
   « Rembobiné · +1 crédit » et le solde de la borne est relu.
3. **Le robot remet la K7 en place** : le son du mécanisme, celui de la vidéo de location (le bras qui prend et pose
   la K7).

Pendant les 60 s, le bouton devient « Rembobinage… » (pas de second lancement). **[C]** Si la borne est fermée avant
le clac, le rembobinage s'arrête sans crédit, et le bouton revient. **[C]** Le son du rembobinage n'existe pas encore :
il est fabriqué ou pris dans une banque de sons libre, et **Rusmir l'écoute avant qu'il soit branché** (même règle que
les images clés). **[C]** Le son du robot est tiré de la piste de la vidéo de location ou de ses sources
(`tools/devanture-borne/sons/mixe.sh`). **[C]**

## 7. Le délai de 8 h, partout **[R]**

Valeur unique : 8 h après `rented_at`. À changer ensemble :

- `lib/rentals.ts` : `EARLY_RETURN_HOURS = 24` → 8 (le serveur décide, `returnFilm`) ;
- `src/components/videoclub/VHSCaseOverlay.tsx` : `isWithinEarlyReturn` (l. ~869) et les deux textes « Retour sous 24h »
  (l. ~1137, ~1447) ;
- `src/components/tutorial/TutorialOverlay.tsx` (l. 45) : « Retourner le film sous 24h » ;
- `src/components/kiosk/kiosk-account-logic.ts` : `EARLY_RETURN_MS` et les textes de `returnConfirmText` ;
- les tests qui figent 24 h (`tests/domain/kiosk-account-logic.test.mjs`, `tests/domain/borne-rendre-k7.test.mjs`),
  et un test qui vérifie que serveur, vidéoclub 3D et borne disent la même valeur.
- Le prompt du gérant (`lib/chat.ts`) ne mentionne pas le délai (vérifié le 26/11) ; à revérifier au moment du
  changement.

Les locations en cours au moment du déploiement passent à la nouvelle règle (le serveur calcule au retour). **[C]**

## 7 bis. Les exemplaires **[R, 26/11]**

### 7 bis.1 La règle

- **2 exemplaires pour une nouveauté (`is_nouveaute = 1`), 1 pour tout autre film.** Aujourd'hui : 3, 2 et 1
  (classiques et bizarre), posés par `lib/db.ts` (l. 174-186) et `scripts/seed-films.ts` (l. 398-401).
- Appliquée **à la prod** : tous les films existants passent à 2 ou 1, par une migration qui ne s'exécute **qu'une
  fois** (la migration actuelle se rejoue à chaque démarrage : la nouvelle ne doit pas écraser ensuite un réglage fait
  à la main dans l'admin). Le seed suit la même règle. **[C]**
- Quand l'admin marque ou démarque un film comme nouveauté, son nombre d'exemplaires passe à 2 ou 1 ; le réglage à la
  main du stock dans l'admin reste possible. **[C]**
- Un film qui a plus de locations en cours que son nouveau stock les garde jusqu'à leur fin ; il est simplement
  « tout loué » d'ici là (le calcul `max(0, stock − locations)` existe déjà).
- Effet accepté par Rusmir : les étagères du vidéoclub 3D, qui montrent une cassette par exemplaire (`Aisle.tsx`,
  l. 265), seront plus vides — des films vont être ajoutés au catalogue.

### 7 bis.2 Ce qu'on voit

Sur la **fiche d'un film de la borne**, une ligne par exemplaire **[R]** :

```
EXEMPLAIRES
  ▮ n° 1   disponible
  ▮ n° 2   loué · retour prévu jeudi 21:00
```

- « Retour prévu » = la fin de la location en cours (`expires_at`) de cet exemplaire. Le serveur ne renvoie
  aujourd'hui que le **premier** retour (`earliest_return`, et seulement quand tout est loué) : il doit renvoyer la
  date de fin de **chaque** location en cours du film, sans rien dire de qui loue. **[C]**
- L'exemplaire loué par le visiteur lui-même est dit « loué par vous · jusqu'au … ». **[C]**
- Cette liste remplace la phrase actuelle « 2 copies sur 3 en rayon » (`availabilityText`, `kiosk-logic.ts`). **[C]**
- **À la fin du retour** (§ 4.4), le message montre la même liste pour le film rendu : l'exemplaire rendu y est de
  nouveau « disponible ». **[R]**
- La fiche K7 du vidéoclub 3D n'est pas touchée dans ce chantier. **[C]**

## 8. Contraintes

- `KioskView.tsx` dépasse déjà le budget de 1 000 lignes (1 068) : la proposition, le film de retour et leur état
  vivent dans des fichiers à part (crochet et composant), `KioskView` ne fait que les brancher. **[C]**
- Le film de retour réutilise le lecteur du film de location (`useDistributionFilm`, `KioskDistributionFilm`), déjà
  paramétré par l'adresse, les fichiers d'accompagnement et la durée — sans le dupliquer. **[C]**
- Aucun lecteur vidéo tiers ; les fichiers sont servis par le site.
- Vérification sur le Pixel 9a réel (mémoire `feedback-mesurer-sur-le-telephone`), serveurs du worktree sur 3002/3003
  (jamais 3000, 3001 est celui de Rusmir).
- Pas de `git add -A` ; ni `AGENTS.md` ni `next-env.d.ts` réécrits par `next dev` dans les commits ; fusion sur `main`
  seulement avec l'accord explicite de Rusmir.

## 9. Laissé au constructeur

- Le découpage en livraisons. Suggestion **[C]** : ① délai de 8 h + proposition + parcours complet avec le résultat
  et la critique, **sans film** (le parcours passe directement au résultat, comme quand le film ne peut pas partir),
  plus les exemplaires (§ 7 bis) et le bouton « Rembobiner » — livrable et testable sur le Pixel tout de suite ;
  ② les sons du rembobinage, après écoute par Rusmir ; ③ le film, une fois ses images validées, branché sans changer
  le parcours.
- Le nom et la forme exacte des fichiers, des clés de stockage local, des tests.
- Le choix entre les mains candidates, après l'image fixe montrée à Rusmir.
- Le réglage fin du minutage du § 5.1 dans les bornes de 4 à 5 s.

## 10. Questions encore ouvertes pour Rusmir

Aucune. Tranchées le 26/11 :

- **Rembobinage** : jamais automatique ; le crédit ne vient que d'un rembobinage lancé à la main (§ 4.3, § 6.2). **[R]**
- **Licences** : CC BY-SA acceptée — le projet n'a aucun usage commercial, publier l'auteur et la licence ne pose
  aucun problème. La « Rigged hand » d'Elena FF (CC BY-SA) est donc la première candidate du § 5.4 ; le film de retour
  est publié sous CC BY-SA avec son crédit. **[R]**
