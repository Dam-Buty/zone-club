# Borne 24/7 — « Mon compte », historique et critiques — document de conception

- **Date** : 17/11/2026
- **Statut** : validé par Rusmir le 17/11/2026 (« on valide »), relu par un constructeur neuf ; ses deux questions
  tranchées le 18/11 (§ 6)
- **Base** : branche `feat/borne-location` ; suit la livraison 1 de la distribution
  (`2026-11-17-borne-distribution-k7-design.md`) et le suivi serveur du Cast (`2026-11-17-cast-suivi-serveur-design.md`)

Provenance : **[R]** = dit par Rusmir, **[C]** = choix de Claude.

## 1. Intention

- Le visiteur doit pouvoir **utiliser la borne pour voir son compte, ses crédits et ses locations en cours sans
  avoir à louer d'abord**. **[R]**
- Il voit **toute son historique** pour retrouver ses films, et pour chaque film rendu il sait **s'il l'a
  rembobiné, s'il a obtenu le bonus, s'il a laissé une critique** — et s'il ne l'a pas fait, **il peut toujours
  l'écrire**. **[R]**
- On demande trop pour une critique : **minimum 144 caractères** au lieu de 500. **[R]**
- Sur le panneau d'après location, « Sur la TV » et « Regarder » ne sont **pas assez explicites** : l'écran est
  à retravailler. **[R]**

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs** : l'écran « Mon compte » (§ 4) ouvert par « Compte » à tout moment ; le formulaire de critique de la
borne (§ 5) ; la règle de critique (§ 6) ; le minimum de 144 caractères partout (§ 7) ; le panneau « Où voulez-vous
regarder ? » (§ 3).

**Non-objectifs** : demander un crédit et accepter les crédits de la semaine (tranche b) ; rendre une K7 par la fente
(tranche c) ; l'animation du robot (livraison 2, lot 3). Leur place est prévue dans l'écran, rien n'est codé.

**Anti-objectifs** : un compte qui ne se consulte qu'après une location ; un bonus raté présenté comme encore
gagnable (le rembobinage est impossible une fois le film rendu) ; une critique qu'on peut débloquer en avançant
rapidement jusqu'à la fin ; un formulaire au style du vidéoclub (vert terminal) qui jurerait sur la dalle de 2007.

## 3. Le panneau « Votre K7 est prête » retravaillé

```
VOTRE K7 EST PRÊTE
Get Out
À rendre avant le 19 novembre à 20:30

Où voulez-vous regarder ?
┌──────────────────────────────┐
│ [▯] SUR CE TÉLÉPHONE         │  ← action principale (orange)
│     le film démarre ici      │
└──────────────────────────────┘
┌──────────────────────────────┐
│ [▭] SUR MA TÉLÉ              │
│     via Chromecast           │
└──────────────────────────────┘
Plus tard              Mon compte ›
```

- La question nomme le choix ; chaque bouton dit **où** et **comment**. **[C]**, validé
- « SUR CE TÉLÉPHONE » / « SUR CETTE TABLETTE » / « SUR CET ORDINATEUR » selon l'appareil ; « via Chromecast », ou
  « via AirPlay » sur un appareil Apple qui sait faire AirPlay (règle `appleAirPlay`). **[C]**
- Pictogrammes **dessinés** (SVG), jamais tirés d'une police (règle de la borne). **[C]**
- « Plus tard » reste ; « Mes locations » devient « Mon compte ». **[C]**

## 4. L'écran « Mon compte »

```
◀ Retour
Mon compte
verif778804                       5 crédits

EN COURS
[jaq] Get Out
      encore 1 j 23 h                  [REGARDER]

HISTORIQUE
[jaq] Shutter Island · rendu le 18/11
      ✓ Rembobiné · +1 crédit
      ✓ Rendu en avance · +1 crédit
      ✓ Critique publiée
[jaq] Dune · expiré le 12/11
      ✗ Pas rembobiné
      [ÉCRIRE MA CRITIQUE · +1 crédit]

               Se déconnecter
```

- Ouvert par **« Compte »** à tout moment ; non connecté, « Compte » ouvre la connexion (inchangé). Il remplace
  le petit message « Compte » actuel et l'écran « Mes locations » de la livraison 1. **[R]** pour l'accès, **[C]**
  pour la fusion
- **En cours** : les locations actives, la plus proche de l'échéance d'abord, temps restant, « Regarder ».
- **Historique** : toutes les locations terminées, la plus récente d'abord, avec :
  - **rendu le …** ou **expiré le …** — nouvelle colonne `rentals.returned_at` posée au retour ; une location
    terminée avant cette colonne affiche « terminée » ; **[C]**
  - **rembobiné** ✓ / ✗ et **rendu en avance** ✓ / ✗, chacun avec son « +1 crédit » quand il est obtenu ; un bonus
    manqué n'est **pas** proposé (il ne se rattrape pas) ;
  - **critique** : « ✓ Critique publiée », sinon « Écrire ma critique · +1 crédit » si la règle du § 6 le permet,
    sinon la raison (« Critique possible à partir du 19/11 à 21:10 », « Regardez au moins 80 % du film »).
