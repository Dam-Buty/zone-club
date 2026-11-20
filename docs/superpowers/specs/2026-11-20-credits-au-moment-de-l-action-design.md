# Les crédits expliqués au moment de l'action, dans la borne — conception

Date : 20/11/2026 — branche `feat/borne-location` — fait suite à « Mon compte »
(`2026-11-17-borne-mon-compte-design.md`) et au chantier des versions
(`2026-11-19-versions-et-erreurs-de-lecture-design.md`). Rien n'est codé.

## 1. Pourquoi

Rusmir, le 19/11/2026 : ce qu'il faut expliquer dans la borne, c'est surtout la partie « jeu » — rembobiner,
rendre plus tôt, laisser une critique — et l'expliquer **au moment de l'action, pas avant**. Le 20/11 il a écrit
« globalement pour le reste je suis tes recommandations » ; je l'ai lu comme son accord sur mes cinq
recommandations (c'est ma lecture, à confirmer par lui) : enchaîner les gains à la fin du film, pouvoir rendre un
film depuis « Mon compte », proposer le bonus de la semaine dans la borne, un écran « Mode d'emploi », et pas de
tutoriel en étapes à la première connexion.

### Ce que la borne fait aujourd'hui (lu dans le code le 20/11/2026)

- **On ne peut pas rendre un film depuis la borne.** Le seul endroit qui rend un film est la fiche d'une K7 dans le
  vidéoclub 3D (`VHSCaseOverlay.tsx:851`). « Mon compte » affiche les locations en cours avec « Regarder » et la
  ligne de critique, rien d'autre (`KioskAccount.tsx:93-112`). Le visiteur de la borne ne peut donc jamais gagner le
  crédit du retour anticipé.
- **Le bonus de la semaine n'existe pas dans la borne.** Son message n'est monté que dans le vidéoclub 3D
  (`InteriorScene.tsx:737`). La borne reçoit pourtant l'information à chaque lecture du compte
  (`app/api/me/route.ts:29`, `store/index.ts:505`) : elle ne s'en sert pas.
- **Le rembobinage et la critique sont déjà proposés à la fin du film**, dans le lecteur, qui est le même pour la
  borne et le vidéoclub : « BE KIND REWIND — Rembobiner avant de partir ? +1 crédit »
  (`VHSPlayer.tsx:1489-1511`), puis le rembobinage, pendant lequel le formulaire de critique s'affiche
  (`:1596-1661`).
- **Deux pièges muets dans cette fin de film** :
  - le rembobinage dure entre 2 et 3 minutes (`VHSPlayer.tsx:1072`) et le crédit n'est accordé **qu'à la fin**
    (`:1079-1086`). Fermer avant (la croix) arrête tout sans crédit (`:640-654`), et rien ne le dit ;
  - le bouton « PUBLIER (+1 CREDIT) » est grisé tant que la critique fait moins de 144 caractères (`:1653-1659`) :
    sur téléphone, un bouton grisé avale l'appui sans rien dire (règle du dépôt).
- **Après la fin du film, la borne ne dit rien.** Le lecteur se ferme et l'on retombe sur les rayons : ni bilan des
  crédits gagnés, ni proposition de rendre la K7.
- **« Crédits insuffisants » est une impasse** : « Ce film coûte 2 crédits. Vous en avez 1. » et un bouton
  « Fermer » (`KioskAction.tsx:146-148`), sans dire comment en regagner.
- **Aucun endroit de la borne n'explique les règles.** Le seul texte qui les donne est une étape du tutoriel du
  vidéoclub 3D (`TutorialOverlay.tsx:41-47`), et il est faux sur un point (§ 6).

## 2. Buts, hors périmètre, à éviter

**Buts**

- Chaque gain de crédit est proposé à l'endroit et au moment où il se gagne, avec ce qu'il rapporte et sa
  condition, en une ligne.
- À la fin d'un film, le visiteur voit d'un coup ce qu'il a gagné et ce qu'il peut encore gagner.
- Rendre une K7 se fait depuis la borne, en deux appuis, sans surprise sur le crédit.
- Le bonus de la semaine se reçoit depuis la borne, et il se propose de lui-même quand les crédits manquent.
- Un écran « Mode d'emploi », court, pour qui veut tout lire d'un coup. Personne n'est obligé d'y passer.
- Les textes qui donnent des chiffres (prix, durées, délais) sont tirés des mêmes constantes que les règles : ils
  ne peuvent plus dériver.

**Hors périmètre**

- Un tutoriel en étapes à la première connexion (écarté par Rusmir).
- Changer les règles elles-mêmes (prix, délais, montants) : ce document les explique, il ne les modifie pas.
- Le vidéoclub 3D : sa fiche de K7, son message de bonus et son terminal restent tels quels, à une ligne de texte
  près (§ 6).
- Prolonger une location (la route existe, `lib/rentals.ts:350-377`, la borne n'a pas de bouton) ; « demander un
  crédit » au gérant ; les demandes de retour entre visiteurs (`lib/rentals.ts:506-528`).
- L'animation de la K7 qui repart par la fente « retour des cassettes » (avec le robot, livraison 2 du lot 3).

**À éviter (ce serait un échec même si « ça marche »)**

- Un écran d'explications **avant** que le visiteur ait fait quoi que ce soit.
- Un gain présenté comme possible alors qu'il ne l'est plus (par exemple « +1 crédit » sur « Rendre » après les
  24 heures).
- Un retour qui fait perdre un autre crédit sans prévenir (le rembobinage devient impossible une fois le film
  rendu, § 4).
- Un bouton grisé qui avale l'appui ; un retour en un seul appui (rendre est définitif).
- Relancer le visiteur à chaque fermeture du lecteur : le bilan de fin de film ne s'ouvre qu'après une vraie fin.

## 3. Approches

| | Approche | Pour | Contre |
|---|---|---|---|
| **A — retenue** | Chaque gain là où il se gagne : le lecteur garde rembobinage et critique ; la borne ajoute un panneau « Film terminé » à la fermeture du lecteur, « Rendre » dans « Mon compte », le bonus dans « Mon compte » et dans « Crédits insuffisants » ; « Mode d'emploi » en référence | Répond à la consigne ; chaque morceau est petit et dans le style de son écran ; le lecteur partagé avec le vidéoclub change à peine | Deux écrans se suivent à la fin du film (le lecteur, puis le panneau de la borne) |
| B | Tout mettre dans l'écran de fin du lecteur : rembobinage, critique, retour, bilan | Un seul écran | Le lecteur est commun au vidéoclub et à la borne, et il a son propre style (magnétoscope), pas celui de la dalle ; rendre le film depuis le lecteur lui retire sa location pendant qu'il est ouvert ; le fichier fait déjà 1 740 lignes |
| C | Tout dans « Mon compte », rien à la fin du film | Très peu de code | Le visiteur doit penser à y aller : ce n'est pas « au moment de l'action » |
| D | Un tutoriel en étapes à la première connexion | Tout est dit une fois | Écarté par Rusmir ; lu avant d'avoir un film en main, donc oublié |

## 4. Les règles, telles qu'elles sont dans le code

Relevé du 20/11/2026. C'est ce que les écrans doivent dire, ni plus ni moins.

| Règle | Valeur | Où |
|---|---|---|
| Prix d'une location | 1 crédit ; 2 pour une nouveauté ; 1 pour un classique | `src/types/index.ts:60-64` |
| Durée d'une location | 72 h ; 48 h pour une nouveauté ; 7 jours pour un classique (rayon Classiques) | `src/types/index.ts:66-70`, `src/utils/rental-tier.ts:12-16` |
| Compte neuf | 5 crédits | `lib/schema.sql:7` |
| Rembobinage | +1 crédit, une fois par location, si le film est vu à 80 % au moins **et si la location est encore en cours** | `lib/rentals.ts:379-393` |
| Retour anticipé | +1 crédit si le film est rendu dans les 24 h **qui suivent la location** (pas la fin du film) | `lib/rentals.ts:471-504` |
| Critique | +1 crédit à la première publication ; 144 caractères au moins ; il faut avoir vu 80 % du film et que 80 % de sa durée se soient écoulés depuis le lancement ; reste possible après le retour | `lib/reviews.ts:204-211`, `src/utils/review-rules.ts:8`, `lib/review-eligibility.ts:41-54`, `lib/reviews.ts:107-112` |
| Bonus de la semaine | seulement sous 5 crédits ; jusqu'à 3 crédits, sans dépasser 5 ; une fois par semaine | `lib/bonus.ts:12-31` |

Trois conséquences qui pèsent sur la conception :

1. **L'ordre compte.** Un film rendu ne peut plus être rembobiné. La critique, elle, reste possible après le
   retour. L'ordre sans perte est donc : rembobiner, puis rendre ; la critique quand on veut. (Nuance lue dans le
   code : le rembobinage ne regarde que si la location est marquée en cours, pas son échéance,
   `lib/rentals.ts:380-383` ; le retour, lui, exige une location non échue, `:475-478`.)
2. **Le délai du retour anticipé part de la location.** Qui loue vendredi à 21 h 10 et regarde samedi à 22 h a
   déjà perdu ce crédit avant de lancer le film.
3. **La « semaine » du bonus change le dimanche à 0 h (temps universel)**, soit 1 h ou 2 h du matin à Paris, et
   non le lundi : rejoué le 20/11 sur le calcul de `lib/bonus.ts:3-10` (samedi 21/11 → semaine 46, dimanche 22/11
   → semaine 47). Même rejeu : autour du 1er janvier 2027 le calcul donne trois « semaines » en quatre jours
   (jeudi 31/12, vendredi 1er et samedi 2, dimanche 3), donc trois bonus possibles. Je n'y touche pas (hors
   périmètre) ; les textes disent « une fois par semaine » sans nommer de jour.

