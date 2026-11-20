# Versions (VF / VOSTFR / VO) et erreurs de lecture — conception

Date : 19/11/2026, révisé le 20/11/2026 après la relecture de Rusmir (§ 7 refait, § 11 réécrit en clair) —
branche `feat/borne-location` — fait suite à la refonte du Cast (`2026-11-18-cast-refonte-design.md`).

## 1. Pourquoi

Rusmir veut que les visiteurs « ne se battent pas avec l'application ». Deux points les y obligent encore :

1. **Choisir sa version est confus, et impossible sur la télé.** Le lecteur démarre toujours en VF avec
   sous-titres français (`VHSPlayer.tsx:90-91`), rien n'est mémorisé d'un film à l'autre, le choix se fait sur deux
   rangées (VF/VO d'un côté, STFR/STEN de l'autre, `VHSControls.tsx:164-213`), et pendant un Cast la télécommande
   n'offre que les sous-titres : on ne peut pas passer de la VF à la VO.
2. **Un film qui ne se lance pas ne dit rien.** La vidéo locale n'a aucune gestion d'erreur : écran noir, sans
   message ni sortie. Exemple rapporté par Rusmir : « 2001 : L'Odyssée de l'espace », la VF ne se lance ni sur la
   télé ni sur le téléphone, sur le site en production.

### Constat sur les fichiers de production (lu le 19/11/2026)

Les 379 fiches publiques de production (`GET /api/films/[tmdbId]`) donnent `duration_sec`, qui est la durée **du
fichier VF** sondée par la chaîne 24/7 (`cinema-stream/src/playlist.ts:59-79`), et `runtime`, la durée annoncée par
TMDB. Pour 374 films les deux existent ; cinq ont un fichier VF nettement plus court que le film :

| Film | Fichier VF | Film (TMDB) | Ajouté le |
|---|---|---|---|
| The Revenant | 37,7 min | 157 min | 27/02/2026 |
| 2001 : L'Odyssée de l'espace | 68,5 min | 156 min | 12/02/2026 |
| Old Boy | 62,5 min | 120 min | 12/02/2026 |
| Le Seigneur des anneaux : Le Retour du roi | 127,7 min | 201 min | 12/02/2026 |
| The Murderer | 140,9 min | 157 min | 12/02/2026 |

C'est un indice fort, pas une preuve : la durée peut dater d'un ancien fichier, et un écart avec TMDB peut être un
autre montage (cinq films sont au contraire plus longs de 15 % ou plus, des versions longues). Mais « 2001 » est
dans la liste. Conséquence dans le code : la règle des critiques (`lib/review-eligibility.ts:30`) se sert de cette
durée. La fin estimée d'un Cast, elle, prend d'abord la durée lue sur la télé par le téléphone et ne retombe sur
`duration_sec` qu'en dernier recours (`lib/cast-session-store.ts:78-85`) : elle est peu touchée.

Même relevé : 370 films ont VF et VO, 9 n'ont que la VO, aucun n'a que la VF.

## 2. Buts, hors périmètre, à éviter

**Buts**

- Un seul réglage, compris sans réfléchir : **VF, VOSTFR, VO**.
- Aucune question avant le film ; le choix se voit et se change d'un appui. Une seule exception, voulue par
  Rusmir : quand le film n'a pas les sous-titres attendus, la borne demande « continuer ou passer en VF ? » (§ 4.1).
- Le même réglage, au même endroit et sous le même nom, dans la borne, le lecteur et la télécommande du Cast.
- La version préférée est un réglage du compte, que le visiteur règle lui-même dans « Mon compte » : l'application
  ne la déduit jamais de ce qu'il a regardé (décision de Rusmir du 20/11).
- Changer de version pendant un Cast fonctionne.
- La télécommande du Cast se manie comme celle d'un magnétoscope, avec les touches du lecteur (§ 7).
- Un film qui ne se lance pas le dit, propose une sortie en un appui, et laisse une trace côté serveur.
- Les fichiers défectueux se trouvent avant que les visiteurs tombent dessus.

**Hors périmètre**

- Récepteur Chromecast maison (décision du 17/11/2026) ; fichier unique à plusieurs pistes audio.
- AirPlay et l'iPad (chantier suivant).
- Réparer ou réencoder les fichiers défectueux ; toucher au pipeline de transcodage.
- Le mode d'emploi et les explications des crédits (document séparé).

