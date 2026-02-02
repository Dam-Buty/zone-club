# VideoClub 2.0 — Project Brief

## Vision

Un vidéoclub virtuel immersif dans le navigateur, avec une esthétique néon/synthwave années 80. L'utilisateur se retrouve au centre d'une allée de vidéoclub et peut naviguer entre les rayons, interagir avec des cassettes VHS, et louer des films via un système de crédits gamifié. Le tout est animé par un gérant de vidéoclub — un nerd passionné façon Tarantino — qui fait des suggestions personnalisées et partage des anecdotes.

---

## Core Features

### 1. Environnement 3D du Vidéoclub (WebGPU)

**Vue principale : L'allée centrale**
- Perspective first-person au centre d'une allée de vidéoclub
- Étagères de cassettes VHS des deux côtés
- Navigation par rayon/genre (Action, Horreur, SF, Comédie, Classiques, Nouveautés, "Le Coin Bizarre")
- ~20 films visibles par rayon sous forme de cassettes avec jaquettes
- Éclairage néon dynamique (rose, cyan, violet) avec reflets sur sol type carrelage brillant
- Effets de parallaxe subtils au mouvement de souris

**Interactions**
- Hover sur cassette : légère mise en avant, lueur
- Click sur cassette : ouverture de la fiche film (overlay ou transition)
- Navigation entre rayons : transition fluide (travelling latéral ou menu)

**Ambiance**
- Bourdonnement léger de néons (audio optionnel)
- Grain VHS subtil en overlay
- Scanlines optionnelles

### 2. Système de Cassettes VHS

**Composant Cassette**
- Jaquette du film (image TMDB poster)
- Tranche visible avec titre
- États visuels : disponible, loué, nouveauté (sticker), coup de cœur staff (sticker)
- Animation de "sortie du rayon" au click

**Fiche Film (Detail View)**
- Backdrop TMDB en fond
- Poster
- Titre, année, durée, genres
- Synopsis
- Note moyenne (étoiles)
- Bouton "Louer" (coût en crédits)
- Section critiques des membres
- **Suggestion du gérant** : recommandation d'un second film lié, avec justification personnalisée

### 3. Le Gérant — Agent Conversationnel

**Personnalité**
- Nerd assumé, anti-beau-gosse, look négligé mais regard allumé
- A vu TOUS les films, y compris versions alternatives, director's cuts
- A lu les scénarios même des films jamais sortis
- Style Tarantino : digressions passionnées, opinions tranchées, connexions inattendues
- Vocabulaire : "ce plan-séquence, mec !", "c'est du PUR cinéma", "la mise en scène est DINGUE"

**Représentation visuelle**
- Illustration stylisée (style comics/Archer)
- Apparaît en périphérie de l'écran ou depuis une allée
- Animations : sort d'un rayon, ajuste ses lunettes, pose son café
- Bulle de dialogue stylisée

**Triggers d'apparition**
- **Passif (il vient vers toi)** :
  - Fixation d'une jaquette > 5 secondes → bulle "Tu veux que je te parle de celui-là ?"
  - Hésitation entre 2 films → "Ah, le dilemme classique !"
  - Retour répété dans un rayon → "Je vois que t'es branché [genre]..."
  - Après une location → "Quand t'auras fini, reviens me voir"
- **Actif (sonnette)** :
  - Bouton clochette de comptoir toujours accessible
  - Animation d'arrivée + "Ouais ? Qu'est-ce que je peux faire pour toi ?"

**Fonctionnalités**
- Anecdotes sur n'importe quel film (tournage, influences, réception)
- Suggestions personnalisées basées sur l'historique
- Comparaisons et connexions entre films
- Mémoire des conversations précédentes (stockée côté client ou backend)
- **Suggestion du second film** : quand l'utilisateur loue, le gérant propose un film complémentaire avec justification
- **Récompense conversation** : échange prolongé (3+ échanges) → offre de crédit bonus ou film gratuit

**Implémentation technique (placeholder pour v1)**
- Interface de chat intégrée
- Appels à un endpoint backend (RAG existant ou à venir)
- Pour le mock : réponses pré-scriptées basées sur le film_id

### 4. Système de Crédits & Gamification

**Économie**
- Crédits initiaux à l'inscription : X crédits
- Coût location : variable selon film (nouveauté = plus cher)
- Durée location : 48h / 72h / 1 semaine selon tier

