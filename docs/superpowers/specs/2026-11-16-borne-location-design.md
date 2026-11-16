# Borne de location 24/7 — document de conception

- **Date** : 16/11/2026
- **Statut** : validé par Rusmir le 16/11/2026
- **Base de code** : `main` = `6f0ece1`

> **Mise à jour du 16/11/2026 au soir — décisions de Rusmir après la relecture de la tranche a.**
> Elles priment sur le texte qui suit, laissé tel qu'il a été validé.
>
> - **§ 6, scène intérieure pendant la borne.** Elle n'est plus gardée « en mémoire, rendu gelé »
>   quand elle était prête : dès l'appui sur la borne, le GPU et les chargements du vidéoclub sont
>   libérés, dans tous les cas, et la préparation repart au retour devant la devanture. **[R]**
>   (« dès que le clic est fait sur la borne on doit libérer le GPU et les chargements côté
>   vidéoclub »). Conséquence acceptée : après un passage par la borne, la porte n'est plus
>   immédiate, même sur un appareil dont la scène était prête.
> - **§ 6, navigation.** Le geste retour ne fait jamais sortir de l'application ni de la borne : il
>   agit dans la borne. La seule manière de quitter est le bouton « quitter ». **[R]**
> - **§ 6, orientation.** Sur téléphone, le paysage est réservé au film : la borne ne s'y affiche
>   pas. **[R]**
> - **§ 6, ouverture.** Pas d'écran noir à l'ouverture de la borne. **[R]**
> - **Tarif** : l'affichage suit ce que le serveur facture. **Dates du serveur** : lues en UTC.
>   Les deux validés. **[R]**
> - **§ 5, bouton provisoire sur mobile** : il part tel quel, on ajustera en voyant la version
>   locale. **[R]**
> - **Inscriptions (nouveau, hors tranche a)** : tout nouveau compte devra être validé par un
>   administrateur, prévenu par courriel à chaque inscription. **Mis en dette le 16/11/2026** :
>   ni conçu ni codé, à reprendre plus tard comme un projet à part. **[R]**

Chaque décision porte sa provenance : **[R]** = dite par Rusmir pendant la conception,
**[C]** = choix de Claude, à vérifier à la relecture.

## 1. Intention

Le vidéoclub 3D demande un appareil capable de faire tourner WebGPU avec fluidité. Plutôt que
d'optimiser sans fin pour les appareils modestes, on ouvre **une seconde façon de louer un film** :
une borne automatique posée sur la devanture, à gauche de la porte. Elle ne demande aucun rendu 3D
en direct, donc elle marche partout. **[R]**

Trois effets recherchés :

1. N'importe quel visiteur peut louer et regarder un film, quel que soit son appareil.
2. Le vidéoclub 3D peut fixer un plancher de performance assumé, au lieu de mal tourner partout.
3. La borne est un objet du décor à part entière, pas un écran de secours : on doit avoir envie
   de s'en servir même sur une machine puissante.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**

- Une borne utilisable de bout en bout : trouver un film, voir sa fiche, louer, regarder, envoyer
  sur un Chromecast, laisser une critique, gérer son compte, rendre une K7.
- Un choix libre à l'arrivée : la porte ou la borne. **[R]**
- Un plancher de performance mesuré à l'entrée du vidéoclub, qui oriente vers la borne sans jamais
  enfermer le visiteur. **[R]**
- Une borne et des éléments de devanture photoréalistes, qui tiennent la comparaison avec la photo
  actuelle. **[R]**

**Non-objectifs** (pour cette version)

- Le gérant Michel, le panneau de post-it, la vieille télé LaZone, le tutoriel et l'administration
  restent dans le vidéoclub. **[C], validé « pour le moment » par [R]**
- Aucune nouvelle route d'API si les routes existantes suffisent. Exception connue : la demande de
  crédit (section 7).
- Pas de refonte du vidéoclub 3D ni de son préchauffage, hormis la possibilité de le suspendre
  quand la borne est ouverte (section 6).

