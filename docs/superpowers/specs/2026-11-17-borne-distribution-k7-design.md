# Borne 24/7 — la distribution de la K7 — document de conception

- **Date** : 17/11/2026
- **Statut** : relu par un constructeur neuf, **validé par Rusmir le 17/11/2026** (« je valide le tout »)
- **Avancement** : livraison 1 (sans vidéo) codée le 17/11/2026 — plan
  `docs/superpowers/plans/2026-11-17-borne-distribution-livraison-1.md` ; livraison 2 en attente du lot 3.
- **Base** : branche `feat/borne-location` (HEAD `953ca0d`) et l'essai Blender du lot 3
  (`.superpowers/lot3-essai/`, hors dépôt)
- **Document parent** : `2026-11-16-borne-location-design.md` — ses décisions restent valables ; celui-ci
  ajoute un moment au parcours de location.

> **Bandeau du 22/11/2026 — ce document a été dépassé sur plusieurs points par des décisions de Rusmir des 21 et
> 22/11.** Elles sont réunies au § 12, qui prime sur les § 3 à 6 partout où ils se contredisent : l'appareil bouge
> dans la vidéo (cadrage « mixte »), la K7 est l'étui carton usé du vidéoclub, la tranche du film loué est posée par
> la page, le plafond de poids passe à 2,6 Mo. Le texte d'origine est laissé tel quel en dessous.
>
> **Bandeau du 23/11/2026 — le § 13 prime à son tour sur le § 12** pour le titre du film : la tranche du film loué
> suit la K7 pendant tout le trajet, et l'écran de la borne dans la vidéo est le vrai écran, placé par la page.

Chaque décision porte sa provenance : **[R]** = dite par Rusmir, **[C]** = choix de Claude, à vérifier
à la relecture.

## 1. Intention

Après « LOUER », la borne **montre** qu'elle distribue la K7 : la vue recule de l'écran, un petit robot
très simple, à la manière d'un juke-box, va chercher la cassette dans la vitrine et la sort par la fente,
puis la vue revient sur l'écran, d'où l'on regarde le film ou l'envoie sur le Chromecast. **[R]**

Le but : **gamifier sans alourdir**. **[R]** Ce moment sert l'objectif 3 du document parent (« on doit
avoir envie de se servir de la borne même sur une machine puissante »), et il couvre l'attente du serveur.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

- Une animation de **8 secondes** au total, recul et retour compris. **[R]** (5 s jugées trop rapides)
- La K7 qui sort est **celle du film loué** : son titre se lit sur un afficheur au-dessus de la fente
  et sur la tranche de la cassette une fois sortie. **[R]** (options 1 et 2, voir § 4)
- Dans la vitrine, les K7 sont **rangées droites, debout, dans un carter** — le magasin où le robot vient
  les prendre. **[R]**
- À la fin, on peut **regarder** le film tout de suite, ou **l'envoyer sur le Chromecast**, ou consulter
  **ses locations** (durée restante, films loués non rendus). **[R]** pour le principe ; la forme est en § 7.

**Non-objectifs**

- Aucune 3D en direct : la borne n'en fait jamais tourner (document parent, § 6), et le GPU du vidéoclub
  est libéré dès l'appui sur la borne (décision du 16/11). **[R]**
- Le titre suivi pendant tout le trajet du robot (option 3) : écarté. **[R]**
- L'animation inverse du rendu d'une K7 par la fente : naturelle une fois le robot fait, mais elle
  appartient à la tranche c (« retour par la fente »). **[C]**

