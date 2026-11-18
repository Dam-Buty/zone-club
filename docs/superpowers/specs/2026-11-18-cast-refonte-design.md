# Refonte du Cast : un service unique, un seul état — conception

- **Date** : 18/11/2026
- **Statut** : approche choisie par Rusmir le 18/11/2026 (« ok go pour cette approche… on veut quelque chose de
  robuste et fiable ») ; **document validé par Rusmir le 18/11/2026**
  (« ok je valide tout go pour ce plan »), choix marqués [C] compris
- **Base** : branche `feat/borne-location` (HEAD `cd61350`)
- **Marques** : **[R]** dit par Rusmir · **[M]** mesuré sur le Pixel 9a et le vidéoprojecteur le 18/11 ·
  **[C]** mon choix, à corriger s'il ne convient pas

## 1. Intention

**[R]** « Le but, c'est que l'ergonomie du Cast soit parfaite, de manière à ce que les visiteurs reviennent et ne se
battent pas avec l'application. » « Je pense que plusieurs choses se chevauchent. » « On veut quelque chose de robuste
et fiable. »

L'audit du 18/11 lui donne raison : le Cast démarre, puis casse dès qu'on ferme et rouvre le lecteur, et le visiteur
reste coincé sans autre issue que recharger la page.

## 2. Ce qui a été mesuré (Pixel 9a, Chrome 157 → « Téléviseur Pièce à vivre », récepteur standard)

Outils, journaux et captures : `.superpowers/sdd/2026-11-18-audit-cast/` (ignoré par git). L'état de la TV a été lu sur
l'appareil lui-même (`tv.py`), pas déduit du téléphone.

| # | Constat **[M]** | Cause dans le code |
|---|---|---|
| D1 | Après fermeture puis réouverture du lecteur, pause/arrêt n'atteignent plus la TV ; le SDK dit toujours « connecté » et le temps avance (extrapolé). « Arrêter » et « Sur le tel » ne font rien, la fin du film n'est jamais vue, « Regarder sur TV » tourne 6 s puis revient en pause sans message. Seule issue : recharger. | `useGoogleCast` rappelle `context.setOptions()` à chaque ouverture (`src/hooks/useGoogleCast.ts:288`). Prouvé : `setOptions` rappelé à la main, lecteur ouvert, suffit à couper les commandes. `remoteStop()` lève alors une exception avant le nettoyage (`VHSPlayer.tsx:567`, `:967`). |
| D2 | Réouverture pendant un Cast bloquée sur « Connexion à… » (plus de 40 s, TV en lecture). « Annuler » fait apparaître la télécommande, par accident. | L'auto-détection sort dès `awaitingCast` (`VHSPlayer.tsx:365`) ; le délai de 6 s se croit déjà confirmé (`:402-416`). |
| D3 | Le délai de 6 s court pendant que le visiteur choisit son appareil : l'écran d'attente disparaît sous le sélecteur ouvert. | Même délai, armé dès l'entrée en attente. |
| D4 | Fin du film sur la TV, liaison saine : pas de « BE KIND REWIND », location restée à 99 %, séance serveur close (donc pas de fin estimée non plus). | À la fin, le SDK remet durée et position à 0 dans le même lot que `IDLE` ; le lecteur conclut à un arrêt manuel (`VHSPlayer.tsx:1222-1261`). |
| D5 | Séance serveur refusée (400) quand le Cast part avant que la vidéo locale connaisse sa durée (TV déjà connectée) : aucun suivi serveur de ce visionnage. | `durationSeconds: 0` envoyé (`VHSPlayer.tsx:942-944`), refusé par `app/api/cast-sessions/route.ts:20`. |
| D6 | Après rechargement de page (ou onglet déchargé par Android) : pas de puce ; la séance est reprise mais le SDK ne connaît pas le film en cours ; rouvrir le film le lance aussi sur le téléphone, avec le son ; « Regarder sur TV » relance le film en arrière. | `activeCastFilmId` n'existe qu'en mémoire ; le SDK n'est initialisé qu'à l'ouverture du lecteur ; `autoPlay` de la vidéo locale. |
| D7 | Sélecteur refermé = « Google Cast n'est pas disponible » + panneau « MODE MIROIR » ; bouton ▶ alors que la TV joue ; curseur de volume à 1 (TV à 0,28) ; fenêtre native « Arrêter la diffusion » ouverte quand une séance existe déjà ; puce « Télécommande » posée sur les K7 de la borne ; pas de retour à la borne depuis la télécommande ; film lancé en local sous l'invite « Regarder sur TV ? » ; le récepteur reste lancé sur la TV après « Arrêter » ; deux séances serveur créées à 30 ms d'écart. | Chemins d'erreur communs, états initiaux codés en dur, `requestSession` appelé pendant la reprise automatique, etc. |