## 5. Conception, écran par écran

Les croquis sont des schémas de principe : le dessin final suit la dalle de la borne et sera montré en capture,
annoncé comme provisoire.

### 5.1 La fin du film, dans le lecteur

Le déroulé ne change pas : « BE KIND REWIND », le rembobinage, la critique pendant le rembobinage. Trois retouches
de texte et de comportement, dans le style actuel du lecteur :

- Pendant le rembobinage, la ligne d'état dit ce qu'on attend : **« +1 crédit à la fin du rembobinage · encore
  1 min 40 »** (à la place de « REMBOBINAGE EN COURS... » seul).
- Fermer **avant la fin** ne ferme plus en silence : « Arrêter le rembobinage ? Le crédit n'est accordé qu'à la
  fin. » — « Continuer » / « Arrêter ». Après la fin, la croix ferme comme aujourd'hui.
- « PUBLIER » ne se grise plus : sous 144 caractères ou sans les trois notes, l'appui dit ce qui manque (la règle
  existe déjà pour la borne, `src/utils/review-rules.ts`).

Ces retouches valent aussi pour le vidéoclub, puisque le lecteur est commun.

### 5.2 Le panneau « Film terminé », dans la borne

Quand le lecteur ouvert depuis la borne se referme **à la suite d'une vraie fin de film**, la borne relit le compte
et ouvre un panneau, à la place où s'ouvre « Votre K7 est prête ». Une vraie fin, c'est l'un de ces trois cas, et
aucun autre :