**Anti-objectifs** (ce qui ferait de ce moment un échec même s'il fonctionne)

- Une animation qui **retarde** la location ou qui **bloque** le visiteur : elle s'interrompt d'un appui,
  et son absence (vidéo pas encore chargée, moins de mouvement demandé) ne change rien au parcours.
- Une animation qui montre une K7 distribuée **alors que la location a échoué**.
- Un raccord visible entre la vidéo et l'image fixe de la borne, ou entre la vidéo et l'écran posé
  par-dessus.
- Un téléchargement lourd imposé à tout visiteur de la borne, qu'il loue ou non.

## 3. Contraintes

- **Tout vient de Blender, aplati en 2D** (document parent, § 9) : l'animation est une **courte vidéo
  rendue**, servie par nous (jamais de lecteur tiers — règle « jamais de publicité »).
- La vidéo est rendue **avec la même caméra et la même scène** que l'image fixe de la borne entière
  (lot 3) : la première image de la vidéo est, au pixel près, cette image fixe.
- La caméra **ne bouge pas** pendant la vidéo. Le recul et le retour sont des transformations de la page
  (zoom CSS), pas des mouvements de caméra : l'écran vivant de la borne reste posé par-dessus la vidéo à
  un endroit fixe, et l'afficheur et la tranche s'y posent sans suivi.
- **Dépendance** : ce travail suppose la borne modélisée du lot 3 (cadrages, vitrines, fente). Le carter
  et le robot se modélisent dans la même scène ; la vidéo se rend quand Rusmir a validé la borne.
  **Remplacer le corps CSS actuel de la borne (`Spines`, `.slot`, `.below` dans `KioskView.tsx`) par
  l'image Blender est un préalable livré par le lot 3**, pas une partie de ce chantier (document parent :
  « le corps de la borne reste provisoire jusqu'au rendu Blender du lot 3 »).
- **Image de départ** : la **vue rapprochée de la borne entière** du § 9 du document parent (celle autour
  de laquelle l'écran zoome), pas la devanture avec la rue. **[C]**
- **L'écran pendant la vidéo est dans la vidéo.** **[C]** Ce qu'il affiche pendant la distribution est
  générique (« DISTRIBUTION EN COURS »), donc il est rendu dans la vidéo, au format de l'écran du modèle.
  Rien n'est posé par-dessus la vidéo, sinon l'afficheur et la tranche finale. Le recul part de l'écran
  vivant (5:9 sur téléphone, 2:3 sur PC) et se termine sur l'image fixe de la borne, dont l'écran montre
  le même « DISTRIBUTION EN COURS » : le passage de l'un à l'autre est un fondu pendant le zoom. Une seule
  vidéo sert donc aux deux appareils, quelle que soit la forme de l'écran vivant.

## 4. Approches considérées (pour le titre du film)

| Approche | Ce qu'elle coûte | Décision |
|---|---|---|
| **1. Afficheur au-dessus de la fente** — un afficheur deux lignes vert, comme sur les bornes de l'époque ; texte posé par la page à un endroit fixe | Faible : du texte, pas de suivi | **Retenue [R]** |
| **2. Tranche du film sur la K7, une fois sortie et immobile** — la page pose la tranche sur la dernière seconde, sur une position fixe donnée par Blender | Moyen : une position, un éclairage à accorder | **Retenue [R]** |
| 3. Tranche suivie pendant tout le trajet (coins exportés image par image, masquage derrière la vitre et dans la fente) | Élevé, pour un moment où la tranche fait une dizaine de pixels sur téléphone | Écartée **[R]** |
| K7 neutre, titre seulement à l'écran | Le plus simple, mais la cassette est visiblement générique | Écartée **[R]** |

Pendant le trajet, la K7 du robot est **neutre** (tranche sombre, étiquette claire sans texte) : à cette
taille, aucun titre ne se lirait. **[C]**

## 5. Le déroulé des 8 secondes

Proposition de découpage **[C]**, à régler à l'œil sur le premier rendu :

| Temps | Ce qu'on voit | Fait par |
|---|---|---|
| 0,0 – 1,0 s | La vue **recule** de l'écran jusqu'à la borne entière. L'écran affiche « Distribution en cours ». | page (zoom CSS) |
| 1,0 – 2,5 s | Le robot **se déplace** dans la vitrine jusqu'à la K7. | vidéo |
| 2,5 – 3,5 s | Il la **saisit** et la tire hors du carter. | vidéo |
| 3,5 – 5,0 s | Il descend et **disparaît** derrière la façade, vers la fente. | vidéo |
| 5,0 – 6,5 s | La K7 **sort de la fente** et s'arrête à moitié sortie. L'afficheur : « RETIREZ VOTRE K7 » / titre. | vidéo + page |
| 6,5 – 7,2 s | Arrêt : la **tranche** porte le titre du film. | vidéo + page |
| 7,2 – 8,0 s | La vue **revient** sur l'écran, qui montre le panneau du § 7. Pendant ce zoom, la dernière image de la vidéo (K7 dans la fente, case vide dans le carter) se fond dans l'image fixe de départ. | page (zoom CSS + fondu) |

La vidéo couvre donc environ 6 s (1,0 → 7,2 s) ; le recul et le retour sont dans la page.

**Après la distribution, la borne redevient l'image fixe** **[C]** : pas de seconde image « après », pas de
K7 qui reste dans la fente, pas de robot qui reposerait une cassette. Le retour se fait pendant le zoom
vers l'écran, quand la fente sort du champ sur téléphone ; sur PC, où la borne reste visible autour de
l'écran, le fondu se voit à peine dans un mouvement. À juger sur le premier rendu.

### Ordre location / animation

**La location est enregistrée AVANT l'animation.** **[C]** À la confirmation, la borne appelle le serveur
comme aujourd'hui (`rentFlow`) ; pendant l'appel, l'afficheur dit « VEUILLEZ PATIENTER » (comme une vraie
borne qui interroge sa banque). L'animation ne démarre que sur une réponse positive. Une location refusée
montre le message d'erreur actuel, sans animation : aucune K7 n'est jamais distribuée à tort.

Écartée : lancer l'animation pendant l'appel et la découper en segments (approche, attente en boucle,
saisie, retour à vide en cas d'échec). Elle cache mieux un serveur lent, mais demande quatre segments de
vidéo et une logique d'enchaînement, pour une attente qui dure d'ordinaire moins d'une seconde.

### Interruption, absence, moins de mouvement

- **Un appui n'importe où** saute à la fin (le panneau du § 7). **[C]**
- **Le geste retour** fait de même : il agit dans la borne, il ne la quitte jamais (décision du 16/11). **[C]**
- **Vidéo pas prête** au moment de jouer : la borne attend au plus un court délai (de l'ordre d'une
  seconde, au constructeur), puis passe directement au panneau. **[C]**
- **Moins de mouvement demandé** (`prefers-reduced-motion`) : pas de recul ni de vidéo ; l'afficheur et
  le panneau seulement. **[C]**
- L'animation se joue **à chaque location**. **[C]** (elle dure 8 s et se saute d'un appui)

### Son

**Oui, dans la vidéo** **[R]** : moteur du robot, prise de la K7, éjection par la fente — joué parce que
l'appui sur « LOUER » autorise le son. Et des **bruits drôles d'appareil qui a vécu, dont la mécanique
accroche un peu**. **[R]** Proposition **[C]** : l'accroc s'entend ET se voit une fois — le chariot hésite,
repart d'un coup sec — pour que le son et l'image racontent la même usure ; un seul accroc par animation,
pour que ce reste drôle. L'animation sautée coupe le son avec elle. Moins de mouvement demandé : pas de
vidéo, donc pas de son.

## 6. Ce qui est fabriqué sous Blender

- **Le carter** : dans la grande vitrine, les K7 sont debout, droites, alignées dans un casier à
  compartiments, tranche vers la vitre. **[R]** Les tranches portent des titres du catalogue (comme
  aujourd'hui), lisibles de près, pas sur téléphone.
- **Le robot** : très simple **[R]**. Proposition **[C]** : un portique à l'arrière de la vitrine — deux
  rails verticaux, un chariot qui monte et descend, une pince qui avance, saisit la K7 par sa tranche
  arrière et recule. Métal nu, câbles plats, une diode. Il passe ensuite derrière la façade opaque
  entre la vitrine et la fente : le transfert caché évite de modéliser tout le chemin. Le carter est
  dans la **grande vitrine de gauche** ; la fente est dans la **colonne de droite**, sous le pavé : le
  trajet caché va donc de gauche à droite, derrière la colonne qui porte les autocollants.
- **Révision du 18/11/2026 [C]** : le portique est placé **devant** le casier (entre la vitre et les tranches), et non
  à l'arrière, où les K7 le cacheraient — il doit se voir (« on peut observer la K7 être récupérée »). La borne étant
  désormais encastrée (10 cm de saillie), la grande vitrine gagne la profondeur nécessaire (32 cm). Le chariot porte
  un plateau à hauteur de tablette et un tiroir à deux doigts qui tire la K7 dessus. Première image clé (robot au
  repos) montrée à Rusmir le 18/11.
- **Validation avant d'animer** : quelques images clés du carter et du robot (au repos, saisie, K7
  sortie) sont soumises à Rusmir avant tout travail d'animation. **[C]**
- **La fente** : la K7 sort couchée, tranche en avant (la fente de 20 × 3 cm a les cotes de la tranche
  d'une VHS, 187 × 25 mm). Elle s'arrête à moitié sortie.
- **L'afficheur** : sur la façade, au-dessus de la fente, à la place de l'étiquette imprimée « RETOUR
  DES K7 ». Dans la façade de l'essai 3d (`geometrie.json`), la fente est sous le pavé numérique : il
  reste environ 9 cm entre le bas du pavé (1,085 m) et le haut de la fente (0,99 m), assez pour un
  afficheur d'environ 10 × 3 cm. Rendu **éteint mais allumé** (fond noir verdâtre, sans texte) : la page écrit le texte.
- **La tranche finale** : dans la pose d'arrêt, l'étiquette de la K7 est **claire et vierge**, et Blender
  exporte ses quatre coins en pixels de l'image (par `world_to_camera_view`).
- Rendus : l'image fixe de la borne entière (lot 3) et la vidéo, même caméra. Format et poids au
  constructeur, avec un ordre de grandeur visé de **2 Mo au plus** pour la vidéo sur téléphone. **[C]**

## 7. Après la K7 : l'écran

Proposition **[C]** : le message « Location enregistrée » actuel devient un panneau **« Votre K7 est
prête »** :

```
┌──────────────────────────────┐
│  VOTRE K7 EST PRÊTE          │
│  Get Out                     │
│  à rendre avant le 19/11     │
│                              │
│  [ REGARDER ]   [ Sur la TV ] │
│  Mes locations ›             │
└──────────────────────────────┘
```

- **REGARDER** ouvre le lecteur, comme aujourd'hui (`openPlayer`).
- **Sur la TV** ouvre le lecteur et lance aussitôt le choix du Chromecast (parcours Cast existant).
- **Mes locations** ouvre un écran minimal : les locations en cours (titre, temps restant, « Regarder »),
  tirées de ce que le magasin d'état sait déjà (`rentals`). Le **rendu par la fente** n'y figure pas :
  il appartient à la tranche c. **[C]**

## 8. L'afficheur

- Deux lignes de 20 caractères, police à matrice de points, vert fluorescent. **[C]**
- Au repos : « RETRAIT / RETOUR DES K7 ». Pendant l'appel au serveur : « VEUILLEZ PATIENTER ». Pendant la
  sortie : « RETIREZ VOTRE K7 » / titre, qui défile s'il dépasse 20 caractères. **[C]**
- Il est dans l'image de la borne, donc hors de l'écran : il ne se voit que quand la vue a reculé.
  Rien ne s'y écrit tant que l'écran occupe la vue.

## 9. Livraison en deux temps **[C]**

1. **Sans vidéo, dès maintenant** : location enregistrée avant tout (« Veuillez patienter » affiché à
   l'écran, faute d'afficheur), panneau « Votre K7 est prête » (Regarder, Sur la TV, Mes locations) et
   écran « Mes locations ». C'est le comportement « vidéo absente » du § 5 : il doit exister de toute
   façon.
2. **Avec le lot 3** : carter, robot, afficheur, vidéo, tranche finale, recul et retour.

## 10. Laissé au constructeur

- L'encodage de la vidéo (codec, résolution, une ou deux variantes), et quand la télécharger — au plus
  tôt à l'ouverture d'une fiche, au plus tard à la confirmation de « LOUER », jamais à l'ouverture de la
  borne (anti-objectif).
- Le cadrage sur PC, où l'écran prend la hauteur et la borne déborde : même vidéo, centrée, ou variante.
- La façon de poser la tranche finale (texte sur l'étiquette vierge) en accord avec l'éclairage de la
  vidéo. Le document parent ne permet qu'un seul mode de fusion sur l'écran (`screen`) ; la tranche est
  hors de l'écran, mais la même prudence vaut pour les appareils modestes.
- La police de l'afficheur et celle de la tranche (sans marque).

## 11. Risques

| Risque | Parade |
|---|---|
| Raccord visible entre la première image de la vidéo et l'image fixe | Même scène, même caméra, même échantillonnage ; comparaison au pixel avant d'intégrer |
| La vidéo pèse trop pour un téléphone modeste | Plafond de 2 Mo visé ; animation sautée si elle n'est pas prête à temps |
| Le robot « fait jouet » et casse le photoréalisme | Verdict visuel de Rusmir sur un rendu de quelques images clés avant d'animer |
| Le lot 3 n'est pas figé (cadrage, fente, vitrines) | La vidéo se rend en dernier, une fois la borne validée |

## 12. Révision du 22/11/2026 — décisions des 21 et 22/11

Ce paragraphe prime sur les § 3 à 6. Pièces : essais et planches dans
`tools/devanture-borne/travail/images-session-2026-11-22/` (hors dépôt).

### Le cadrage : l'appareil bouge dans la vidéo

- **Cadrage « mixte »** **[R, 21/11]** : l'appareil recule de l'écran jusqu'à la borne entière, reste fixe pendant
  que le robot saisit la K7, se rapproche de la fente pour la sortie, puis revient à l'écran. Il avance et recule
  pour de bon, à focale fixe, face au mur (`distribution_essai_film.py`, cadrage `mixte`).
- Le recul et le retour sont donc **dans la vidéo**, et non plus des zooms de la page (§ 3 et tableau du § 5
  dépassés). La vidéo dure les 8 secondes entières.
- L'autocollant « We Can Do It! » reste collé sur la vitre, translucide dans ses zones claires. **[R]**

### La K7

- La K7 est **l'étui carton du vidéoclub** (`public/models/vhs_cassette_tape.glb` et la jaquette du générateur),
  pas un boîtier plastique. **[R]** Les K7 restent parfaitement alignées dans le casier : le robot en a besoin. **[R]**
- **Matière validée le 22/11** **[R]** : le pelliculage brillant est parti — surface mate, presque plus de reflet.
  L'usure ne porte que sur la tranche : cassures fines de l'encre, bords et coins peu usés. Référence :
  `k7_reference.py`, rendu `k7-vitrine-15.png`.
- **Trois niveaux d'usure selon l'année du film** **[R]** : avant 1985 = ancien, de 1985 à 2004 = moyen, 2005 et
  après = récent (`k7_usure_tranche.py`). Plus le film est ancien, plus ses couleurs sont passées. Les 96 tranches de
  la vitrine sont cuites à leur niveau par `distribution_tranches.py`.
- Pince ajourée et volet articulé sur la fente, avec son bruit : validés. **[R]**

### Le titre du film loué

- **La tranche du film loué est posée par la page** **[R, 22/11]**, sur une K7 servie à tranche vierge : une seule
  vidéo pour tous les films. Une vidéo par film a été écartée.
- **La K7 que le robot saisit dans la vitrine a elle aussi une tranche neutre** (sombre, sans titre) **[R]** :
  sinon on verrait un film partir et un autre sortir. Les autres K7 de la vitrine gardent leurs titres.
- **L'arrêt sur la fente est allongé à un peu plus d'une seconde** **[R]**, le temps de lire le titre ; le temps est
  repris sur le trajet du robot. Dans l'essai 7 l'appareil n'est fixe sur la fente que de 5,5 à 6,9 s et la K7 n'est
  à l'arrêt qu'à 6,3 s. La tranche posée disparaît juste avant que l'appareil ne reparte.
- **La page applique à la tranche posée l'usure validée**, au niveau de l'année du film **[R]** : quelques masques
  d'usure par niveau sont livrés avec le site. **[C]** pour la forme (nombre de masques, poids).
- Blender exporte les quatre coins de la tranche vierge, en points de l'image, pour l'arrêt (§ 6, inchangé).
- L'afficheur au-dessus de la fente reste écrit par la page (§ 8, inchangé) ; comme l'appareil bouge, il ne s'écrit
  lui aussi que pendant que le cadre est fixe.

### D'où vient la tranche posée (22/11, soir)

- **Des tranches préparées à l'avance** **[R]** : la borne ne dessine pas de jaquette (ni canvas ni 3D sous `kiosk/`).
  La fabrique capture la tranche de chaque film du catalogue avec le vrai générateur, y cuit l'usure de son année et
  l'éclairage de l'arrêt sur la fente, et le site la sert comme une petite image. L'outil est à relancer quand des
  films entrent au catalogue.
- **Repli** **[R]** : un film sans image reçoit une tranche sobre — son titre écrit par la page, une usure posée
  par-dessus.
- Écartée : une tranche composée par la page pour tous les films (elle ne ressemblerait plus à celle du vidéoclub).

### Poids, son

- **Plafond de poids : 2,6 Mo** pour la vidéo sur téléphone **[R, 22/11]** (2 Mo auparavant). Le rendu Blender se
  fait à l'échelle 2 (1440 × 2580) puis la vidéo est encodée en 720 × 1290 : l'échelle du rendu ne pèse pas sur
  le fichier. Une variante plus fine pour les grands écrans n'est pas décidée.
- **Son** : fabriqué avec Woosh, bande-son n° 3 validée « globalement » **[R]** (`travail/sons/`, hors dépôt).
- **Si le navigateur refuse le son** (la vidéo part après la réponse du serveur, donc après l'appui) : elle est
  relancée muette, et un petit signe « son coupé » s'affiche dans un coin pour le dire. **[R, 22/11]**
- **Raccord** : la première image de la vidéo cadre l'écran comme la fin du film d'approche ; le raccord avec
  l'écran vivant se vérifie à l'écran, dans le vrai Chrome. **[R : d'accord]**

### Encore ouvert

- La tôle autour de la fente, sombre dans le rapproché ; le bandeau du haut à ramener au violet ; un cinquième
  autocollant à proposer.
- Le cadrage sur PC (§ 10) n'a pas été repris depuis le passage au cadrage mixte.

## 13. Révision du 23/11/2026 — la tranche suit la K7, l'écran est le vrai

Le film rendu le 22/11 selon le § 12 a été **rejeté par Rusmir** : « la K7 est noire une fois récupérée, et le nom du
film s'affiche trop tard une fois la K7 sortie ». Ce paragraphe prime sur le § 12 pour « Le titre du film loué » et
« D'où vient la tranche posée ». Écartés par lui : une K7 de trajet à étui générique ; une vidéo par film.

### Ce que l'on voit **[R, 22-23/11]**

- **Une seule vidéo pour tous les films**, et **la K7 du film loué visible tout du long** : la page pose la tranche du
  film sur la K7 de la vidéo à CHAQUE image, de sa case dans la vitrine jusqu'à la fente. Le titre est sur la K7 dès
  qu'elle apparaît dans la fente — plus de titre qui arrive après coup, plus d'arrêt à attendre.
- **« L'illusion doit être parfaite »** : ce qui passe devant la K7 passe devant la tranche (pince, autocollant, retour
  de tablette, tôle, volet), et la tranche reçoit la lumière de la scène. Aperçu validé : `apercu-2-tranche-suivie-
  la-mouche.mp4` (collage `colle2.py`, hors dépôt) — « le rendu est bon ».
- **L'écran de la borne affiche le bon film** : il n'est plus filmé. La page place le VRAI écran de la borne — celui
  que le visiteur vient d'utiliser — dans le cadre de l'écran filmé, et lui fait suivre le mouvement. Le raccord du
  début et de la fin est alors exact par construction. Le film est re-rendu avec un écran éteint.
- **Des tests de bout en bout dans le navigateur** sont exigés.

### Comment **[C]**

- La fabrique rend, pour chaque image, deux passes recadrées sur la K7 (`distribution_film.py`, `PASSES=tout`,
  environ une seconde par image) : le **cache** (ce qu'on voit réellement de la K7) et la **lumière** (K7 blanche).
  Elle exporte aussi, sans rendu (`SUIVI=1`), la boîte de la tranche et celle de l'écran à chaque image.
- Le site reçoit : le **suivi** (boîtes par image), une **planche de caches** et une **planche d'ombres** (voile noir
  dont l'opacité reproduit la lumière), communes à tous les films ; et **une tranche par film**, non éclairée, usée au
  niveau de son année. La page empile, en composition normale : la tranche, découpée par le cache de l'image
  (`mask-image`), puis l'ombre de l'image. Ni canvas, ni filtre, ni mode de fusion.
- Les positions se règlent hors de React (styles posés directement à chaque image présentée par la vidéo) : 24 rendus
  de l'arbre par seconde seraient une faute.
- Le cadre de la vidéo est placé pour que l'écran filmé de la première image tombe exactement sur l'écran de la borne.
- L'afficheur au-dessus de la fente garde son texte de repos filmé ; l'écrire par la page n'est plus nécessaire au
  titre (il est sur la K7). **[C]**, à confirmer par Rusmir.

### Ce qui reste du § 12

Le cadrage mixte, la K7 de référence et ses trois niveaux d'usure, le plafond de 2 600 000 octets, la bande-son, le
repli muet avec son signe, la vidéo qui ne fait jamais attendre, le repli d'un film sans tranche préparée. L'arrêt
allongé sur la fente n'est plus une nécessité (le titre se lit pendant toute la sortie) ; il reste tel quel.

### Catalogue de production

Les tranches sont préparées à partir de la base locale (315 films louables). **Le catalogue de production en compte
davantage** (Rusmir, 23/11) : l'outil de capture doit tourner contre une copie de la base de production avant la mise
en ligne ; d'ici là un film sans tranche a le repli.