Trois faits vérifiés pour la solution **[M]** :

- **F1** — si `setOptions` n'est transmis qu'une fois, la télécommande obéit encore après fermeture et réouverture du
  lecteur (pause puis lecture vues sur la TV).
- **F2** — après un rechargement, `setOptions` au démarrage reprend la séance en quelques millisecondes
  (`SESSION_RESUMED`) mais sans média ; un message `GET_STATUS` sur `urn:x-cast:com.google.cast.media` fait revenir le
  film en cours (état, position, durée, titre) en moins d'une seconde.
- **F3** — à la fin du film, l'écouteur de la séance média (`Media.addUpdateListener`) reçoit `IDLE` avec
  `idleReason: "FINISHED"`, durée encore lisible sur l'objet média. C'est le signal de fin.

Autres faits **[M]** : Chrome gèle la page 60 s après son passage en arrière-plan et la reprend au retour, séance
intacte ; `endCurrentSession(true)` libère bien la TV ; les appuis sont à simuler par `adb shell input tap`.

## 3. Buts, hors périmètre, à ne jamais faire

**Buts**

1. La télécommande dit la vérité et obéit tant que la séance vit. Si la liaison meurt, le lecteur le voit, le dit, et
   propose une issue.
2. Aucun écran sans sortie, aucune panne silencieuse.
3. Le Cast survit à la fermeture du lecteur, au passage en arrière-plan, au rechargement de la page.
4. La fin du film sur la TV est reconnue : location à 100 %, « BE KIND REWIND » proposé.
5. Le serveur suit chaque visionnage sur la TV, téléphone présent ou non (approche A du 17/11, inchangée).
6. Les défauts d'ergonomie D7 disparaissent.

**Hors périmètre**

- Récepteur Chromecast maison : **jamais [R]** (décision du 17/11).
- AirPlay et l'iPad : chantier suivant. Ici, seulement ne rien casser (le chemin AirPlay du lecteur reste tel quel).
- L'abonnement aux notifications (« film terminé ») : toujours pas branché côté client ; signalé, non traité ici.
- La scène 3D, la borne hors de sa puce, le pipeline média.

**À ne jamais faire**

- Le film qui joue à la fois sur le téléphone et sur la TV.
- Une télécommande qui affiche un état que la TV n'a pas.
- Traiter un geste du visiteur (sélecteur refermé) comme une panne.
- Un second appel à `setOptions`, où que ce soit.

## 4. Approches

| Approche | Verdict |
|---|---|
| **A. Service Cast unique + machine à états + état dans le store** (ci-dessous) | **Retenue [R]** |
| B. Rustines dans `VHSPlayer` : garder le hook, ne plus rappeler `setOptions`, corriger chaque effet | Écartée **[C]** : corrige D1 mais laisse cinq effets et deux gestionnaires écrire le même état ; D2, D3, D4 viennent de ce chevauchement, et D6 est impossible tant que le SDK ne vit que lecteur ouvert. |
| C. Remonter le hook tel quel dans `App.tsx` | Écartée **[C]** : règle la durée de vie, pas le chevauchement ; l'état resterait éparpillé entre hook, composant et store. |

## 5. Conception

### 5.1 Le service (`src/cast/`, sans React)

Un module, une instance pour toute l'application.

- **Initialisation unique**, idempotente, lancée à l'entrée dans la borne ou le vidéoclub (là où le SDK est
  préchargé aujourd'hui, `App.tsx:430-440`) : charge le SDK, appelle `setOptions` **une fois**, crée **un**
  `RemotePlayer` et **un** `RemotePlayerController`, pose ses écouteurs pour toute la vie de la page.
- **Reprise** : sur `SESSION_STARTED` / `SESSION_RESUMED`, si aucune séance média n'est connue, envoie `GET_STATUS`
  (F2). Le film est reconnu par `mediaInfo.customData = { filmId, rentalId }`, posé au chargement **[C]**.