**À éviter (ce serait un échec même si « ça marche »)**

- Une question « VF ou VO ? » à chaque lancement.
- Un bouton grisé qui avale l'appui (règle du dépôt) : une version absente est écrite, avec sa raison.
- Une substitution silencieuse : si la version demandée n'existe pas, l'écran dit laquelle joue.
- L'adresse de diffusion d'une location dans une trace ou un journal : c'est le secret de la location.

## 3. Approches

| | Approche | Pour | Contre |
|---|---|---|---|
| **A — retenue** | Un réglage « Version » à trois valeurs (+ « Autres versions »), le même partout, avec une version préférée que le visiteur règle dans « Mon compte » ; sur la télé, changer de piste audio recharge l'autre fichier à la même position | Un seul axe à comprendre ; marche avec le récepteur standard | Sur la télé, changer de piste audio passe par un rechargement, dont la durée n'est pas encore mesurée |
| B | Garder deux rangées (audio, sous-titres) et les ajouter à la télécommande | Peu de code | Deux axes ; « VOSTFR », le mot que les gens connaissent, n'existe nulle part |
| C | Demander la version avant chaque film | Choix toujours explicite | Une question de plus à chaque film ; contraire au but |
| D | Un fichier à deux pistes audio et un récepteur maison | Changement sans coupure | Écarté par décision ; d'après la documentation de Google, le récepteur standard ne gère que les pistes de texte |

Rusmir a validé A le 19/11/2026, choix par défaut compris.

## 4. Le réglage « Version »

### 4.1 Modèle

Un choix est un couple `{ audio: 'vf' | 'vo', subtitle: 'off' | 'fr' | 'en' }`. Trois couples ont un nom :

| Nom affiché | Couple | Sous-libellé |
|---|---|---|
| VF | `vf`, `off` | version française |
| VOSTFR | `vo`, `fr` | version originale, sous-titres français |
| VO | `vo`, `off` | version originale, sans sous-titres |

Une quatrième ligne de la liste, « Autres versions », ouvre les deux combinaisons plus rares, quand le film les
offre : **VF sous-titrée** (`vf`, `fr` — piste française avec les sous-titres français, utile aux malentendants)
et **VO, sous-titres anglais** (`vo`, `en`).

Une fonction pure décide de ce qui joue, à partir de ce qui est demandé et de ce que la location offre
(`streamingUrls` : `vf`, `vo`, `subtitles`, `subtitles_en`). Ce qui est demandé vient de trois sources, dans cet
ordre :

1. **le choix fait pour ce film** : un appui sur une version dans la liste. Il vaut pour ce film, y compris quand
   on le rouvre, tant qu'il est loué. Il ne touche pas au réglage du compte ;
2. **la version préférée du compte**, si le visiteur en a réglé une dans « Mon compte » (§ 4.2) ;
3. sinon **le choix par défaut** (décision de Rusmir du 19/11) : VF si elle existe ; sinon VOSTFR ; sinon VO avec
   les sous-titres anglais s'ils existent ; sinon VO.

Quand le film n'offre pas ce qui est demandé :

- **Piste audio absente** : VF absente → le choix par défaut ; VO absente → VF. L'écran l'écrit (« VOSTFR · VF
  indisponible pour ce film »), sans poser de question : il n'y a rien à choisir.
- **Sous-titres absents alors que la piste est la VO** (décision de Rusmir du 20/11) : la borne **demande**, une
  fois, avant que le film démarre. Exemple, version préférée VOSTFR, film sans sous-titres français :

  ```
     Ce film n'a pas de sous-titres français
        La VO existe avec des sous-titres anglais.

     [ Continuer en VO, sous-titres anglais ]
     [ Passer en VF ]
                     Retour
  ```

  « Retour » referme la question sans lancer le film ni rien retenir — décision de Rusmir du 20/11/2026.

  Si le film n'a aucun sous-titre : « Ce film n'a pas de sous-titres. » — « Continuer en VO sans sous-titres » /
  « Passer en VF ». La réponse vaut pour ce film (source 1) : la question n'est pas reposée à la réouverture. Si
  le film n'a pas de VF non plus, il n'y a rien à choisir : pas de question, la VO joue et l'écran écrit ce qui
  manque.
- **Sous-titres absents alors que la piste est la VF** (version préférée « VF sous-titrée », film sans sous-titres
  français) : la VF joue sans sous-titres et l'écran l'écrit. Pas de question.