**Gains de crédits**
- Écrire une critique : +Y crédits
- Critique détaillée (>200 mots) : bonus
- Premier à critiquer un film : badge "Découvreur"
- Interaction prolongée avec le gérant : crédit bonus occasionnel

**Carte de membre**
- Niveaux : Bronze → Argent → Or → Platine
- Avantages par niveau : durée location étendue, accès anticipé nouveautés, section "Réserve"

**Badges**
- "Premier avis"
- "Critique prolifique" (10+ critiques)
- "Découvreur de pépites"
- "Habitué" (X locations)

### 5. Rayons & Navigation

**Rayons disponibles**
- Nouveautés (présentoir central rotatif)
- Action
- Horreur
- Science-Fiction
- Comédie
- Classiques
- "Le Coin Bizarre" (films de niche, cult)
- Coups de cœur staff

**Navigation**
- Menu overlay ou navigation spatiale dans la scène 3D
- Breadcrumb visuel (où suis-je)
- Retour à l'entrée du vidéoclub

### 6. Structure de l'Interface

```
┌─────────────────────────────────────────────────────────┐
│  [Logo Néon]     [Crédits: XX]  [Carte Membre]  [🔔]   │  ← Header
├─────────────────────────────────────────────────────────┤
│                                                         │
│                   ┌─────────────────┐                   │
│   [Rayon gauche]  │   ALLÉE 3D      │  [Rayon droite]  │
│                   │   (WebGPU)      │                   │
│                   │                 │                   │
│                   │   Cassettes     │                   │
│                   │   visibles      │                   │
│                   └─────────────────┘                   │
│                                                         │
│  [Menu rayons]              [Sonnette gérant]           │
├─────────────────────────────────────────────────────────┤
│  [Chat gérant - réductible]                             │  ← Footer/Overlay
└─────────────────────────────────────────────────────────┘
```

---

## Technical Stack

### Core
- **Framework** : React 18+ avec TypeScript
- **Rendu 3D** : WebGPU API native (pas de fallback WebGL pour v1)
- **State Management** : Zustand ou Jotai (léger, adapté)
- **Routing** : React Router v6

### WebGPU Specifics
- Renderer custom ou wrapper léger
- Shaders WGSL pour effets néon (bloom, glow)
- Géométrie simple : planes pour cassettes, cubes pour étagères
- Textures : jaquettes TMDB chargées dynamiquement
- Post-processing : grain VHS, scanlines, chromatic aberration légère

### Data
- **API externe** : TMDB (The Movie Database)
  - Posters : `https://image.tmdb.org/t/p/w500/{poster_path}`
  - Backdrops : `https://image.tmdb.org/t/p/original/{backdrop_path}`
  - Metadata : titre, synopsis, genres, date, runtime, vote_average
- **Mock data** : JSON local avec liste de film_ids TMDB par rayon
- **Backend** : endpoints existants (auth, locations, crédits, critiques) — non concerné ici

### Structure Projet Proposée

```
src/
├── components/
│   ├── ui/                    # Composants React UI (header, modals, buttons)
│   ├── videoclub/             # Composants métier (FilmCard, RentalModal, etc.)
│   └── manager/               # Gérant (avatar, chat, triggers)
├── webgpu/
│   ├── core/                  # Initialisation WebGPU, context, renderer
│   ├── shaders/               # Fichiers WGSL
│   ├── scenes/                # Scène principale (Aisle), objets (Shelf, Cassette)
│   ├── effects/               # Post-processing (neon glow, vhs grain)
│   └── utils/                 # Helpers (texture loader, geometry builders)
├── hooks/
│   ├── useWebGPU.ts           # Hook initialisation WebGPU
│   ├── useFilmData.ts         # Hook fetch TMDB
│   ├── useManagerTriggers.ts  # Hook triggers gérant
│   └── useCredits.ts          # Hook système crédits (mock)
├── store/
│   └── index.ts               # Zustand store (user, rentals, credits, currentRayon)
├── services/
│   ├── tmdb.ts                # Service API TMDB
│   └── manager.ts             # Service mock gérant (réponses)
├── data/
│   └── mock/
│       ├── films.json         # Film IDs par rayon
│       ├── manager-responses.json  # Réponses pré-scriptées gérant
│       └── user.json          # User mock (crédits, historique)
├── styles/
│   └── globals.css            # Variables CSS, fonts, neon effects CSS
├── types/
│   └── index.ts               # Types TypeScript (Film, User, Rental, etc.)
├── App.tsx
└── main.tsx
```

