# ZONE CLUB

```
   ╔══════════════════════════════════════════════╗
   ║   Z O N E   C L U B  ·  VIDÉOCLUB EN LIGNE   ║
   ║   ─────────────────────────────────────────  ║
   ║   « Rembobinez avant de rendre la cassette » ║
   ╚══════════════════════════════════════════════╝
```

Un vidéoclub des années 90, en 3D, dans un navigateur. On pousse la porte, on marche
dans les rayons, on attrape une K7, on la retourne pour lire le synopsis au dos, on la
loue au comptoir, on s'assoit dans le canapé et on regarde le film sur la télé.

Sous le décor, c'est une plateforme de streaming complète et autonome : catalogue,
transcodage, diffusion, chaîne linéaire 24/7, comptes, crédits, critiques, et un gérant
qui répond quand on lui parle. Rien d'externe à part TMDB pour les métadonnées.

---

## LE PLAN DE LA BOUTIQUE

```
   NAVIGATEUR                        POWEREDGE (NixOS + Docker)
  ┌──────────────┐                 ┌──────────────────────────────────┐
  │ Façade WebGL │                 │  app        Next.js 15 · SQLite  │
  │      ↓       │◄─── HTTPS ─────►│             + pipeline média     │
  │ Boutique     │                 │  storage    lighttpd (les MP4)   │
  │   WebGPU     │◄─── vidéo ──────│  cinema     chaîne HLS 24/7      │
  │   R3F/TSL    │                 │  bot        présence Discord     │
  └──────┬───────┘                 └──────────────┬───────────────────┘
         │
    Chromecast                                    │ pipe SSH
     AirPlay                                      ▼
                                          GPU distant (NVENC)
```

Zéro orchestrateur exotique : un `docker-compose.yml`, un reverse proxy Traefik, et une
base SQLite en fichier unique que tout le monde lit.

---

## SUB-SYSTÈME № 1 · LA BOUTIQUE EN 3D

Deux pipelines de rendu, deux philosophies.

**La façade** (`src/components/exterior/scene/ExteriorScene.ts`) est du WebGL nu, sans
React Three Fiber : un quad plein écran, une photo de devanture, et un masque RGB
(R = néons, G = vitres, B = métal) qui pilote un shader GLSL maison. Les néons
scintillent sur deux cycles désynchronisés, il pleut en trois couches de `LineSegments`
avec du vent et des rafales, et des phares procéduraux passent dans la rue — voitures
banales, police au gyrophare bleu/rouge, pompiers — en se reflétant sur la vitre, le
métal et les flaques. Léger, compatible partout, c'est la porte d'entrée.

**L'intérieur** est du **WebGPU** (Three.js `WebGPURenderer` + React Three Fiber + TSL).
Pas de repli WebGL : sans `navigator.gpu`, on affiche un écran d'excuses. En échange, on
se paie des choses qu'on ne ferait pas ailleurs.

| Ce qui pourrait coûter cher | Comment on s'en sort |
|---|---|
| ~520 cassettes, chacune avec sa jaquette | **1 seul `InstancedMesh`**, géométrie partagée, et un **atlas 2D** (`DataTexture`, cellules 200×300) au lieu d'une `DataArrayTexture` — les array textures déchirent horizontalement sur pilotes Vulkan/NVIDIA et sur Metal iOS |
| Upload GPU des jaquettes | Un seul flush en fin de chargement au lieu d'un upload par poster (~1,15 Go de trafic GPU économisé) |
| Animer le survol de 520 K7 | **Compute shader TSL** sur storage buffers : le lerp de hauteur/émissivité tourne sur le GPU, pas dans une boucle JS |
| 32 tubes néon | 2 `InstancedMesh` (tube + réglette), matériau émissif partagé, `rectAreaLight` avec textures LTC |
| Ombres | Une seule ombre portée, figée après 3 frames (`shadow.autoUpdate = false`) — la boutique ne bouge pas |
| Scène statique = GPU qui chauffe pour rien | **Throttle adaptatif** : 60 fps quand ça bouge, 20 fps dès qu'on ne touche plus à rien |
| Anti-aliasing | `antialias: false` côté renderer ; supersampling ×1.25 + SMAA + sharpening RCAS en post, tout en TSL |
| Premier affichage saccadé | Warmup explicite : balayage caméra sur 4 orientations, `compileAsync` en boucle jusqu'à plateau du nombre de pipelines compilés |
| Poids des textures | KTX2 / Basis Universal avec repli JPEG si le transcodeur n'est pas là |