**Anti-objectifs** (ce qui ferait de la borne un échec même si elle fonctionne)

- Une borne qui a besoin de WebGPU, ou qui rame sur un téléphone modeste.
- Une borne rouge, ou qui porte les inscriptions, marques ou logos des bornes de référence. **[R]**
- Une interface qui ressemble à une page web ordinaire plutôt qu'à un écran de borne des années 2000.
- Un raccord visible entre les éléments rendus en 3D et la photo de la devanture.
- Un visiteur bloqué : la porte du vidéoclub ne doit jamais être verrouillée par le seuil.

## 3. Le parcours

1. **Arrivée devant la devanture.** Le visiteur voit la porte et la borne, et choisit. **[R]**
2. **S'il choisit la borne** : la vue zoome sur l'écran de la borne.
   - Sur mobile, l'écran occupe environ 90 % de la largeur. **[R]**
   - Sur PC, l'écran prend la hauteur et la borne déborde à gauche et à droite (vitrine de tranches
     de K7 d'un côté, montant de la borne et mur de l'autre). **[R]**
3. **Sur l'écran**, il cherche, fait défiler les jaquettes, ouvre une fiche, loue, regarde.
4. **« Quitter »** ramène à la devanture.
5. **S'il choisit la porte** et que son appareil est sous le seuil (section 8), un message l'invite
   à préférer la borne, avec un bouton et un minuteur ; il peut entrer quand même. **[R]** Si le
   minuteur arrive à zéro sans choix, la vue bascule vers la borne. **[C], d'après la demande
   initiale « rediriger via un bouton + timer vers la borne »**

## 4. La borne, objet

- **Gabarit** : celui de la photo de référence fournie par Rusmir (distributeur à deux colonnes) —
  une grande vitrine de tranches à gauche ; à droite l'écran en portrait, la fente de retour, puis
  une seconde vitrine. **[R]**
- **Contenu des vitrines** : des K7 vidéo, tranches visibles, à la place des DVD. **[R]**
- **Habillage** : les codes du vidéoclub — métal sombre de la façade, néon violet. Ni rouge, ni
  inscriptions d'origine. **[R]** Bandeau lumineux « VIDÉOCLUB · LOCATION K7 » sur le corps et
  enseigne néon « Location 24/7 » fixée au mur au-dessus. **[C]**
- **Taille** : le gabarit de référence agrandi d'environ 10 % dans son ensemble, proportions
  conservées. **[R]** Ordre de grandeur retenu pour les maquettes : environ 1 m de large pour
  2 m de haut, soit la hauteur de la porte. **[C]**
- **Cotes réelles** : la fente de retour et les tranches respectent les dimensions d'une vraie
  cassette VHS (187 × 103 × 25 mm), soit une fente d'environ 20 × 3 cm. **[R] pour le principe,
  [C] pour les valeurs**
- **Écran** : portrait, au format de l'écran de la photo de référence (environ 2:3 dans les
  maquettes). **[R] pour le portrait, [C] pour le ratio exact**

## 5. La devanture

### État actuel (mesuré sur `main`)

- PC : `public/storefront.jpeg` (2048 × 1117) animée par un shader WebGL (`ExteriorScene.ts`), avec
  un masque `public/storefront-mask.png` (R = néons, G = vitres, B = métal). Le cadre de la porte
  commence au pixel 210 : il reste environ 50 cm de mur à gauche (estimation, porte prise à 95 cm).
- Mobile : image fixe `public/storefront-mobile.jpeg` (1536 × 2752), affichée en `object-fit: cover`.
  Le cadre de la porte commence au pixel 242 : il reste environ 25 cm de mur à gauche. La photo
  coupe la porte sous la barre de poussée ; le sol n'est pas dans l'image.