- le film est arrivé au bout sur l'appareil (c'est ce qui ouvre « BE KIND REWIND » tout seul) ;
- le film est arrivé au bout sur la télé ;
- le lecteur a été rouvert sur un film déjà vu à 100 %, ce qui repropose « BE KIND REWIND » à l'ouverture
  (`src/utils/cast-on-open.ts:49-51`).

**Ne compte pas** : STOP ou ÉJECTER en cours de film, même au-delà de 80 %. Le lecteur propose alors aussi « BE
KIND REWIND » (`VHSPlayer.tsx:518-520`, `:594-598`), mais le visiteur n'a pas fini son film : la borne ne lui
annonce pas « Film terminé ». Le lecteur doit donc dire à la borne **pourquoi** sa proposition s'est ouverte, pas
seulement qu'il se ferme.

Le panneau s'ouvre aussi à la fin d'un rembobinage lancé depuis la borne (voir plus bas).

```
            Film terminé
     2001 : L'Odyssée de l'espace

  ✓  Rembobiné                 +1 crédit
  ✓  Critique publiée          +1 crédit

  ┌──────────────────────────────────────┐
  │  RENDRE LA K7              +1 crédit │
  │  avant demain à 21:10                │
  └──────────────────────────────────────┘

  Vous avez 7 crédits
     Garder la K7           Mon compte ›
```

Chaque gain a une ligne, dans l'ordre où il faut les faire. Une ligne est soit **faite** (coche, et le crédit
gagné), soit **à faire** (un bouton), soit **impossible** (un texte avec sa raison, jamais un bouton) :

| Gain | Faite | À faire | Impossible |
|---|---|---|---|
| Rembobiner | « Rembobiné » · +1 crédit | bouton « Rembobiner la K7 » · +1 crédit — rouvre le lecteur sur « BE KIND REWIND » | (n'arrive pas : le panneau ne s'ouvre que pour un film vu à 80 % et encore loué) |
| Critique | « Critique publiée » · +1 crédit | bouton « Écrire ma critique » · +1 crédit — ouvre le formulaire de la borne | la raison du serveur, par exemple « Critique possible à partir du 20 novembre à 23:40 » |
| Rendre | (le panneau se ferme sur le résultat, § 5.4) | bouton « Rendre la K7 » · +1 crédit, « avant demain à 21:10 » | passé 24 h : le bouton reste, **sans** « +1 crédit », avec « le délai du crédit est passé » |

- « Rendre la K7 » est le bouton principal quand le rembobinage est fait ; sinon c'est « Rembobiner la K7 », et
  « Rendre » passe au second plan.
- « Garder la K7 » ferme le panneau : la location continue jusqu'à son échéance. Le geste retour fait de même.
- Le panneau ne s'ouvre **pas** quand on quitte un film en cours de route, ni au vidéoclub. Il s'ouvre une fois
  par fermeture ; tout ce qu'il propose se retrouve dans « Mon compte ».