La chaîne de post-process complète : Bloom → profondeur de champ (uniquement quand une
K7 est ouverte devant les yeux) → vignette → SMAA → sharpen. Sur mobile, on coupe à
Bloom → vignette → FXAA.

Deux interfaces diégétiques cohabitent dans la boutique, et ce ne sont pas les mêmes :
le **Minitel 1982** (modèle GLB, écran peint en `CanvasTexture` police VT323, hitboxes
routées depuis le raycaster) sert à fouiller le catalogue, chercher, commander un film
absent, et faire clignoter la bonne cassette en rayon. Le **terminal du canapé** est un
CRT façon menu de décodeur : compte, locations, historique, crédits, critiques, et un
panneau d'admin qui se déverrouille en tapant `admin` au clavier.

Il y a aussi une vieille télé au fond, branchée sur une chaîne de TV linéaire maison.

---

## SUB-SYSTÈME № 2 · LA CHAÎNE DE TRAITEMENT

C'est la partie invisible, et de loin la plus tordue. En entrée, un master MKV : plusieurs
pistes audio, des sous-titres de formats variés, une résolution et un codec quelconques. En
sortie, un MP4 qu'un Chromecast de 2015 sait lire sans réfléchir. Sans intervention humaine.

```
      master MKV
          │
       ffprobe ──── identification des pistes (VO, VF, sous-titres)
          │
    ┌─────┴──────────────────────┐
    ▼                            ▼
  plan vidéo              passe ffmpeg unique
 copie ? réencode ?      audio VF + VO + subs
    │                            │
  pipe SSH → GPU              OCR des
  distant (NVENC)          sous-titres image
    │                            │
    └─────────────┬──────────────┘
                  ▼
       remux en copie pure → vo.mp4 / vf.mp4
                             sub.fr.vtt / .srt
```

**Le plan vidéo décide de ne rien faire quand c'est possible.** Si la source est du H.264
8 bits, profil compatible web, ≤ 1080p et sous 6 Mbit/s, le flux est copié tel quel. Un
réencodage ne ferait que perdre une génération de qualité pour un gain nul. Tout le reste
part au GPU.

**L'encodage distant est un pipe SSH, pas un service HTTP.** ffmpeg local démuxe la piste
vidéo seule, l'envoie brute dans un tunnel SSH (chiffrement AES matériel, compression
coupée — c'est déjà de la vidéo), une machine distante la décode en NVDEC, la réencode en
NVENC et renvoie le flux, qu'on écrit en `.part` avant un rename atomique. Pas de fichier
temporaire des deux côtés, pas de polling, pas d'état à réconcilier si ça casse.

Trois variantes de commande selon ce qu'on lui donne :

| Source | Chemin |
|---|---|
| H.264 8 bits standard | CUDA de bout en bout, `scale_cuda` si au-dessus de 1080p |
| H.264 10 bits | Décodage **logiciel** — NVDEC ne décode le H.264 qu'en 8 bits |
| HDR10 / HLG | Tonemapping HDR→SDR via libplacebo : `tonemap_cuda` n'existe pas sur cette machine et l'interop CUDA→Vulkan échoue, donc on repasse par la mémoire système (−34 % de vitesse, mesuré) |