- Rusmir ne peut pas refaire ces photos ni les agrandir. **[R]**
- **Source plus définie retrouvée dans l'historique git (16/11)** : la photo PC d'origine, en
  **5632 × 3072** (9 561 541 octets), a été ajoutée au commit `f5123bb` puis remplacée par la version
  réduite au commit `ba212b8`. Même cadrage que l'image actuelle (réduite à 2048 × 1117, elle s'en
  écarte d'environ 3 niveaux sur 255 en moyenne, soit la compression). On la récupère par
  `git show f5123bb:public/storefront.jpeg`. Son masque d'origine, lui aussi en 5632 × 3072, est au
  même commit (`public/storefront-mask.png`). C'est de là que vient le ratio `5632 / 3072` du code.
- Rien de mieux n'existe pour la photo mobile : l'historique n'en contient qu'une version, celle de
  1536 × 2752. `public/exterior.jpeg` (2752 × 1536) montre la rue d'en face vue de l'intérieur, pas
  la devanture.

### Ce qui est décidé

- **PC** : la borne à gauche de la porte ; le mur est prolongé à gauche pour la loger. La borne est
  coupée en bas à la même ligne que la porte. **[R]** Conséquence acceptée à vérifier : l'image
  devient plus panoramique, donc la devanture rétrécit d'environ un dixième sur un écran 16:9. **[C]**
  Le mur à prolonger est un panneau peint bleu nuit, uni, strié de pluie : un raccord simple.
  On travaille à partir de la photo d'origine en 5632 × 3072. **[C]**
- **Vidéo d'attente sur PC** (`/videoclubvideo.mp4`, lancée après dix secondes sans mouvement) :
  **désactivée**, elle est incompatible avec la borne. **[R]** Dès le lot 1.
- **Mobile** : une vue reculée où la porte et la borne sont visibles ensemble. **[R]**
  - Rien n'est affiché sous le bord inférieur actuel de la photo : la porte et la borne sont coupées
    à la même ligne, le pied de la borne reste hors champ. **[R]**
  - Le bâtiment est coupé juste au-dessus de l'enseigne VIDEOCLUB. Au-dessus : un ciel de pluie,
    nuageux, avec la lune qui perce les nuages. **[R]**
  - L'enseigne VIDEOCLUB est recentrée au-dessus de l'ensemble porte + borne. **[C]**
  - Deux boutons fléchés : « BORNE 24/7 » et « PORTE VIDÉOCLUB ». **[R]** Placés au-dessus de chaque
    élément, flèche vers le bas, pour ne masquer ni l'écran de la borne ni le vitrage. **[C]**
  - À évaluer pendant l'essai jetable du lot 3 : la photo PC d'origine contient la même porte avec
    une définition comparable à la photo mobile, plus l'enseigne et le mur de gauche. Elle peut
    servir de source unique aux deux vues si le raccord y gagne. **[C]**

## 6. L'écran de la borne

### Charte

Inspirée des meilleures bornes de location de DVD des années 2000, en 2D. **[R]** Référence
principale fournie par Rusmir : `01_iMOZI_interface_2007.jpg`. On en reprend **l'esprit**, pas les
éléments de marque :

- fond bleu profond en dégradé, couleurs contrastées et saturées ; **[R]**
- boutons bombés turquoise, bouton d'action orange, fiche du film en forme de clap ; **[C], maquette
  validée « à première vue, on affinera »**
- disposition : rayons en colonne à gauche, fiche au centre, actions en dessous, bande de jaquettes
  défilante en bas, « compte | retour | quitter » en haut. **[C], idem**

### Contenu (validé « pour le moment », à ajuster)