- Après une critique écrite depuis ce panneau, on y revient, la ligne cochée.
- **Après un rembobinage lancé depuis la borne** (bouton « Rembobiner la K7 » de ce panneau ou de « Mon compte »,
  ou « Rembobiner » de la question « Rembobiner d'abord ? », § 5.4) : à la fin du rembobinage le lecteur se ferme
  de lui-même et l'on arrive sur ce panneau, la ligne « Rembobiné » cochée et « Rendre la K7 » en bouton principal.
  La borne ne retient pas une envie de rendre pendant les deux à trois minutes du rembobinage : le visiteur
  confirme le retour à ce moment-là. Aujourd'hui, un rembobinage qui n'a pas été ouvert par une fin de film laisse
  le lecteur sur son écran bleu (`VHSPlayer.tsx:648-653`) : ce cas se ferme désormais quand il vient de la borne.

### 5.3 « Mon compte » : rendre une K7

Chaque location en cours gagne un bouton « Rendre » et, tant que le crédit est encore gagnable, sa ligne :

```
◀ Retour
Mon compte                      Mode d'emploi ›
verif778804                          4 crédits

  Bonus de la semaine      [ RECEVOIR +1 crédit ]

EN COURS
[jaq] Get Out
      encore 1 j 23 h
      Rendue avant demain à 21:10 : +1 crédit
      Écrire ma critique              +1 crédit
                        [ Rendre ]  [ REGARDER ]

[jaq] Alien
      encore 5 h 12
      Vous devez regarder au moins 80 % du film
                        [ Rendre ]  [ REGARDER ]

[jaq] Heat                          (vu, pas rembobiné)
      encore 2 j 3 h
      Rembobiner la K7                +1 crédit
      Écrire ma critique              +1 crédit
                        [ Rendre ]  [ REGARDER ]

HISTORIQUE
  (inchangé)
```

- Une location vue à 80 % au moins et pas encore rembobinée gagne la ligne « Rembobiner la K7 » avec son
  « +1 crédit » : un appui ouvre le lecteur directement sur le rembobinage. Sans cette ligne, le visiteur qui a
  choisi « Garder la K7 » ou « ÉJECTER » n'aurait plus aucun chemin vers ce crédit, sauf à passer par « Rendre ».
- La ligne « Rendue avant … : +1 crédit » disparaît quand les 24 heures sont passées ; « Rendre » reste (rendre
  libère une copie pour les autres), sans promesse de crédit.
- L'heure limite vient du serveur avec la location (§ 7) : la borne n'a pas sa propre copie de la règle.
- Sur téléphone, les deux boutons d'une ligne passent sous le texte s'ils ne tiennent pas à côté ; zones d'appui
  de 44 px au moins, mesurées.

### 5.4 Confirmer un retour, et son résultat

Rendre est définitif (le film ne peut plus être regardé, le relouer coûte des crédits) : comme « LOUER », il ne
part jamais en un seul appui. La confirmation dit ce qui va se passer, d'après l'état de la location :

| Situation | Titre | Texte | Boutons |
|---|---|---|---|
| Dans les 24 h, film rembobiné ou pas encore vu à 80 % | Rendre la K7 ? | « Get Out » ne pourra plus être regardé. Rendue avant demain à 21:10 : +1 crédit. | Annuler · **Rendre** |
| Après 24 h | Rendre la K7 ? | « Get Out » ne pourra plus être regardé. Le délai du crédit de retour est passé. | Annuler · **Rendre** |
| Film vu à 80 %, pas rembobiné | Rembobiner d'abord ? | Une K7 rendue ne se rembobine plus : vous perdriez 1 crédit. | Rendre quand même · **Rembobiner** |
| La télé joue ce film | (une phrase de plus) | La télé s'arrêtera. | |

Le résultat est celui que **le serveur** répond (il est seul juge du délai) :

- crédit accordé : « K7 rendue — +1 crédit. Vous avez 5 crédits. » ;
- pas de crédit : « K7 rendue. » (et, si la borne promettait encore le crédit une seconde plus tôt : « Le délai de
  24 heures venait de passer. ») ;
- échec : « Le retour n'a pas abouti. Réessayez. » — la location reste en place.

**Un seul message quand la télé jouait le film.** Rendre retire la location, ce qui arrête la télé et affiche
aujourd'hui « Location terminée » (`cast-machine.ts:557-561`). Après un retour fait depuis la borne, ce second
message ne s'affiche pas : le visiteur lit seulement « K7 rendue … ». La télé s'arrête comme avant.

Après un retour, le compte est relu : la location passe dans l'historique avec « Rendu en avance · +1 crédit » ou
« Pas rendu en avance », comme aujourd'hui (`KioskAccount.tsx:126-131`).

### 5.5 Le bonus de la semaine

Trois endroits, du plus « au moment de l'action » au plus discret :

1. **« Crédits insuffisants »** — quand le visiteur appuie sur « LOUER » sans avoir assez de crédits :
   - bonus disponible : « Ce film coûte 2 crédits. Vous en avez 1. Votre bonus de la semaine vous en offre 3. » —
     « Fermer » / **« Recevoir 3 crédits »**. Une fois reçu, la borne enchaîne sur la confirmation habituelle de la
     location (« Confirmer la location … Il vous restera 2 crédits »). Dans tous les cas où le bonus existe, il
     suffit à payer le film (on est sous le prix, donc à 0 ou 1 crédit, et le bonus en donne alors 3) ;
   - pas de bonus : « Ce film coûte 2 crédits. Vous en avez 1. » — **« Fermer »** / « Comment en gagner », qui
     ouvre le « Mode d'emploi ».
2. **« Mon compte »** — sous le solde, une ligne « Bonus de la semaine » et son bouton **« Recevoir »** avec le
   montant, seulement quand le bonus est disponible. Après l'appui : « +3 crédits reçus », le solde est à jour.
3. **Le bouton « Compte »** de la barre du haut — quand un bonus attend, le montant s'ajoute au solde affiché :
   « Compte  2 crédits  +3 ». C'est le seul rappel qui ne demande aucune action ; il n'ouvre aucun message.

Pas de message qui surgit à l'ouverture de la borne (c'est ce que fait le vidéoclub, `WeeklyBonusToast.tsx`).