---

## Mock Data Strategy

### Films (data/mock/films.json)
```json
{
  "nouveautes": [550, 238, 424, ...],      // TMDB IDs
  "action": [27205, 155, 78, ...],
  "horreur": [694, 539, 1091, ...],
  "sf": [603, 157336, 274, ...],
  "comedie": [18785, 109445, 508442, ...],
  "classiques": [238, 240, 278, ...],
  "bizarre": [1051896, 10681, 9426, ...]
}
```

### Manager Responses (data/mock/manager-responses.json)
```json
{
  "greeting": [
    "Ah, un connaisseur ! Qu'est-ce que tu cherches ?",
    "Bienvenue dans mon antre. T'as l'air de quelqu'un qui sait ce qu'il veut."
  ],
  "film_anecdotes": {
    "550": {  // Fight Club
      "anecdotes": [
        "Tu savais que Fincher a fait refaire le générique de début 50 fois ?",
        "La scène du bus, mec. Pitt s'est vraiment fait frapper. VRAIMENT."
      ],
      "suggestion": {
        "film_id": 807,
        "reason": "Si t'aimes Fight Club, faut que tu voies Se7en. Même Fincher, même ambiance poisseuse, même Brad Pitt qui en prend plein la gueule."
      }
    }
  },
  "rayon_remarks": {
    "horreur": "Ah, un amateur de sensations fortes. Respect.",
    "sf": "La SF, c'est pas que des lasers. C'est de la philosophie avec des vaisseaux."
  }
}
```

---

## Design Tokens (Neon 80s Theme)

```css
:root {
  /* Colors */
  --neon-pink: #ff2d95;
  --neon-cyan: #00fff7;
  --neon-purple: #b026ff;
  --neon-yellow: #fff600;
  --dark-bg: #0a0a0f;
  --darker-bg: #050508;
  --card-bg: rgba(20, 20, 30, 0.8);
  
  /* Glow effects */
  --glow-pink: 0 0 10px #ff2d95, 0 0 20px #ff2d95, 0 0 40px #ff2d95;
  --glow-cyan: 0 0 10px #00fff7, 0 0 20px #00fff7, 0 0 40px #00fff7;
  
  /* Typography */
  --font-display: 'Orbitron', sans-serif;  /* Titres néon */
  --font-body: 'Inter', sans-serif;        /* Texte courant */
  --font-retro: 'VCR OSD Mono', monospace; /* Éléments VHS */
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 48px;
}
```

---

## Phase 1 Deliverables (MVP)

1. **WebGPU Scene** : Allée centrale avec 1 rayon (20 cassettes), navigation basique
2. **Cassette Component** : Jaquette TMDB, hover state, click → fiche
3. **Film Detail Modal** : Infos TMDB, bouton louer (mock)
4. **Gérant (v1)** : Illustration statique, chat basique avec réponses mock
5. **Header** : Logo, crédits affichés, sonnette gérant
6. **Données** : Fetch TMDB fonctionnel, mock films.json

---

## Contraintes & Notes

- **WebGPU uniquement** : Pas de fallback WebGL. Navigateurs supportés : Chrome 113+, Edge 113+, Firefox Nightly avec flag
- **Performance** : Cibler 60fps sur GPU intégré récent
- **Responsive** : Desktop first, mobile sera une v2
- **Accessibilité** : Navigation clavier dans l'UI React, alt-text sur jaquettes
- **TMDB API Key** : Sera fournie via .env (VITE_TMDB_API_KEY)

---

## Questions Ouvertes pour Brainstorm

1. Préférence pour la navigation 3D : clavier (WASD) vs souris uniquement vs click-to-move ?
2. Le gérant doit-il avoir une voix (TTS) ou rester text-only ?
3. Faut-il une "entrée" du vidéoclub (porte, comptoir) ou direct dans l'allée ?
4. Animation de location : la cassette "sort" et va dans un sac ? Ou transition directe ?

---

## Commande Superpowers Suggérée

Une fois ce brief validé, lancer :

```
/superpowers:brainstorm
```

Puis coller ce document pour que l'agent affine les détails techniques et propose un design document formel.

Ensuite :

```
/superpowers:write-plan
```

Pour générer le plan d'implémentation task-by-task.