| Bloc | Ce qu'il offre | Existant à réutiliser |
|---|---|---|
| Trouver un film | Tout ce que fait le Minitel : recherche, rayons, ordre alphabétique, commande d'un film absent. Plus une bande de jaquettes à faire défiler. **[R]** | `src/components/minitel/` |
| Fiche du film | Infos, bande-annonce (« extraits »), location, critiques — les mêmes possibilités que la fiche d'une K7 du vidéoclub. **[R]** | `src/components/videoclub/VHSCaseOverlay.tsx`, `src/services/tmdb.ts`, `src/components/review/` |
| Regarder | Le lecteur actuel, mêmes commandes, envoi vers Chromecast. **[R]** | `src/components/player/VHSPlayer.tsx`, `src/hooks/useGoogleCast.ts` |
| Compte | Connexion, inscription, locations en cours, crédits. **[C]** La connexion et l'inscription prennent la charte graphique de la borne, par cohérence ; le lecteur garde son affichage actuel. **[R]** | Logique de `src/components/auth/AuthModal.tsx` (pas son apparence), `src/components/terminal/TVTerminal.tsx` |
| Crédits | Demander un crédit gratuit, accepter les 3 crédits de la semaine, voir ce qu'il reste à demander aujourd'hui et cette semaine. Règle en section 7. **[R]** | `lib/bonus.ts`, `src/components/ui/WeeklyBonusToast.tsx` |
| Retour | Rendre une K7 par la fente de la borne. **[C]** | `POST /api/rentals/[filmId]/return` |

### Contraintes techniques

- **Page classique, sans rendu 3D en direct** : ni WebGPU ni WebGL pour l'interface. **[R]**
- La borne ne doit **jamais** dépendre du préchauffage de la scène intérieure, ni le déclencher sur
  un appareil écarté par le pré-filtre (section 8). **[C]**