Sur le chemin HDR, la réduction de résolution se fait **avant** l'upload Vulkan et pas dans
le filtre : la machine distante a une mémoire unifiée partagée avec d'autres charges, et
téléverser une frame 4K avant de la réduire suffit à faire tomber le device. La sortie est
systématiquement taguée SDR BT.709 — sans ça, un Chromecast bascule en mode HDR sur un
fichier qui n'en est plus un et affiche un gris délavé.

**Pendant ce temps, une seule et unique passe ffmpeg** extrait toutes les pistes audio et
tous les sous-titres. On travaille sur des disques durs mécaniques et on essaie d'éviter les multi-passes.

**Les sous-titres image** — les bitmaps PGS des BluRay — passent à l'OCR, avec une passe de
correction des confusions de caractères établie en comparant des sorties OCR à des pistes
texte témoins. Le déclenchement est conditionnel : on n'OCRise que si la piste texte de la
langue est absente ou trop courte pour être autre chose qu'une piste forcée.

**Le master part en sauvegarde distante en parallèle du transcodage**.

Chaque exécution écrit une ligne dans une table de métriques — décision vidéo, durée de
chaque étape, tailles de sortie, issue. Les logs Docker ont une fenêtre de douze jours et
les questions arrivent toujours après.

**En sortie** : H.264 ≤ 1080p SDR BT.709, AAC stéréo, `faststart`, et les sous-titres en
VTT comme en SRT. À la location, un dossier UUID de liens symboliques est créé et servi par
lighttpd. Pas de token, pas de signature : l'URL est le secret, et elle disparaît au retour
de la K7.

---

## SUB-SYSTÈME № 3 · LA CHAÎNE CINÉMA 24/7

Une chaîne de télé qui diffuse le catalogue en boucle, sans interruption, comme si elle
émettait depuis une date de mise en service fixée une fois pour toutes.

**Le truc élégant : il n'y a pas d'état.** La position courante est une fonction pure de
l'horloge. `(maintenant − date de lancement) modulo durée totale du catalogue`, on
parcourt la liste des films triés par identifiant en accumulant les durées, et on sait
quel film passe et à quelle seconde. N'importe quel processus, sur n'importe quelle
machine, retombe sur le même résultat sans rien se dire. Les durées sont mises en cache
en base au premier ffprobe.

`cinema-stream` construit une playlist concat ffmpeg (avec un `inpoint` sur le premier
film pour démarrer pile à la bonne seconde), la duplique cinquante fois pour simuler une
boucle infinie sans logique de bouclage, et lance un ffmpeg `-re` long-running qui écrit
du HLS live : segments de 4 s, fenêtre glissante de 6 segments, GOP fixe, segments
indépendamment décodables pour qu'on puisse tomber en plein milieu. Un chien de garde
surveille la date de modification du manifeste ; plus de 30 s sans mise à jour et le
process est tué. Au redémarrage, la position est recalculée depuis l'horloge — un crash
ne fait pas prendre de retard à la chaîne, il fait juste sauter le passage manqué.

---

## SUB-SYSTÈME № 4 · LE BOT DISCORD

Il ne streame pas. C'est volontaire, et ça mérite une explication.

Les bibliothèques qui font passer de la vidéo dans un salon vocal Discord exigent toutes
un *selfbot* — un token de compte utilisateur, pas un token de bot — parce que Discord
bloque l'envoi vidéo depuis les bots officiels. C'est un aller simple vers le bannissement
du compte. On a donc coupé le problème en deux.

Le **bot officiel** lit la même base, recalcule la même position dans la playlist, et se
contente de dire ce qui passe : le statut du salon vocal (`🎬 Robocop (1987) — 23:12`) et
sa propre activité. Il rejoint le vocal en sourdine totale et n'y émet rien.

L'**image et le son** passent par une machine opérateur qui ingère le flux HLS dans une
caméra virtuelle : `v4l2loopback` sur Linux (avec un null-sink PulseAudio dont le monitor
sert de micro), OBS sur macOS. Discord voit une webcam nommée « Zone Club Cinéma » et un
humain clique sur « partager la caméra ». Cas d'usage parfaitement standard, aucune
condition d'utilisation malmenée. Deux unités systemd et un script d'installation font le
reste.