- Une substitution ne modifie jamais le réglage du compte.

Les versions d'un film se comptent **par couple**, pas par piste audio : un film qui n'a que la VO mais des
sous-titres français offre VOSTFR et VO. Tout couple a un libellé affichable, y compris ceux sans nom
(« VF · sous-titres anglais »).

Un appui sur une version, ou les raccourcis clavier existants du lecteur (`VHSPlayer.tsx:754-765`, qui restent
tels quels et agissent chacun sur son axe), change la version **de ce film**. Rien de cela ne change la version
préférée du compte.

### 4.2 La version préférée, un réglage du compte

Décision de Rusmir (20/11/2026) : « l'habitude doit être une option à cocher dans son compte, pas quelque chose
qu'on met en place nous-mêmes ». La proposition précédente (retenir automatiquement le dernier choix) est
abandonnée.

- Dans « Mon compte » de la borne, une ligne « Version préférée » avec sa valeur. Un appui ouvre la même liste que
  partout (§ 4.3), précédée d'un premier choix, **« Automatique »** (« VF quand elle existe, sinon VOSTFR »), qui
  est la valeur d'un compte qui n'a rien réglé.

  ```
  Mon compte
  verif778804                          4 crédits

    Version préférée            Automatique ›
  ```

- Seul ce réglage modifie la préférence. Ni un choix fait sur un film, ni « Essayer en … » après une panne, ni la
  réponse à la question des sous-titres ne la changent.
- Stockage : deux colonnes sur `users` (`pref_audio`, `pref_subtitle`, nulles = « Automatique »), ajoutées par
  migration idempotente comme les autres (`lib/db.ts`). `GET /api/me` rend la préférence ; une route `PATCH` sous
  `/api/me` l'enregistre (session requise, valeurs validées). Le réglage dit s'il a bien été enregistré.
- Le choix fait pour un film (source 1 du § 4.1) est retenu sur l'appareil, par film, et s'efface quand la location
  se termine.

### 4.3 Où il apparaît

Un seul composant de liste et un seul module de logique pure, partagés par les trois endroits.

**a) Panneau de la borne** (`KioskReady`, « Votre K7 est prête » et « Où voulez-vous regarder ? ») : une ligne
entre l'échéance et les deux boutons. Elle ne pose pas de question ; elle montre et se change.

```
        Votre K7 est prête
     2001 : L'Odyssée de l'espace
       À rendre avant jeudi 20 h

   Version                    VF  ›
  ┌────────────────────────────────┐
  │ ▯  Sur ce téléphone            │
  │    le film démarre ici         │
  └────────────────────────────────┘
  ┌────────────────────────────────┐
  │ ▭  Sur ma télé                 │
  │    Chromecast                  │
  └────────────────────────────────┘
     Plus tard          Mon compte ›
```

Un appui sur la ligne remplace le contenu du panneau par la liste :

```
            Version
  ●  VF       version française
  ○  VOSTFR   version originale, sous-titres français
  ○  VO       version originale, sans sous-titres
     Autres versions ›
                               Retour
```

Une version absente du film n'est pas un bouton : c'est une ligne de texte estompée avec sa raison
(« VF · indisponible pour ce film »). Si le film n'offre qu'un seul couple, la ligne du panneau n'a pas de
chevron : « Version  VO · seule version de ce film ».

**b) Lecteur sur l'appareil** (`VHSControls`) : les boutons VF/VO et STFR/STEN laissent la place à un bouton
« Version » qui affiche le choix courant et ouvre la même liste. Le changement garde la position, comme
aujourd'hui (`VHSPlayer.tsx:263-298`). Les raccourcis clavier existants restent.

Défaut existant à corriger dans ce lot (lu dans le code, pas encore reproduit à l'écran) : la vidéo est remontée à
chaque changement de piste audio (`key`, `VHSPlayer.tsx:1351`), mais l'écouteur de fin de film (`:1000-1022`) et la
reprise à la position enregistrée (`:345-359`) restent attachés à l'ancien élément. Après un changement de version,
la fin du film ne déclencherait donc plus « BE KIND REWIND », et un changement fait avant la première image
repartirait de zéro. Après ce chantier, fin de film et reprise suivent l'élément courant, quel que soit le nombre
de changements.

**c) Télécommande du Cast** (`RemotePanel`) : le même bouton à la place de la rangée STFR/STEN.