- **Commandes avec accusé** : lecture/pause, saut, volume, arrêt passent par la séance média
  (`chrome.cast.media.Media`, rappels de succès et d'échec), chacune dans un `try/catch` et avec un délai. Une
  exception, un échec ou un délai dépassé ne casse rien : la liaison est marquée douteuse.
- **Surveillance de la liaison** : pendant un Cast, page visible, un `GET_STATUS` accompagne l'envoi périodique de
  position ; au retour d'arrière-plan (`visibilitychange`, `resume`), un `GET_STATUS` immédiat. Sans réponse dans le
  délai : état « liaison perdue ».
- **Fin du film** : `idleReason === 'FINISHED'` (F3). Repli si le signal manque : dernière position connue ≥ 95 % de
  la dernière durée connue, toutes deux mémorisées **avant** la remise à zéro du SDK.
- **Suivi serveur** porté par le service, plus par le lecteur : création de la séance au chargement, position toutes
  les 10 s (progression de la location + séance de Cast), à la mise en arrière-plan, à la fin. Il tourne donc aussi
  lecteur fermé, tant que la page vit.

### 5.2 La machine à états (fonction pure, testée)

Une seule fonction `(état, événement) → état + effets à lancer`, sans import, chargée telle quelle par `node --test`
comme `cast-on-open.ts` aujourd'hui.

| État | Ce que voit le visiteur | Sorties |
|---|---|---|
| `indisponible` | SDK absent (navigateur sans Cast) : le bouton TV explique et propose la recopie d'écran | — |
| `repos` | lecteur local normal | « Regarder sur TV » → `choix` (ou `chargement` si une séance existe déjà) |
| `choix` | sélecteur natif ouvert ; **aucun délai** | appareil choisi → `connexion` ; sélecteur refermé → `repos`, **sans message** |
| `connexion` | « Connexion à <nom>… » + Annuler | séance ouverte → `chargement` ; échec ou 20 s → `repos` + message + Réessayer |
| `chargement` | « Lancement du film sur <nom>… » + Annuler | média en lecture → `telecommande` ; échec ou 20 s → `repos` + message |
| `telecommande` | panneau de télécommande, état réel de la TV | Arrêter, Sur ce téléphone, Retour (la TV continue), fin du film, liaison perdue |
| `termine` | « BE KIND REWIND » (lecteur ouvert) ou puce « Film terminé » (lecteur fermé) | rembobiner, éjecter |
| `liaison perdue` | « La télé ne répond plus » + Réessayer · Continuer sur ce téléphone · Fermer | reprise réussie → `telecommande` ; sinon au choix du visiteur |

Les délais (20 s, délai d'accusé, cadence de surveillance) sont des constantes nommées, au choix de l'exécutant,
à valider sur l'appareil.

### 5.2 bis Cas limites (issus de la relecture du document, tous **[C]**)

- **Retour après un gel de la page** (téléphone verrouillé, Chrome en arrière-plan) et **rechargement** : le service
  redemande le statut à la TV **et** relit la location sur le serveur. Média présent → `telecommande`. Plus de média,
  location à 100 % (fin vue par la TV avant le gel, ou fin estimée par le serveur) → `termine`. Plus de média,
  location sous 100 % → `repos`, lecteur en pause à la dernière position enregistrée. Que `FINISHED` arrive ou non
  après le dégel n'a pas été mesuré : la décision ne s'appuie pas dessus (à relever dans la recette, point 11).
- **Arrêt venu d'ailleurs** (télécommande de la TV, notification Cast d'Android, menu Cast de Chrome, autre
  application lancée sur la TV : `IDLE` autre que `FINISHED`, ou fin de séance non demandée) → `repos`, avec une
  ligne neutre « La diffusion sur <nom> s'est arrêtée », lecteur **en pause** à la dernière position connue,
  séance serveur close à cette position. Erreur de lecture côté TV (`ERROR`) : même arrivée, message « La télé n'a
  pas pu lire le film » + Réessayer. La lecture locale n'est **jamais relancée d'office** (aujourd'hui elle l'est,
  `VHSPlayer.tsx:1302-1310`) : le visiteur n'est peut-être plus devant son téléphone.
- **Liaison perdue** : la séance serveur **reste ouverte** (la TV joue sans doute encore, l'estimation continue).
  « Continuer sur ce téléphone » tente d'arrêter la TV, clôt la séance serveur, puis lance la lecture locale à la
  dernière position — sinon le vérificateur remettrait la location à 100 % en plein visionnage. Lecteur fermé, la
  puce dit « La télé ne répond plus » et ouvre ce panneau.
- **Location qui disparaît pendant un Cast** (échéance, retour, déconnexion du compte) : le service arrête le film
  sur la TV, termine la séance, retire la puce et laisse une ligne « Location terminée ». En production la vidéo
  cesse de toute façon d'être servie à l'échéance. La télécommande n'existe donc jamais sans location.
- **Page `/admin`** (prévisualisation, lecteur monté hors de `App`, location synthétique) : le Cast y reste
  disponible. L'initialisation du service est idempotente et le lecteur la demande aussi à son montage (filet de
  sécurité : une seule initialisation réelle quel que soit l'appelant). Sans location réelle : aucun suivi serveur,
  `customData` sans `rentalId` (aujourd'hui une prévisualisation crée une séance que le vérificateur « complète »
  sur une vraie location de l'administrateur).
- **Origine du lecteur** : `openPlayer` reçoit d'où l'on vient (borne ou vidéoclub) ; l'en-tête, aujourd'hui
  « RETOUR VIDÉOCLUB » en dur (`VHSPlayer.tsx:1519`), et le bouton « ← Retour » de la télécommande en tirent leur
  libellé.

### 5.3 Le store

Une tranche `cast` (fichier à part, comme `slices/manager.ts`) : état de la machine, nom de l'appareil, film,
position, durée, pause, volume. `activeCastFilmId` en devient une valeur dérivée, pour ses lecteurs actuels
(`VHSCaseOverlay`, `ActiveCastIndicator`). Position rafraîchie au plus une fois par seconde.

### 5.4 Le lecteur (`VHSPlayer.tsx`)

- Il **lit** la tranche `cast` et **demande** (lancer, pause, saut, arrêter, basculer) : plus aucun effet n'écrit
  l'état du Cast. Disparaissent : l'auto-détection, le délai de 6 s, la détection d'arrêt distant, la déconnexion
  inattendue, `castFilmIdRef`, `castDurationRef`, `lastKnownCastTimeRef`, `wasCastConnectedRef`. Le hook
  `useGoogleCast` est supprimé.
- **Vidéo locale** : jamais lancée tant que la machine n'est pas en `repos` pour ce film, ni tant que l'invite
  « Regarder sur TV ? » attend une réponse **[C]**. Quand la TV joue déjà ce film (reprise), le lecteur s'ouvre
  directement en télécommande.
- **Depuis le panneau « Votre K7 est prête »**, le visiteur a déjà choisi (« Sur ce téléphone » / « Sur ma
  télé ») : pas d'invite **[C]**. Sélecteur refermé ou Cast raté depuis « Sur ma télé » : lecteur en pause avec
  l'invite, pour réessayer ou regarder ici.
- **Les deux autres entrées de la borne** ouvrent le lecteur sans choix préalable : « REGARDER » sur un film déjà
  loué (`KioskAction.tsx:131-133`) et « Mon compte » (`KioskView.tsx:605`). Elles montrent le panneau de la borne
  « Où voulez-vous regarder ? », le même qu'après une location, sans la ligne « Votre K7 est prête » (proposition
  faite à Rusmir le 18/11, validée avec le reste : « je valide tout »). L'invite du lecteur ne sert donc plus
  qu'au vidéoclub, et après un Cast raté ou refermé. Dans tous les cas la vidéo locale attend la réponse.
- Un film **différent** de celui que joue la TV : lecteur local normal, avec un bandeau « <titre> est en cours sur
  <nom> » ; « Regarder sur TV » remplace le film de la TV après confirmation **[C]**.
- Sous-titres en Cast : la séance média vit dans le service, donc la bascule STFR/STEN marche aussi après
  réouverture (aujourd'hui : erreur « Aucun média Cast actif », lue dans le code, non observable avec le seed).
- Bureau : Échap pendant un Cast ferme le lecteur, la TV continue (aujourd'hui : arrête la TV sans clore la séance).

### 5.5 Ergonomie (D7)

1. Sélecteur refermé : retour silencieux. Le panneau « recopie d'écran » ne sort que si le Cast est réellement
   indisponible, avec un texte qui le dit.
2. Bouton lecture/pause et curseur de volume alimentés par l'état réel de la TV ; grisés pendant qu'une commande
   attend son accusé.
3. `requestSession` jamais appelé quand une séance existe ou est en cours de reprise (plus de fenêtre native
   parasite).
4. La télécommande gagne un bouton « ← Retour » (le film continue sur la TV) ; son libellé suit l'origine (borne ou
   vidéoclub), comme celui de l'en-tête du lecteur.
5. **« Arrêter » arrête le film ET termine la séance** : la TV revient à son accueil **[C]**. « Sur ce téléphone »
   fait de même puis reprend ici à la même position. En fin de film, la séance reste ouverte (le film suivant part
   sans repasser par le sélecteur) **[C]**.
6. Puce « Télécommande » : dans la borne, redessinée dans le langage de la borne et placée sans recouvrir la rangée
   de K7 ; présentée à Rusmir sur capture avant d'être retenue (visuel **provisoire** jusque-là) **[C]**. Dans le
   vidéoclub, inchangée.
7. Messages d'erreur en français, avec l'action possible ; plus de message technique du SDK à l'écran.

### 5.6 Serveur

- `POST /api/cast-sessions` : `durationSeconds` devient facultatif ; absent ou nul, le serveur prend
  `films.duration_sec` ; 400 seulement si aucune durée n'existe **[R : « durée du film en base »]**.
- `PATCH` accepte `durationSeconds` : le téléphone corrige avec la durée réelle annoncée par la TV dès qu'il la
  connaît (dans la base de seed, la durée du film et celle de la vidéo de test diffèrent : ~110 min contre 10 min).
- `POST` sur une location qui a déjà une séance ouverte : mise à jour de cette séance, pas une seconde ligne.
- Le vérificateur clôt (`ended = 1`) la séance qu'il vient de compléter : plus de réécriture en boucle.
- Fin vue par le téléphone : progression 100 %, position 0, séance close — même résultat que la fin estimée par le
  serveur (`completeCastRental`).
- Rien d'autre ne change : l'estimation par l'horloge et ses limites acceptées le 17/11 restent.

## 6. Vérification

**Tests automatiques** (`node --test`, dans `test:phase`)

- La machine à états : une table de transitions, avec un cas par défaut D1 à D6 (réouverture, délai pendant le
  choix, fin `FINISHED`, fin sans signal, reprise après rechargement, commande sans accusé).
- Le serveur : création sans durée, correction de durée, pas de doublon, clôture après complétion (base en mémoire,
  comme `cast-completion.test.mjs`).
- Garde statique : `setOptions(` n'apparaît qu'une fois dans `src/` ; `VHSPlayer.tsx` ne touche plus au SDK.

**Recette sur le Pixel 9a + vidéoprojecteur** (build de production, outils de l'audit, état lu sur la TV)

1. « Sur ma télé » depuis la borne : sélecteur, choix après plus de 10 s, lecture.
2. Sélecteur refermé : retour silencieux, invite présente.
3. Pause, lecture, ±15 s, volume : vus sur la TV ; bouton et curseur justes.
4. Geste retour : la TV continue, puce ; puce → télécommande immédiate ; trois allers-retours ; pause obéit.
5. Arrière-plan 75 s puis retour : télécommande juste et obéissante.
6. Rechargement de page pendant le film : puce, télécommande, aucune lecture locale.
7. Fin du film lecteur ouvert : « BE KIND REWIND », location à 100 %.
8. Fin du film lecteur fermé : puce « Film terminé », puis rembobinage.
9. « Arrêter » : TV à l'accueil, séance serveur close. « Sur ce téléphone » : reprise locale à la position.
10. TV déjà connectée, second film : pas de fenêtre native, séance serveur créée (200).
11. Avec Rusmir : arrêt depuis la TV (attendu : lecteur en pause, ligne « La diffusion… s'est arrêtée ») ; TV
    éteinte ou Wi-Fi coupé (attendu : « La télé ne répond plus », trois sorties) ; téléphone verrouillé jusqu'après
    la fin du film (attendu : au retour, « BE KIND REWIND » ou puce « Film terminé » ; relever si `FINISHED`
    arrive après le dégel) ; déconnexion du compte pendant un Cast (attendu : la TV s'arrête, plus de puce).
12. Chrome sur le Mac : lancement, télécommande, fin.

Non vérifiable en local : les sous-titres en Cast (URL absolues du stockage, en production seulement).

## 7. Laissé à l'exécutant

Noms des fichiers et des fonctions, forme exacte de l'état et des événements, valeurs des délais, CSS, découpage en
commits. À mettre à jour dans le même chantier : la section « Player + Cast » d'`AGENTS.md`.