- **La borne vit dans la même page que le reste** (même application, même magasin d'état), pour
  réutiliser la fiche, le lecteur et la session Cast sans rechargement. **[C]**
- **Quand la borne est ouverte, la scène intérieure cachée est suspendue** : ni rendu, ni
  compilation en arrière-plan. Rien de 3D ne tourne pendant qu'on consulte la borne ou qu'on y
  regarde un film. Si la scène était déjà prête, elle reste en mémoire, rendu gelé, et l'entrée par
  la porte reste immédiate. Si elle était encore en préparation, elle est abandonnée et sa
  préparation repart du début quand le visiteur revient à la devanture ; un temps de chargement à
  ce moment-là est accepté. **[C], accepté par [R] le 16/11** (la mise en pause en cours de
  préparation, d'abord envisagée, touchait le code le plus fragile du projet)
- Pensée pour les appareils modestes : pas de flou d'arrière-plan (`backdrop-filter`) ni de grand
  canvas 2D accéléré. Le diagnostic du 14/11/2026 a montré que ces deux choses font compiler des
  shaders au navigateur et gèlent l'affichage à leur première apparition. **[C]**
- Même origine, mêmes cookies, mêmes routes que le reste du site.

## 7. La règle des crédits

Un visiteur qui n'a que la borne doit pouvoir regagner des crédits sans passer par Michel. Rusmir a
donné la règle, valable pour tout le site. **[R]**

**L'esprit de la règle** : empêcher les abus, et en même temps ne jamais laisser un visiteur à
court de crédits. **[R]**

1. **Demande gratuite** : on obtient un crédit en le demandant.
2. Au plus **3 crédits demandés par jour**.
3. Au plus **9 crédits obtenus « en extra » par semaine**.
4. **Chaque semaine, 3 crédits sont offerts à la connexion.** Il faut les accepter ; non acceptés,
   ils ne sont pas reçus.
5. **Plafond : 15 crédits** au total. Tout crédit au-delà est perdu.
6. **Critiques et rembobinage** : un seuil supérieur à 15 est autorisé pour ces deux gains.
7. **Visiteur à zéro** : on lui propose ses crédits offerts. Dans ce cas la limite peut être
   relevée, jusqu'à **24 par semaine au maximum**.

### État actuel (lu sur la copie de travail, 16/11)

- Bonus de la semaine (`lib/bonus.ts`) : refusé si le solde est de 5 ou plus ; montant =
  `min(3, 5 − solde)`. L'acceptation existe déjà (`POST /api/me/weekly-bonus`). Il n'est proposé
  que par `WeeklyBonusToast`, monté dans la scène intérieure : invisible depuis la borne.
- Michel (`add_credits`, `lib/chat-tools.ts`) : 1 à 3 crédits par appel, sans compteur ni plafond
  dans le code ; les paliers ne sont que des consignes du prompt (`lib/chat.ts`).
- Autres gains : +1 à la création d'une critique (`lib/reviews.ts`), +1 au rembobinage et un crédit
  de retour anticipé (`lib/rentals.ts`).
- Aucun plafond global. Aucun registre des crédits accordés, hormis la table `weekly_bonuses`.

### Lecture de la règle (**[C]**, validée par **[R]** avec le document)

- **« En extra » = les crédits obtenus sur demande**, en plus des 3 de la semaine. Un seul compteur
  pour la borne et pour Michel : ce que Michel donne compte dans les 3 par jour et les 9 par semaine.
- **Michel reste généreux à sa façon** (ton, mini-jeu), mais le serveur réduit ce qu'il accorde à ce
  qu'il reste du jour, de la semaine et du plafond. Sur la borne, un appui = un crédit.
- **Critique et rembobinage** ne comptent pas dans les 9 : ce sont des gains mérités, pas des
  demandes. Ils peuvent faire monter le solde au-dessus de 15, **jusqu'à 24**. (Rusmir a demandé
  « un seuil supérieur » sans le chiffrer ; la valeur 24, proposée par Claude, a été validée avec
  le document.)
- **Retour anticipé** : ne compte pas dans les 9 non plus, mais reste sous le plafond de 15, puisque
  seuls la critique et le rembobinage ont été cités.
- **Visiteur à zéro** (lecture validée avec le document) : dès que le solde tombe à zéro, la borne — comme le
  vidéoclub — lui propose d'elle-même ses crédits offerts : d'abord les 3 de la semaine s'ils ne
  sont pas encore acceptés, sinon la demande gratuite. S'il a déjà épuisé ses 3 du jour ou ses 9 de
  la semaine, ces limites sont levées pour lui tant qu'il est à zéro : il peut encore obtenir un
  crédit à la fois, dans la limite de **24 crédits offerts par semaine**, tout compris (les 3 de la
  semaine, les demandes, les cadeaux de Michel). Au-delà de 24, il attend la semaine suivante ou
  gagne des crédits par une critique ou un rembobinage.
- **Bonus de la semaine** : 3 crédits quel que soit le solde (la condition « moins de 5 » disparaît),
  réduits si nécessaire pour ne pas dépasser 15. Une semaine non acceptée est perdue, pas reportée.
  Il est proposé sur la borne comme dans le vidéoclub.
- **Comptes déjà au-dessus de 15** : rien n'est retiré ; ils ne gagnent plus rien tant qu'ils n'y
  sont pas redescendus.
- La demande est réservée aux comptes connectés.

### Conséquences pour le constructeur

- Une route nouvelle pour la demande de crédit, et un registre des crédits accordés (date, source,
  montant) pour compter par jour et par semaine.
- Le plafond s'applique en un seul endroit du serveur, par lequel passent tous les gains.
- Le découpage du jour et de la semaine (fuseau) est laissé au constructeur ; le code actuel compte
  la semaine ISO en UTC, l'heure de Paris serait plus naturelle pour les visiteurs.
- Les messages de refus disent ce qu'il reste et quand le compteur repart (pas de bouton grisé muet,
  voir la leçon « boutons `disabled` » d'`AGENTS.md`).

## 8. Le seuil de performance

- **Plancher visé** : les téléphones de 2022-2023, le Pixel 7 servant de repère. **[R]**
- **Ce qui compte est la capacité, pas l'âge** : un haut de gamme de 2021 (iPhone Pro Max, Samsung
  Ultra) est capable de naviguer dans le vidéoclub et doit passer sans message. **[R]**
- **Méthode** : mesurer sur l'appareil plutôt que deviner son modèle. La scène se prépare déjà
  derrière la devanture ; on mesure cette préparation et la fluidité réelle, et on compare à une
  limite. Les appareils sans WebGPU ou avec trop peu de mémoire sont écartés d'avance, sans rien
  essayer. **[C]**