- Changer **les sous-titres seulement** : sans coupure (`editTracksInfo`, déjà en place).
- Changer **la piste audio** : la télé recharge l'autre fichier **à la même seconde** (décision de Rusmir du 20/11,
  pas de retour en arrière), sur la séance déjà ouverte — jamais le sélecteur d'appareil. Rusmir attend une bascule
  instantanée ; la VF et la VO étant deux fichiers, la télé doit ouvrir l'autre, et la durée réelle de ce
  changement n'est pas encore mesurée (§ 10). Aujourd'hui la machine ignore une demande pour le film
  qu'elle joue déjà (`cast-machine.ts:338`) : il faut un événement dédié. La séance serveur reste la même.
- Si la nouvelle version ne se charge pas, la télé **reprend l'ancienne à la même position**, et un message le
  dit : « La VF ne se lance pas sur {télé}. Le film continue en VOSTFR. » Si l'ancienne échoue aussi, le message
  existant « Le film n'a pas pu démarrer sur {télé} » s'applique. Un seul repli, jamais de boucle.

Préalable : la recette de la refonte du Cast doit d'abord montrer que les sous-titres passent sur la vraie télé
(§ 10, en-tête CORS). Chaque chargement déclare les pistes de sous-titres (`cast-wire.ts:155-169`) : si la télé les
refusait, tous les chargements échoueraient, et la réponse serait à décider à ce moment-là (corriger l'en-tête du
stockage, ou ne déclarer les pistes que pour une version sous-titrée).

### 4.4 Lancement

Le panneau de la borne, le lecteur et « Sur ma télé » partent tous de la même décision (§ 4.1) : aujourd'hui le
Cast part en VF et français d'office (`store/slices/cast.ts:165`, `cast-wire.ts:80-84`), le lecteur aussi mais par
un autre chemin. Après ce chantier il n'y a plus qu'une source.

## 5. Quand le film ne se lance pas

### 5.1 Sur l'appareil

Deux situations, un même panneau dans le lecteur :

- **échec net** : le navigateur signale une erreur de chargement ou de décodage ;
- **rien ne vient** : 15 secondes après que la lecture a été voulue, la vidéo n'a toujours pas ses métadonnées. Le
  délai ne court pas tant que la vidéo est tenue à l'arrêt exprès (question « Où regarder ? », Cast en attente ou
  en cours, « BE KIND REWIND ») : pas de faux panneau d'erreur.

```
     Cette version ne se lance pas
   2001 : L'Odyssée de l'espace · VF

   [ Essayer en VOSTFR ]        ← seulement si une autre version existe
   [ Réessayer ]
   [ Retour ]
```

« Essayer en … » lance l'autre version à la même position, **sans changer la préférence enregistrée**. Le panneau
ne s'ouvre pas pendant un Cast de ce film (la vidéo locale est alors volontairement à l'arrêt).

Point d'attention pour le constructeur : la vidéo utilise un enfant `<source>` (`VHSPlayer.tsx:1390`) ; dans ce
montage, l'échec de chargement est signalé sur `<source>`, pas sur `<video>`. À vérifier dans le navigateur avant
de s'y fier.

### 5.2 Sur la télé

Le message « Le film n'a pas pu démarrer sur {télé} » existe (`cast-labels.ts:80`). Il gagne le bouton
« Essayer en … » quand une autre version existe.

### 5.3 Trace

Chaque échec (appareil ou télé, y compris un changement de version refusé) est envoyé au serveur : visiteur, film,
piste audio, lieu (`appareil` / `télé`), nature (`erreur`, `délai`, `chargement télé`), position, navigateur en
bref. **Jamais l'adresse du fichier.** Une table dédiée, une limite de débit, et une liste dans la page `/admin`
existante : films en échec, les plus récents d'abord, avec le nombre d'échecs par film et par version.

## 6. Contrôle des fichiers

Un script (`npm run media:check`), à lancer sur la machine qui héberge les fichiers. Pour chaque film disponible
et chaque version : le fichier existe, a une piste vidéo et une piste audio, s'ouvre, se décode sur ses dix
dernières secondes ; les durées de la VF et de la VO concordent entre elles (elles partagent la même vidéo) et ne
sont pas inférieures à 90 % de la durée TMDB.

