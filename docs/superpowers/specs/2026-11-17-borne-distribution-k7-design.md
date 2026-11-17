# Borne 24/7 — la distribution de la K7 — document de conception

- **Date** : 17/11/2026
- **Statut** : relu par un constructeur neuf, **validé par Rusmir le 17/11/2026** (« je valide le tout »)
- **Avancement** : livraison 1 (sans vidéo) codée le 17/11/2026 — plan
  `docs/superpowers/plans/2026-11-17-borne-distribution-livraison-1.md` ; livraison 2 en attente du lot 3.
- **Base** : branche `feat/borne-location` (HEAD `953ca0d`) et l'essai Blender du lot 3
  (`.superpowers/lot3-essai/`, hors dépôt)
- **Document parent** : `2026-11-16-borne-location-design.md` — ses décisions restent valables ; celui-ci
  ajoute un moment au parcours de location.

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