### 5.6 « Mode d'emploi »

Un seul écran, sans étapes, dans le style de « Mon compte ». Trois entrées : « Mon compte » (en haut à droite),
« Comment en gagner » du message « Crédits insuffisants », et un lien « Comment ça marche ? » dans le panneau de
connexion et d'inscription, pour qui n'a pas encore de compte.

```
◀ Retour
Mode d'emploi

LOUER
  Un film coûte 1 crédit, 2 pour une nouveauté.
  Vous le gardez 3 jours — 2 pour une nouveauté,
  7 pour un classique.
  Un nouveau compte démarre avec 5 crédits.

GAGNER DES CRÉDITS
  +1   Rembobiner la K7 à la fin du film,
       avant de la rendre
  +1   Rendre la K7 dans les 24 heures
       qui suivent la location
  +1   Écrire une critique
       (144 caractères au moins)
  +3   Bonus de la semaine, quand il vous reste
       moins de 5 crédits : de quoi remonter
       à 5, sans les dépasser

REGARDER
  Sur ce téléphone, ou sur votre télé
  avec Chromecast.
```

Tous les chiffres de cet écran sont produits par une fonction pure à partir des constantes des règles (§ 8) : si
un prix ou un délai change, l'écran suit, et un test le vérifie. « Sur ce téléphone » suit l'appareil, comme le
panneau « Où voulez-vous regarder ? ».

## 6. Ce que devient le tutoriel existant

- **La borne n'a pas de tutoriel et n'en aura pas.** Les explications sont dans les écrans ci-dessus.
- **Le tutoriel du vidéoclub 3D** (sept étapes avec le gérant, `TutorialOverlay.tsx`) reste tel quel, déclenché
  comme aujourd'hui à la première visite du vidéoclub (`InteriorScene.tsx:849-854`).
- **Une ligne de ce tutoriel est fausse et se corrige dans ce chantier** : son étape sur les crédits annonce
  « Bonus hebdomadaire (fidelite) +1 cr » (`TutorialOverlay.tsx:46`), alors que le bonus va jusqu'à 3 crédits et
  ne vaut que sous 5 crédits (`lib/bonus.ts:16-29`). Seule cette ligne change, dans l'écriture du tutoriel (sans
  accents, « cr ») : « Bonus hebdomadaire (moins de 5 credits) — jusqu'a +3 cr ». Le reste de l'étape, son ordre
  et sa phrase d'introduction ne bougent pas : la bulle est petite et son texte a été réglé pour elle.

## 7. Serveur : ce qui existe, ce qui manque

| Besoin | État |
|---|---|
| Rendre un film | **Existe** : `POST /api/rentals/[filmId]/return`, rend `{ earlyReturnCredit }` |
| Rembobinage | **Existe** : `POST /api/rentals/[filmId]/rewind` |
| Critique | **Existe** : `POST` / `PUT /api/reviews/[filmId]`, règle renvoyée par `GET /api/me` |
| Bonus de la semaine | **Existe** : `GET` / `POST /api/me/weekly-bonus` ; l'état arrive aussi dans `GET /api/me` (`weeklyBonus`) |
| Heure limite du retour anticipé | **Manque** : à ajouter sur **toute** location renvoyée par le serveur, là où elles sont toutes enrichies (`enrichRental`, `lib/rentals.ts:228-244`) — `GET /api/me`, mais aussi la réponse de la location elle-même, sinon le champ manquerait juste après avoir loué. Calculée par le serveur avec sa constante de 24 h. Sans cela la borne recopierait la règle |
| Crédits d'un compte neuf | **À rendre lisible** : les 5 crédits sont la valeur par défaut de la colonne (`lib/schema.sql:7`), l'inscription ne passe aucune valeur (`lib/auth.ts:44-47`). Une constante partagée, que l'inscription écrit explicitement et que le « Mode d'emploi » lit ; la valeur par défaut de la colonne reste, et un test vérifie qu'elles concordent |
| Raison d'un bonus indisponible | **À préciser** : aujourd'hui une phrase (« Solde >= 5 crédits », « Bonus déjà réclamé cette semaine »). Un code à côté de la phrase éviterait de décider sur un texte. Utile seulement si l'on affiche la raison ; cette conception n'affiche le bonus que lorsqu'il est disponible |
| Constantes partagées | **À regrouper** : les 24 h du retour et les montants du bonus sont des constantes locales du serveur (`lib/rentals.ts:471-472`, `lib/bonus.ts:16,29`). Le « Mode d'emploi » doit les lire au même endroit que le serveur, comme le font déjà les prix et la longueur minimale d'une critique |

Côté client, à corriger : l'action de retour du magasin retire la location et relit le solde, mais **ne relit ni
l'historique ni la règle des critiques** (`store/index.ts:596-617`). La borne relira le compte entier après un
retour.

Aucune règle de crédit n'est modifiée. Aucune table n'est ajoutée.

## 8. Contraintes