---

## SUB-SYSTÈME № 5 · LE GÉRANT

Michel tient la boutique depuis 1984. Il est bourru, il tutoie, il répond en trois
phrases et il n'utilise jamais d'emoji.

Techniquement : un LLM servi via OpenRouter (modèle configurable), branché sur le Vercel
AI SDK en streaming, avec une poignée d'outils qui ne renvoient pas du texte mais des
**composants React**. Quand Michel parle d'un film, un backdrop s'installe en fond de
conversation. Quand il propose de le louer, une carte de location cliquable apparaît dans
le fil. Il peut pré-remplir un formulaire de critique, lancer la lecture, et distribuer
des crédits — mais seulement contre une anecdote de cinéma plausible, et le barème est
d'autant plus sévère qu'on est déjà riche.

Il retient les choses. Un outil de mémorisation écrit des faits sur le client en base
(genres préférés, films détestés, anecdotes personnelles), réinjectés dans le prompt
système à la conversation suivante. Deux personas selon qu'on est inscrit ou de passage,
limitation de débit différenciée, et tracing OpenTelemetry vers Langfuse sur chaque appel.

---

## LE RESTE DU MAGASIN

**Location et crédits.** Deux copies par film, location à durée limitée, prolongation,
retour anticipé remboursé, demandes de retour entre membres, bonus hebdomadaire, et un
crédit offert si on rembobine la cassette avant de la rendre. Évidemment.

**Lecteur VHS.** Un `<video>` HTML5 déguisé : avance et retour rapides ×2/×4 (le retour
est une chaîne de seeks), compteur mécanique animé, écran bleu, bascule VF/VO,
sous-titres. Google Cast et AirPlay sont intégrés, avec une machine à états unifiée : la
session Cast survit à la fermeture du lecteur — la télé continue de jouer pendant qu'on
retourne marcher dans les rayons, et rouvrir le lecteur retombe directement en mode
télécommande.

**PWA.** Service worker à deux vitesses : cache-first sur les assets 3D immuables,
network-only sur tout le reste. Le catalogue y était en stale-while-revalidate ; il en est
sorti, parce qu'une donnée qui bouge chaque semaine ne peut pas dépendre d'un bump de
version fait à la main au déploiement — ce cache a servi pendant des jours un catalogue
antérieur à un reset de la base. Notifications push Web Push, dont celle qui prévient que
le film est terminé sur la télé pendant que le téléphone dormait — et son clic rouvre
l'app au bon endroit.

**Tests.** Pas de framework : le runner natif de Node. Une bonne partie des tests sont de
l'analyse statique du code source — audits de sécurité et de performance figés en
régressions, imports morts, budget de taille de fichier, cohérence des types de rayons
entre les trois endroits qui les déclarent. Le reste couvre le pipeline média et la
logique de collision.

---

## LA FICHE TECHNIQUE

| | |
|---|---|
| **Framework** | Next.js 15 App Router · React 19 · TypeScript strict |
| **3D** | Three.js (WebGPU + TSL) · React Three Fiber · KTX2/Basis |
| **État** | Zustand 5, persistance localStorage |
| **Base** | SQLite (`better-sqlite3`), migrations idempotentes au boot |
| **Auth** | Cookies signés httpOnly, pas de JWT · CSRF par vérification d'origine |
| **Média** | ffmpeg 7 · NVENC distant par pipe SSH · tesseract |
| **LLM** | Vercel AI SDK · OpenRouter · Langfuse |
| **Déploiement** | Docker Compose × 5, build standalone sur l'hôte, Traefik + Let's Encrypt |

---

```
        ┌────────────────────────────────────────────┐
        │  MERCI DE REMBOBINER AVANT DE RENDRE       │
        │  Location 3 jours · 1 crédit · Pas de FNAC │
        └────────────────────────────────────────────┘
```