- **Sous le seuil** : un message indique que l'appareil n'est pas assez puissant pour le vidéoclub,
  conseille un PC ou un téléphone plus récent, et propose la borne par un bouton avec minuteur. **[R]**
  Le visiteur reste libre de forcer l'entrée. **[R]**
- **Sans WebGPU** : aujourd'hui `App.tsx` affiche un écran d'excuses avant même la devanture. À la
  place, le visiteur voit la devanture comme tout le monde (elle n'a pas besoin de WebGPU). La
  borne lui est ouverte ; la porte affiche le message d'incompatibilité avec le bouton et le
  minuteur vers la borne, **sans** « entrer quand même » puisque l'entrée est impossible. Ce point
  fait partie du **lot 1**, sans quoi la promesse « tout appareil peut louer » ne tient pas. **[C]**
- **Si le visiteur pousse la porte avant que la mesure soit connue** : la porte n'attend jamais un
  verdict. Verdict déjà connu et défavorable → message à la porte. Verdict pas encore connu →
  l'écran de chargement habituel ; si la préparation dépasse une limite de temps, le message
  apparaît sur cet écran, avec la borne en un appui et la possibilité de continuer à attendre. La
  fluidité, elle, ne se mesure qu'une fois entré : si elle est mauvaise, une suggestion discrète de
  passer à la borne s'affiche à l'intérieur. **[C]**
- **La borne reste proposée à tout le monde**, quel que soit le résultat. **[R]**

**Limite connue** : aucune mesure n'existe sur un téléphone de la classe du Pixel 7. Seul le Pixel 9a
de Rusmir a été mesuré. Les valeurs de la limite se caleront sur des mesures réelles — un appareil de
cette classe branché, ou les mesures de terrain déjà en place (`src/utils/perf-beacon.ts`,
`app/api/perf`, table `client_perf_runs`).

## 9. La fabrication des images

- **Tout ce qui est nouveau est conçu en 3D sous Blender, en qualité photoréaliste** : la borne, ses
  K7, et l'ensemble des éléments ajoutés à la devanture (mur prolongé, arête du toit, ciel, lune,
  enseignes). Le résultat doit tenir la comparaison avec la photo actuelle. **[R]**
- **Puis tout est aplati en 2D pour l'affichage** : le visiteur ne reçoit que des images. **[R]**
- Blender 5.0.1 est installé sur le Mac de développement (`/Applications/Blender.app`) et peut être
  piloté par script. Le modèle de K7 du vidéoclub existe : `public/models/vhs_cassette_tape.glb`.
- La photo existante est conservée pour ce qu'elle montre (enseigne, porte, vitrine) ; les éléments
  rendus y sont raccordés. **[C]** Source de travail : la photo d'origine en 5632 × 3072 (section 5).

**Images à produire** (liste indicative, **[C]**)

- devanture PC élargie, avec la borne, et son masque de reflets mis à jour ;
- devanture mobile en vue reculée, avec la borne, le toit et le ciel ;
- vue rapprochée de la borne pour le zoom (cadrages mobile et PC), la zone de l'écran restant libre
  pour y poser l'interface.

**Critère de réussite** : le verdict visuel de Rusmir, photo d'origine et image produite côte à côte.

## 10. Lots et ordre

Trois lots constructibles séparément, dans cet ordre. **[C], accepté par [R]**

1. **La borne elle-même** — l'interface, atteignable d'abord par un bouton provisoire sur la
   devanture actuelle. Dès ce lot, tout appareil peut louer. **Il part en production dès qu'il
   fonctionne**, sans attendre la borne modélisée ; Rusmir espère une mise en ligne le jour même
   (16/11). **[R]** Le lot comprend aussi la règle des crédits, la désactivation de la vidéo
   d'attente et le cas sans WebGPU.
   Pour tenir ce délai, le lot est construit par tranches livrables, dans cet ordre
   **[C], accepté par [R]** :
   - **Tranche a** : trouver un film (rayons, recherche, bande de jaquettes), fiche, location,
     lecture, Cast, connexion et inscription, bouton provisoire, vidéo d'attente désactivée, cas
     sans WebGPU.
   - **Tranche b** : la règle des crédits (serveur, puis bloc « Crédits » de la borne et Michel).
   - **Tranche c** : critiques, bande-annonce, compte, retour par la fente, commande d'un film
     absent.

   La mise en production ne dépend pas que du code : la fusion passe par la relecture de la PR et
   le déploiement est fait par une autre personne.