- Règles de la borne (`AGENTS.md`, « Borne de location ») : DOM pur sous `kiosk/`, dessin de la dalle, zones
  d'appui de 44 px au moins **mesurées** sur 360, 393 et 412 px de large, aucun bouton grisé, geste retour qui
  ferme ce qui est ouvert sans jamais quitter la borne (le panneau « Film terminé » et le « Mode d'emploi »
  entrent dans `kioskBackAction`).
- **Libellés** : l'action principale en capitales (feuille de style), les autres avec une majuscule ; **ni
  abréviation ni point médian dans un libellé** — le bouton dit l'action (« Rendre la K7 »), le gain est un
  élément à part (« +1 crédit »), comme le prix à côté de « LOUER ».
- Toute décision vit dans la logique pure et testée (`kiosk-logic.ts`, `node --test`) : ouverture du panneau,
  état de chaque ligne, variante de la confirmation, texte de l'heure limite, lignes du « Mode d'emploi ».
- `VHSPlayer.tsx` dépasse déjà le budget de taille : les retouches du § 5.1 sont minimes, tout le reste vit sous
  `kiosk/`.
- Tout nouvel écran est montré en capture, annoncé comme provisoire, avant d'être tenu pour validé ; le
  téléphone se juge sur le Pixel 9a.
- Commits locaux sur `feat/borne-location`, sans push. Rien n'est lancé sur la production.

## 9. Ordre de livraison

1. **Rendre depuis « Mon compte »** (§ 5.3, § 5.4, heure limite côté serveur) — c'est le seul gain aujourd'hui
   inaccessible depuis la borne.
2. **Fin de film** : retouches du lecteur (§ 5.1), puis panneau « Film terminé » (§ 5.2).
3. **Bonus de la semaine** (§ 5.5).
4. **« Mode d'emploi »** et correction de la ligne du tutoriel du vidéoclub (§ 5.6, § 6).

Lien avec le chantier des versions : son lot 2 corrige un défaut du lecteur (après un changement de version, la
fin du film ne déclencherait plus « BE KIND REWIND »). Tant qu'il n'est pas livré, le panneau « Film terminé » ne
s'ouvrirait pas non plus dans ce cas. Les deux chantiers touchent peu de fichiers communs ; l'ordre entre eux est
libre.

## 10. Recette sur le Pixel 9a

- Louer, lancer, aller à la fin : « BE KIND REWIND », rembobiner jusqu'au bout, écrire la critique pendant le
  rembobinage, fermer → le panneau « Film terminé » montre deux coches et « Rendre la K7 ». Rendre → « +1 crédit »,
  solde juste, film passé dans l'historique avec ses trois lignes.
- Même parcours en choisissant « ÉJECTER » : le panneau propose « Rembobiner la K7 » en premier ; « Rendre »
  ouvre « Rembobiner d'abord ? ».
- Fermer le rembobinage à mi-course : la question « Arrêter le rembobinage ? » s'affiche ; « Arrêter » ne donne
  pas de crédit.
- Film fini sur la télé, téléphone verrouillé : au retour, la barre « Film terminé » puis le même panneau.
- Location de plus de 24 h (date reculée dans la base locale) : aucune promesse de crédit nulle part ; le retour
  répond sans crédit.
- Bonus : compte à 1 crédit, film à 2 → « Recevoir 3 crédits » puis confirmation de la location ; compte à
  5 crédits → aucune mention du bonus ; bonus déjà reçu → aucune mention.
- « Mode d'emploi » depuis les trois entrées ; geste retour à chaque niveau ; zones d'appui mesurées.
- Vidéoclub 3D : la fin de film y garde son déroulé, sans panneau de la borne ; l'étape du tutoriel affiche le
  bon montant du bonus.

## 11. Arbitrages pris sans Rusmir (à corriger s'il n'est pas d'accord)

Chaque point : la situation, ce que j'ai choisi, pourquoi, et l'autre possibilité.

1. **Où se passe la fin du film.** Aujourd'hui, quand le film se termine, c'est le lecteur (l'écran façon
   magnétoscope) qui propose de rembobiner, puis d'écrire la critique pendant que la bande se rembobine. J'ai
   gardé cela tel quel, et j'ai ajouté **après**, une fois le lecteur refermé, un panneau de la borne intitulé
   « Film terminé » : il récapitule ce qui a été gagné et propose de rendre la K7. Pourquoi : le lecteur sert aussi
   au vidéoclub 3D, où l'on rend son film autrement, et rendre un film depuis le lecteur le fermerait sous les
   doigts du visiteur. L'autre possibilité : tout mettre dans l'écran de fin du lecteur, en un seul écran, mais au
   style du magnétoscope et commun au vidéoclub.