- Par défaut il **ne fait que rapporter** (une ligne par anomalie, code de sortie non nul s'il y en a).
- Avec une option explicite, il marque la version défectueuse (deux drapeaux sur `films`). Une version marquée
  compte comme absente partout : `has_vf` / `has_vo` de la fiche, adresses de la location — la fiche l'écrit donc
  avant la location, et la décision du § 4.1 l'évite.
- Un film dont plus aucune version n'est jouable ne se loue pas : le serveur refuse la location (aucun crédit
  dépensé) et la fiche l'écrit. Le script ne touche pas à `is_available`.
- Il ne touche pas non plus à `duration_sec` : cette colonne appartient à la chaîne 24/7, qui ne lit que le fichier
  VF. La chaîne et le bot Discord sont hors périmètre ; qu'une VF marquée y reste diffusée est un point connu, à
  traiter à part.

Je ne lance rien sur la production : le script est livré, son exécution revient à qui déploie.

## 7. Télécommande du Cast : une télécommande de magnétoscope

Décision de Rusmir (20/11/2026) : la télécommande de la télé se manie comme celle d'un magnétoscope, avec les
mêmes touches que le lecteur. **Aucune barre pour choisir une position**, et plus de sauts de 15 secondes. (La
proposition précédente, une barre de temps que l'on fait glisser, est abandonnée.)

### 7.1 Ce qui change dans le panneau

Aujourd'hui (`CastPanels.tsx:203-243`) : le temps en chiffres, une barre qui se remplit, un pourcentage, et trois
boutons « −15s », lecture/pause, « +15s ».

Après :

```
        Téléviseur Pièce à vivre
      2001 : L'Odyssée de l'espace

          0:42:10 / 2:36:00
                FF x2

     [ ◀◀ ]      [ ▶ ]      [ ▶▶ ]
      BACK        PLAY        FF

   Volume  ────────●─────
   Version                 VOSTFR ›
   Retour     Sur ce téléphone     ⏹ Arrêter
```

- « −15s » et « +15s » laissent la place à **◀◀ (retour rapide)** et **▶▶ (avance rapide)**, avec le cycle du
  lecteur (`VHSPlayer.tsx:417-499`) : un appui = ×2, un deuxième = ×4, un troisième = lecture normale. La touche
  du milieu (lecture / pause) ramène aussi à la lecture normale.
- L'état s'écrit comme dans le lecteur (`VHSControls.tsx:116-117`) : « FF x2 », « REW x4 ».
- La barre et le pourcentage disparaissent. Le temps en chiffres reste : c'est le compteur du magnétoscope.
- Volume, « Version », « Retour », « Sur ce téléphone », « Arrêter » ne changent pas.

### 7.2 Comment la télé avance vite

Sur l'appareil, le lecteur accélère réellement la vidéo. Sur la télé ce n'est pas possible depuis une page web :
d'après la documentation de Google (lue le 20/11/2026), l'objet qui commande la télé (`chrome.cast.media.Media`)
offre lecture, pause, déplacement (`seek`), volume, arrêt et changement de sous-titres, et aucune méthode pour
changer la vitesse. L'avance et le retour rapides sont donc une **suite de sauts** :

- la télé est mise en pause ; le téléphone envoie un saut, attend que la télé l'ait fait, envoie le suivant ;
- la taille de chaque saut vaut la vitesse (2 ou 4) multipliée par le temps écoulé depuis le saut précédent — la
  méthode du retour rapide du lecteur (`VHSPlayer.tsx:462-495`). La bande défile donc à deux ou quatre fois le
  temps réel, quel que soit le temps de réponse de la télé ;
- à l'écran de la télé : des images fixes qui se succèdent, sans le son, comme la recherche par l'image d'un
  magnétoscope. La cadence réelle des images dépend de la télé et se mesure à la recette (§ 10).

Règles :

- Pendant le défilement, les trois touches restent actives. Aujourd'hui une commande en attente de réponse
  estompe les boutons et ignore l'appui (`CastPanels.tsx:186-193`) : cela ne doit pas empêcher d'arrêter.
- Retour rapide arrivé au début : arrêt en pause à zéro, comme dans le lecteur (`VHSPlayer.tsx:474-480`). Avance
  rapide arrivée à 10 secondes de la fin : le défilement s'arrête et la lecture normale reprend, pour que la fin du
  film se produise normalement.
- Si le téléphone se verrouille ou que la page passe à l'arrière-plan pendant le défilement, le défilement
  s'arrête et la lecture normale est demandée. La télé ne reste jamais dans un état intermédiaire.
- L'état du défilement vit dans la machine du Cast (pure, testée par `node --test`). La séance serveur reçoit la
  position à la fin du défilement, pas à chaque saut.

Conséquence assumée : à ×4, traverser une heure de film prend un quart d'heure. La reprise à la dernière position,
qui existe déjà, reste la manière normale de retrouver l'endroit où l'on s'était arrêté.

### 7.3 Taille des sous-titres sur la télé (confirmée)

Normal / Grand / Très grand, sur une ligne « Taille des sous-titres » placée sous « Version » dans la
télécommande. D'après la documentation de Google, le style du texte se change en cours de lecture avec le
récepteur standard. Retenu sur l'appareil.

## 8. Contraintes

- Règles de la borne (`AGENTS.md`, « Borne de location ») : DOM pur, dessin de la dalle, casse des libellés, zones
  d'appui d'au moins 44 px, aucun bouton grisé.
- La logique de décision est pure et testée par `node --test`, comme `kiosk-logic.ts` et `cast-wire.ts`.
- `VHSPlayer.tsx` est le fichier de **code** de l'écran de lecture (celui des touches PLAY / FF / STOP / EJECT), pas
  un modèle 3D. Le même lecteur sert à la borne et au vidéoclub (`src/App.tsx:690` et `:765`). Il fait 1 740 lignes
  alors qu'un test du dépôt limite un fichier de code à 1 000 lignes (`tests/architecture/file-size.test.mjs:8`) :
  c'est une limite de lisibilité du code, sans rapport avec le poids de la page pour le visiteur. Ce chantier ne
  l'alourdit pas : le nouveau code vit dans ses propres fichiers. Redécouper le lecteur est un chantier à part.
- Tout nouvel écran est montré en capture, annoncé comme provisoire, avant d'être tenu pour validé ; le téléphone
  se juge sur le Pixel.
- Commits locaux sur `feat/borne-location`, sans push.

## 9. Ordre de livraison

1. **Erreurs visibles et trace** (§ 5) — le silence est le pire défaut, et la trace sert tout de suite.
2. **Réglage « Version »** (§ 4) — modèle et mémorisation, puis panneau, lecteur, télécommande.
3. **Contrôle des fichiers** (§ 6).
4. **Télécommande de magnétoscope et taille des sous-titres** (§ 7).

## 10. À vérifier sur l'appareil (recette)

- Changement de piste audio sur la vraie télé : durée de la coupure, reprise à la bonne seconde.
- Avance et retour rapides sur la vraie télé : cadence des images pendant le défilement, vitesse réelle à ×2 et
  ×4 (chronométrée contre le compteur), reprise nette de la lecture, comportement quand le téléphone se verrouille.
- Sous-titres en Cast : la documentation de Google dit que l'en-tête CORS « * » n'est pas accepté quand des pistes
  sont déclarées, et notre stockage envoie « * ». Jamais vu sur la télé de Rusmir depuis la refonte.
- Taille des sous-titres : effet réel sur le vidéoprojecteur.
- Panneau d'erreur sur le Pixel, avec une adresse volontairement fausse.

## 11. Arbitrages pris sans Rusmir (à corriger s'il n'est pas d'accord)

Chaque point dit la situation, ce que j'ai choisi, et l'autre possibilité.

**Réponses de Rusmir du 20/11/2026** (le reste du document est aligné sur elles) :

| Point | Réponse |
|---|---|
| 11.1 « Autres versions » | D'accord, tant que ces deux versions restent sélectionnables. |
| 11.2 Sous-titres absents | **Changé** : la borne pose la question « continuer ou passer en VF ? » au lieu de choisir seule (§ 4.1). |
| 11.3 Reprise 3 secondes plus tôt | **Refusé** : reprise à la même seconde ; il attend une bascule instantanée (§ 4.3 c). |
| 11.4 « Essayer en … » ne change pas l'habitude | D'accord, et il va plus loin : la version préférée est un réglage que le visiteur fait lui-même dans son compte, jamais déduite (§ 4.2). |
| 11.5 Délai de 15 secondes | Pas de réponse : je garde 15 secondes, un seul nombre facile à changer. |
| 11.6 Outil de contrôle des fichiers | D'accord. |
| 11.7 Liste des échecs dans `/admin` | D'accord. |
| 11.8 Le compteur reste | D'accord. |
| 11.9 Télé en pause pendant l'avance rapide | Réexpliqué, puis **accepté** : « si oui on accepte, aucun souci » — l'avance rapide sur la télé est une suite d'images figées, sans le son, parce que le film y est joué par le lecteur standard de Google et non par notre page. |

Avec cette dernière réponse, **le document est approuvé** (20/11/2026). Suite : le plan d'exécution.

### 11.1 La ligne « Autres versions » de la liste

La liste « Version » montre trois choix : VF, VOSTFR, VO. Deux combinaisons plus rares existent aussi : la **VF
avec les sous-titres français** (pour une personne malentendante, ou quand on regarde sans le son) et la **VO avec
les sous-titres anglais**. Le lecteur actuel les permet déjà.

- **Mon choix** : ne pas les mettre dans la liste principale, mais derrière une quatrième ligne, « Autres
  versions › », qui les ouvre. La liste reste à trois choix pour presque tout le monde, et personne ne perd une
  possibilité qui existe aujourd'hui. Elles se choisissent comme les trois autres : pour un film, ou comme version
  préférée dans « Mon compte ».
- **L'autre possibilité** : cinq lignes d'emblée, ou supprimer ces deux combinaisons.

### 11.2 Le film n'a pas les sous-titres dont le visiteur a l'habitude

Exemple : un visiteur regarde toujours en VOSTFR, c'est retenu sur son compte. Il loue un film qui a bien la VO,
mais pas de sous-titres français ; seuls des sous-titres anglais existent. Que lance-t-on ?

- **Décision de Rusmir (20/11)** : la borne ne choisit pas seule, elle demande, une fois, avant que le film
  démarre : « Ce film n'a pas de sous-titres français. La VO existe avec des sous-titres anglais. » —
  « Continuer en VO, sous-titres anglais » / « Passer en VF ». La réponse vaut pour ce film ; la version préférée
  du compte ne change pas. Si le film n'a pas de VF, il n'y a rien à choisir : la VO joue et l'écran écrit ce qui
  manque.
- **Ce que j'avais proposé** : lancer la VO avec les sous-titres anglais sans rien demander, en l'écrivant à
  l'écran.

Cas inverse, plus rare : un visiteur a l'habitude de la « VF sous-titrée » et le film n'a pas de sous-titres
français. On lance la VF sans sous-titres (des sous-titres anglais sur une piste française n'aident personne), et
l'écran l'écrit.

### 11.3 Changer de version en cours de film sur la télé : reprise à la même seconde

La VF et la VO sont deux fichiers distincts. Quand on passe de l'une à l'autre pendant un film sur la télé, la
télé ferme un fichier et ouvre l'autre.

- **Décision de Rusmir (20/11)** : la reprise se fait exactement à la même seconde, sans retour en arrière. Il
  attend une bascule instantanée.
- **Ce que j'avais proposé** : reprendre trois secondes plus tôt, pour couvrir une coupure.
- **Ce qui reste à mesurer** : le temps que met la télé à ouvrir l'autre fichier. Si la recette montre une coupure
  gênante, je le lui montrerai avant de proposer quoi que ce soit.

### 11.4 La version préférée est un réglage du compte, jamais une habitude déduite

Exemple : un visiteur regarde toujours en VF. Sur un film, la VF ne se lance pas ; le panneau d'erreur propose
« Essayer en VOSTFR » et il appuie. Ce film joue en VOSTFR.

- **Décision de Rusmir (20/11)** : le film suivant repart en VF, et plus largement l'application ne retient
  **aucune** habitude d'elle-même. La version préférée est une option que le visiteur règle dans « Mon compte »
  (§ 4.2). Un choix fait sur un film ne vaut que pour ce film.
- **Ce que j'avais proposé** : retenir automatiquement, sur le compte, la dernière version choisie.
- **Mon choix dans ce cadre, à corriger si besoin** : le réglage se fait dans « Mon compte » de la borne. Le
  terminal du vidéoclub 3D n'a pas ce réglage dans ce chantier, mais le lecteur du vidéoclub respecte la version
  préférée réglée depuis la borne, puisque le compte est le même.

### 11.5 Combien de temps attendre avant d'annoncer que le film ne se lance pas : 15 secondes

Il arrive que le navigateur ne signale aucune erreur : rien n'arrive, simplement. Il faut décider au bout de
combien de temps on affiche « Cette version ne se lance pas ».

- **Mon choix** : 15 secondes. Plus court (8 secondes), une connexion lente déclencherait de fausses alertes ;
  plus long (30 secondes), le visiteur reste devant un écran d'attente sans savoir quoi faire.
- **L'autre possibilité** : une autre durée. C'est un seul nombre, facile à changer après les essais sur le Pixel.

### 11.6 L'outil qui contrôle les fichiers ne change rien tout seul

Cet outil passe en revue tous les films et vérifie chaque fichier. Il est lancé par la personne qui a accès aux
fichiers de production, pas par moi.

- **Mon choix** : par défaut, il se contente de **lister** les fichiers défectueux. Il ne marque une version comme
  « indisponible » que si on le lui demande explicitement ; le site cesse alors de la proposer (la fiche écrit
  « VF indisponible pour ce film », le film part en VOSTFR). Il ne retire jamais un film du catalogue. Si un film
  n'a plus aucune version jouable, le site refuse la location sans prendre de crédit, et la fiche le dit.
- **L'autre possibilité** : qu'il marque les versions tout seul à chaque passage, ou qu'il cache du catalogue les
  films défectueux.

### 11.7 Où lire la liste des films qui ne se sont pas lancés

Chaque fois qu'un film ne se lance pas chez un visiteur, une ligne est enregistrée (quel film, quelle version, sur
l'appareil ou sur la télé).

- **Mon choix** : cette liste se lit dans la page d'administration qui existe déjà (`/admin`), les échecs les plus
  récents en premier.
- **L'autre possibilité** : le panneau d'administration de la télé du vidéoclub 3D, ou une notification à chaque
  échec.

### 11.8 Télécommande : le compteur reste, la barre et le pourcentage disparaissent

Aujourd'hui la télécommande montre le temps en chiffres (« 0:42:10 / 2:36:00 »), une barre qui se remplit et un
pourcentage. Rusmir ne veut aucune barre pour choisir une position.

- **Mon choix** : retirer la barre et le pourcentage, garder le temps en chiffres. Un magnétoscope a un compteur,
  et c'est le seul repère pour savoir où l'on en est pendant une avance rapide.
- **L'autre possibilité** : garder la barre en simple affichage (on ne peut pas la toucher), ou tout retirer.

### 11.9 Télécommande : sur la télé, l'avance rapide est une suite d'images fixes, sans le son

Sur le téléphone, quand on appuie sur ▶▶, le film défile en accéléré : l'image bouge vite, en continu. La télé ne
sait pas faire cela à la demande d'une page web (§ 7.2) ; la seule chose qu'on peut lui demander, c'est « va à tel
endroit du film ».

Ce que l'on verra sur la télé en appuyant sur ▶▶ : le film s'arrête sur une image, sans le son. Environ une
seconde plus tard, cette image est remplacée par une autre, prise quelques secondes plus loin dans le film ; puis
une autre encore, et ainsi de suite. Le compteur de la télécommande avance en même temps. Quand on appuie sur ▶,
le film repart normalement, avec le son, depuis la dernière image affichée. C'est cela, « la télé en pause » :
entre deux sauts l'image est **figée**, elle ne joue pas.

- **Mon choix** : image figée entre les sauts, sans le son, au rythme de deux ou quatre fois le temps réel. Si le
  téléphone se verrouille pendant ce temps, la lecture normale reprend. L'avance rapide s'arrête d'elle-même dix
  secondes avant la fin du film.
- **L'autre possibilité** : laisser le film jouer entre deux sauts. On verrait de courts morceaux de film et l'on
  entendrait des bribes de son hachées. Une vraie accélération, image en continu comme sur le téléphone,
  demanderait un récepteur Chromecast maison, écarté par décision.
- **Ce que je ne sais pas encore** : la cadence réelle des images sur le vidéoprojecteur (une par seconde, ou
  moins). Je l'essaierai sur l'appareil avant de construire le reste de la télécommande, et je montrerai le
  résultat.

## 12. Laissé au constructeur

Forme des commandes d'avance et de retour rapides dans la machine du Cast, et cadence d'envoi des sauts ;
noms des fichiers, des colonnes et des routes ; forme de l'événement de changement de version dans la machine ;
mise en page exacte de la liste dans le lecteur et la télécommande (dans le style existant de chacun) ; libellé
d'un film dont la langue originale est le français, si l'information est sous la main (sinon « VO »).