2. **Le seuil** — mesure, message, entrée forcée.

3. **La devanture** — modélisation Blender, rendus, nouvelle vue mobile, mur prolongé sur PC, zoom.
   Ce lot porte le principal risque (l'accord entre rendu et photo) : il commence par **un essai
   jetable** du raccord sur la vue mobile, soumis à Rusmir avant de modéliser en détail. Il peut
   avancer en parallèle des lots 1 et 2.

## 11. Laissé au constructeur

- Comment réutiliser la fiche, le lecteur et la logique du Minitel : partage de composants ou
  extraction de la logique. La fiche actuelle (`VHSCaseOverlay.tsx`, 2782 lignes) est pensée autour
  d'une K7 3D ; sur la borne, la jaquette 2D la remplace.
- La navigation interne de la borne (états, retour arrière, lien profond éventuel).
- Les grandeurs mesurées par le seuil, leurs valeurs, et la mémorisation du résultat.
- La durée du minuteur.
- L'animation de zoom entre la devanture et l'écran.
- Le format, le poids et le découpage des images ; l'emplacement des sources Blender dans le dépôt.
- Le recalage des zones cliquables de la devanture (aujourd'hui en pourcentages d'une image au
  ratio fixe dans `ExteriorView.tsx`).

## 12. Risques

| Risque | Parade |
|---|---|
| Le rendu Blender ne s'accorde pas avec la photo (lumière violette, grain, halo des néons) | Essai jetable en tête du lot 3 ; verdict visuel de Rusmir avant de poursuivre |
| La devanture PC rétrécit trop une fois élargie | Montrer le résultat réel sur un écran 16:9 avant de figer le cadrage |
| La fiche actuelle est difficile à détacher de la scène 3D | Décision d'architecture en tête du lot 1, avant d'écrire l'interface |
| Le seuil est mal calé faute de mesures sur un appareil de 2022 | Démarrer prudent (message non bloquant), ajuster avec les mesures de terrain |
| La nouvelle règle des crédits change le comportement pour les comptes existants (bonus de la semaine, cadeaux de Michel) | Règle appliquée en un seul endroit du serveur, couverte par des tests ; rien n'est retiré aux soldes existants |
| Le lot 1 est gros pour une mise en ligne le jour même | Tranches livrables (section 10) : la tranche a suffit à louer et regarder depuis la borne |

## 13. Questions tranchées par Rusmir (16/11)

1. **Crédits sans Michel** → la règle de la section 7. **[R]**
2. **Mise en ligne du lot 1** → en production dès qu'il fonctionne. **[R]**
3. **Vidéo d'attente sur PC** → désactivée. **[R]**
4. **Source de la devanture** → à chercher dans le dépôt ; trouvée dans l'historique git
   (section 5). Rusmir ne peut rien agrandir lui-même. **[R]**

## 14. Pièces de référence

- Maquettes de conception : `.superpowers/brainstorm/83786-1794781814/content/` (hors dépôt) —
  `borne-ecran-v2.html` (écran et cadrage), `borne-devanture-v3.html` (zoom mobile en trois temps,
  PC élargi ; **taille de borne périmée**), `borne-mobile-recul-v5.html` (vue mobile retenue).
- Références fournies par Rusmir : `~/Downloads/Interfaces_location_DVD_visuels/` (interfaces de
  bornes 2005-2009) et la photo d'une borne de DVD à deux colonnes, `~/Downloads/kiosque-dvd.webp`. Elles servent d'inspiration ;
  leurs droits restent à leurs auteurs, on n'en reprend ni marque ni logo.