2. **Quand ce panneau « Film terminé » s'ouvre.** Exemple : Léa regarde un film jusqu'au générique, rembobine,
   ferme. Le panneau s'ouvre. Le lendemain elle rouvre le même film pour revoir une scène et le quitte au bout de
   dix minutes : le panneau ne s'ouvre pas. Autre exemple : Paul arrête son film à 85 % pour le finir demain ; le
   lecteur lui propose de rembobiner (il le fait déjà aujourd'hui passé 80 %), mais la borne ne lui annonce pas
   « Film terminé ». J'ai choisi de n'ouvrir le panneau qu'après une vraie fin (le film est arrivé au bout, sur
   l'appareil ou sur la télé), pour ne pas relancer le visiteur à chaque fermeture. L'autre possibilité : l'ouvrir
   à chaque fermeture d'un film déjà vu à 80 %, plus insistant.

3. **Rendre un film qu'on n'a pas rembobiné.** Une K7 rendue ne peut plus être rembobinée : c'est la règle
   actuelle du serveur. Exemple : Marc a vu son film en entier, a choisi « ÉJECTER » sans rembobiner, puis appuie
   sur « Rendre ». Au lieu de la confirmation habituelle, la borne demande « Rembobiner d'abord ? » et explique
   qu'il perdrait 1 crédit ; il peut rembobiner, ou rendre quand même. Pourquoi : sans cet avertissement, le geste
   qui rapporte un crédit en fait perdre un autre sans le dire. L'autre possibilité : changer la règle pour que le
   retour accorde aussi le crédit du rembobinage, ou pour qu'on puisse rembobiner après avoir rendu — c'est une
   décision sur les règles, que je n'ai pas prise.

4. **Rendre un film après les 24 heures.** Passé ce délai, rendre ne rapporte plus de crédit. J'ai gardé le
   bouton « Rendre » malgré tout, en écrivant clairement que le délai est passé. Pourquoi : chaque film n'existe
   qu'en peu de copies (deux par défaut), et un film rendu redevient disponible pour les autres visiteurs. L'autre possibilité :
   retirer le bouton après 24 heures, ce qui simplifie l'écran mais garde la copie bloquée jusqu'à l'échéance.

5. **Rendre demande toujours une confirmation.** Un appui sur « Rendre » ouvre « Rendre la K7 ? » ; il faut
   appuyer une seconde fois. Pourquoi : c'est définitif — le film n'est plus regardable et le relouer coûte des
   crédits — et la borne applique déjà cette règle à « LOUER ». L'autre possibilité : un retour en un appui, plus
   rapide, avec le risque d'un appui malheureux.

6. **Qui décide que le crédit du retour est accordé.** La borne affiche l'heure limite (« avant demain à
   21:10 »), mais c'est le serveur qui tranche au moment du retour, et le message de résultat répète sa réponse.
   Exemple : appui à 21:09 et 59 secondes, réponse du serveur à 21:10 et 1 seconde : la borne écrit « K7 rendue.
   Le délai de 24 heures venait de passer. » Pourquoi : deux horloges (le téléphone et le serveur) ne sont jamais
   exactement d'accord, et la borne ne doit pas promettre un crédit que le serveur refuse. L'autre possibilité :
   une minute de tolérance côté serveur, qui est un changement de règle.

7. **Où le bonus de la semaine se propose.** Le bonus de la semaine est un cadeau du vidéoclub : une fois par
   semaine, un visiteur qui a moins de 5 crédits peut en recevoir jusqu'à 3, sans dépasser 5. Je le propose à
   trois endroits : dans le message « Crédits insuffisants » (au moment exact où il sert), dans « Mon compte », et
   par un petit « +3 » à côté du solde sur le bouton « Compte ». Je n'ai **pas** repris le message qui surgit en
   haut de l'écran comme dans le vidéoclub 3D. Pourquoi : la consigne est d'expliquer au moment de l'action ; un
   message à l'ouverture arrive avant toute action. L'autre possibilité : le même message surgissant qu'au
   vidéoclub, que personne ne peut manquer mais qui interrompt.

8. **Après « Recevoir 3 crédits » dans « Crédits insuffisants ».** Exemple : Inès a 1 crédit, veut une nouveauté
   à 2 crédits, appuie sur « LOUER ». La borne lui propose son bonus ; elle l'accepte ; la borne enchaîne
   aussitôt sur « Confirmer la location … Il vous restera 2 crédits ». Pourquoi : elle venait pour louer ce film,
   il serait absurde de la renvoyer appuyer de nouveau sur « LOUER ». La location garde sa confirmation : rien ne
   se loue tout seul. L'autre possibilité : s'arrêter sur « +3 crédits reçus » et la laisser relancer.

9. **Qui peut lire le « Mode d'emploi ».** Je l'ai rendu accessible sans compte, par un lien « Comment ça
   marche ? » dans le panneau de connexion et d'inscription, en plus de « Mon compte ». Pourquoi : c'est avant de
   s'inscrire qu'on se demande ce que sont ces crédits. L'autre possibilité : seulement depuis « Mon compte »,
   comme demandé à la lettre, donc réservé aux visiteurs déjà inscrits.

10. **Ce que le « Mode d'emploi » ne dit pas.** Il ne parle ni de la prolongation d'une location, ni des demandes
    de retour entre visiteurs, ni de « demander un crédit » au gérant : la borne ne propose aucune de ces actions.
    Pourquoi : expliquer une chose qu'on ne peut pas faire depuis la borne enverrait le visiteur chercher un
    bouton qui n'existe pas. L'autre possibilité : tout lister, vidéoclub compris.