- Une location **en cours** montre aussi sa critique (publiée, à écrire, ou la raison) : on peut critiquer avant de
  rendre. **[C]**
- Données : tout vient de `/api/me` (historique complet, critiques de l'utilisateur), sans nouvelle route ; le
  magasin d'état doit garder `rewind_claimed`, `returned_early`, `watch_progress`, `returned_at`,
  `watch_started_at` qu'il jette aujourd'hui. Rafraîchi à l'ouverture de l'écran (`fetchMe`). **[C]**
- « Se déconnecter » en bas de l'écran.

## 5. Le formulaire de critique de la borne

- Plein écran dans la borne, à sa charte : titre du film, trois notes de 1 à 5 (réalisation, scénario, jeu), le
  texte, un compteur « 87 / 144 » qui passe au vert à 144, « PUBLIER » et « Retour ». **[C]**
- « PUBLIER » ne se grise jamais : sous 144 caractères ou sans les trois notes, il dit ce qui manque (règle de la
  borne). **[C]**
- Mêmes routes que le vidéoclub (`POST` / `PUT /api/reviews/[filmId]`) ; « +1 crédit » à la première publication,
  comme aujourd'hui. Une critique déjà publiée s'ouvre en modification. **[C]**
- Le clavier virtuel ne doit pas masquer le champ (même règle que la connexion de la borne). **[C]**

## 6. La règle de critique

**[R]** : « on garde les 80 % » ; « il faut qu'a minima le film soit lancé et qu'on ait l'information » ; « la
critique ne peut être faite avant la fin du film − 20 % de la durée ».

**[R]** (18/11) : « n'importe quelle location suffit, s'il a déjà vu le film il peut laisser une critique ; par
contre une seule critique par film et par utilisateur ». Une critique se modifie toujours (c'est la même). **[C]**

Lecture **[C]** : une critique est permise si **au moins une** location du film par ce visiteur remplit :

1. `watch_progress >= 80` (inchangé, `lib/reviews.ts`) **et**
2. le film a été **lancé** (`rentals.watch_started_at`, nouvelle colonne, posée au premier enregistrement de
   progression — lecture locale — ou à la création d'une séance de Cast) **et**
3. **au moins 80 % de la durée du film se sont écoulés depuis ce lancement** : `maintenant ≥ watch_started_at +
   0,8 × durée`, durée = `films.duration_sec`, à défaut `runtime × 60`.

La garde de temps empêche de débloquer la critique en avançant rapidement jusqu'à la fin, ce que la TV permet. Elle
vaut côté serveur (`canUserReview`), et la borne affiche la même raison. Les admins et les films jamais loués gardent
leurs règles actuelles. Une location antérieure sans `watch_started_at` : la garde de temps ne s'applique pas
(on ne peut pas la reconstituer). `watch_started_at` n'est posé que sur une location **sans aucune progression** :
une location déjà entamée au déploiement reste sans garde de temps, au lieu d'imposer d'attendre à nouveau 80 % de
la durée à quelqu'un qui a presque fini (question du relecteur, choix A). **[C]**

L'éligibilité est calculée **par le serveur** et renvoyée par `/api/me` pour chaque film de l'historique non
critiqué (autorisé, raison, date à partir de laquelle) : la borne n'a pas de copie de la règle. **[C]**

## 7. Le minimum de 144 caractères

Une seule constante partagée (`REVIEW_MIN_LENGTH = 144`, dans `src/utils/`, comme `account-rules.ts`) utilisée par
le serveur (`lib/reviews.ts`), la fenêtre de critique du vidéoclub (`ReviewModal`), le lecteur (`VHSPlayer`), le
formulaire de Michel (`GenUICriticForm`) et la borne ; les deux consignes de Michel (`lib/chat-tools.ts`,
`lib/chat.ts`) passent à « au moins 144 caractères ». Un test vérifie qu'il ne reste aucun « 500 » de critique. **[C]**

## 8. Approches considérées

| Sujet | Retenu | Écarté |
|---|---|---|
| Accès au compte | « Mon compte » ouvert par « Compte », qui absorbe « Mes locations » **[C]** | Deux écrans séparés (compte, locations) |
| Formulaire de critique | Formulaire à la charte de la borne **[C]** | Réutiliser `ReviewModal` (style terminal vert, portail hors de l'écran) |
| Garde « film lancé » | Colonne `watch_started_at` posée par le serveur **[C]** | Déduire du Cast seul (`cast_sessions.started_at`) : ne couvre pas la lecture sur le téléphone |
| Date de retour | Colonne `returned_at` **[C]** | Déduire de `expires_at` : faux pour un retour anticipé |

## 9. Laissé au constructeur

Le découpage en composants (`KioskAccount`, `KioskReview`…), les pictogrammes, l'ordre exact des badges, la
pagination éventuelle d'un long historique, le texte précis des raisons.