11. **Trois corrections faites au passage dans le lecteur.** (a) Pendant le rembobinage, l'écran dit que le
    crédit n'arrive qu'à la fin, et combien de temps il reste — aujourd'hui il dure deux à trois minutes sans le
    dire. (b) Fermer avant la fin demande confirmation, parce que fermer fait perdre le crédit. (c) Le bouton
    « PUBLIER » de la critique n'est plus grisé quand le texte est trop court : il répond en disant ce qui manque.
    Pourquoi : ce sont les trois endroits où le visiteur perd un crédit sans comprendre. Ces corrections se voient
    aussi au vidéoclub 3D, puisque le lecteur est le même. L'autre possibilité : ne pas toucher au lecteur et
    laisser ces trois défauts.

12. **La ligne fausse du tutoriel du vidéoclub.** L'étape « crédits » du tutoriel du vidéoclub 3D annonce
    « +1 » pour le bonus de la semaine alors qu'il va jusqu'à 3. Je corrige cette ligne, et elle seule, dans ce
    chantier, bien qu'elle soit hors de la borne. Pourquoi : une explication fausse est pire qu'aucune, et la
    correction tient en une ligne. L'autre possibilité : la laisser et n'y toucher que lors d'un chantier sur le
    vidéoclub.

13. **Le jour où la « semaine » du bonus recommence.** Le calcul actuel fait recommencer la semaine dans la nuit
    du samedi au dimanche (vers 1 h ou 2 h du matin, heure de Paris), et il se dérègle autour du 1er janvier
    (trois bonus possibles en quatre jours au passage à 2027). Je n'ai pas corrigé ce calcul et la borne écrit
    seulement « une fois par semaine », sans nommer de jour. Pourquoi : c'est une règle du serveur, hors de ce
    chantier. L'autre possibilité : corriger le calcul (semaine du lundi au dimanche, heure de Paris) et écrire
    « Prochain bonus lundi ».

14. **Rembobiner depuis « Mon compte ».** Exemple : Marc a vu son film, a choisi « ÉJECTER » puis « Garder la
    K7 ». Le lendemain, il ouvre « Mon compte ». J'ai ajouté sur sa location une ligne « Rembobiner la K7 » avec
    « +1 crédit », qui ouvre directement le rembobinage. Pourquoi : sans elle, ce crédit ne serait plus proposé
    nulle part, sauf au moment de rendre. L'autre possibilité : ne pas l'ajouter, et ne proposer le rembobinage
    qu'à la fin du film et au moment de rendre.

15. **Où l'on arrive après un rembobinage lancé depuis la borne.** Le rembobinage dure deux à trois minutes dans
    le lecteur. À la fin, le lecteur se ferme de lui-même et la borne ouvre le panneau « Film terminé » : la ligne
    « Rembobiné » est cochée, et « Rendre la K7 » est le bouton principal. Exemple : Marc voulait rendre, la borne
    lui a demandé « Rembobiner d'abord ? », il a rembobiné ; il retrouve « Rendre la K7 » sous le doigt et confirme.
    Pourquoi : il voit ce qu'il vient de gagner et ce qui reste à faire, au même endroit. L'autre possibilité :
    enchaîner directement sur « Rendre la K7 ? » sans repasser par le panneau, ou revenir à « Mon compte ».

16. **Rendre le film que la télé est en train de jouer : un seul message.** Rendre un film arrête la télé, et la
    borne affiche aujourd'hui « Location terminée » dans ce cas. Après un retour fait depuis la borne, je n'affiche
    que « K7 rendue », pas les deux messages à la suite. L'autre possibilité : garder les deux.

## 12. Questions que seul Rusmir peut trancher

1. **Le délai du retour anticipé part de la location, pas de la fin du film.** Qui loue le vendredi soir et
   regarde le samedi soir a perdu ce crédit avant même de lancer le film, et — pour respecter « au moment de
   l'action, pas avant » — la borne ne le lui dit que dans « Mon compte ». Trois issues : (a) on garde tout ainsi ;
   (b) on ajoute une ligne au panneau « Votre K7 est prête » (« Rendue avant demain à 21:10 : +1 crédit ») ;
   (c) on change la règle (par exemple 24 heures après le premier lancement du film).
2. **Rendre sans avoir rembobiné** : on prévient (mon choix, arbitrage 3), ou on change la règle pour que le
   crédit du rembobinage ne se perde pas ?
3. **Le calcul de la semaine du bonus** (arbitrage 13) : on le laisse, ou on le corrige dans ce chantier ?

## 13. Laissé au constructeur

Noms des fichiers, des fonctions et du champ ajouté à la location ; la forme du signal par lequel le lecteur dit à
la borne pourquoi il se ferme (vraie fin, rembobinage lancé depuis la borne, autre), et la façon dont la borne le
rouvre directement sur « BE KIND REWIND » ou sur le rembobinage (aujourd'hui
cette proposition ne revient d'elle-même à l'ouverture que pour un film vu à 100 %, `src/utils/cast-on-open.ts:49-51`) ;
mise en page exacte des lignes et des boutons dans le style de la dalle ; forme du texte de l'heure limite
(« aujourd'hui à », « demain à ») ; emplacement précis du lien « Comment ça marche ? » dans le panneau de
connexion ; code de raison du bonus, s'il est jugé utile.
