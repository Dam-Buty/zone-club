# Zone Club - Vidéoclub 3D Immersif

![Zone Club](https://img.shields.io/badge/Zone%20Club-Vidéoclub%203D-ff2d95)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Three.js](https://img.shields.io/badge/Three.js-R3F-black)
![SvelteKit](https://img.shields.io/badge/SvelteKit-Backend-FF3E00)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED)

Frontend 3D immersif pour Zone Club, un vidéoclub en ligne inspiré des vidéoclubs d'époque. Parcourez les rayons en vue FPS, louez des cassettes VHS et vivez l'expérience rétro des années 90.

## 🎬 Fonctionnalités

### Expérience 3D
- **Navigation FPS** dans le vidéoclub (ZQSD/WASD + souris)
- **Rayons par genre** avec cassettes VHS interactives
- **Îlot central** "NOUVEAUTÉS" avec les meilleurs films TMDB
- **Gérant 3D** (Quentin) avec animations et dialogues
- **Terminal TV rétro** pour gérer son compte

### Vidéoclub
- **Location** : 1 crédit = 1 film pour 24h
- **Crédits** : 5 à l'inscription, +1 par critique publiée
- **Critiques** : 3 notes sur 5 (réalisation, scénario, jeu d'acteur)
- **Player VHS** : switch VF/VO, sous-titres, effet tracking

### Administration
- Panel admin secret (taper "admin" dans le terminal)
- Ajout de films via ID TMDB
- Gestion de la disponibilité
- Statistiques du vidéoclub

## 🛠 Stack Technique

| Composant | Technologies |
|-----------|--------------|
| **Frontend 3D** | React 18, Three.js (React Three Fiber), TypeScript |
| **État** | Zustand avec persistance localStorage |
| **Backend** | SvelteKit, SQLite (better-sqlite3) |
| **Streaming** | lighttpd (symlinks temporaires) |
| **Téléchargement** | Radarr + Transmission |
| **Ingress** | Traefik (SSL automatique) |
| **Conteneurisation** | Docker Compose |

## 📁 Structure du Projet

```
zone-club/
├── src/                          # Frontend React 3D
│   ├── components/
│   │   ├── interior/             # Composants 3D du magasin
│   │   │   ├── Aisle.tsx         # Scène principale
│   │   │   ├── Cassette.tsx      # Cassette VHS interactive
│   │   │   ├── IslandShelf.tsx   # Îlot central
│   │   │   ├── WallShelf.tsx     # Étagères murales
│   │   │   ├── Manager3D.tsx     # Gérant Quentin
│   │   │   └── Controls.tsx      # Contrôles FPS + collisions
│   │   ├── terminal/             # Terminal TV
│   │   ├── player/               # Player vidéo VHS
│   │   └── videoclub/            # Modals et UI
│   ├── api/                      # Client API backend
│   ├── services/                 # Services (TMDB)
│   ├── store/                    # Zustand store
│   └── types/                    # Types TypeScript
│
├── backend-zone-club/            # Backend SvelteKit
│   ├── app/
│   │   ├── src/
│   │   │   ├── lib/server/       # Modules backend
│   │   │   └── routes/           # Routes API + SSR
│   │   └── Dockerfile
│   └── docker-compose.yml        # (ancien, utilisez celui à la racine)
│
├── docker-compose.yml            # Configuration Docker complète
├── Dockerfile                    # Build frontend
├── nginx.conf                    # Config nginx pour SPA
├── DEPLOYMENT.md                 # Guide de déploiement détaillé
├── CLAUDE.md                     # Documentation technique frontend
└── .env.example                  # Variables d'environnement
```

## 🚀 Démarrage Rapide

### Développement Local

```bash
# 1. Cloner le projet
git clone <url> zone-club
cd zone-club

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec votre clé TMDB

# 3. Frontend (terminal 1)
npm install
npm run dev
# → http://localhost:5173

# 4. Backend (terminal 2)
cd backend-zone-club/app
npm install
npm run dev
# → http://localhost:5173 (SvelteKit)
```

### Production (Docker)

```bash
# 1. Configurer
cp .env.example .env
nano .env  # Remplir toutes les variables

# 2. Lancer
docker compose up -d

# 3. Vérifier
docker compose ps
docker compose logs -f
```

Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour le guide complet.

## 🐳 Architecture Docker

```
Traefik (externe)
├── videoclub.example.com    → nginx (frontend 3D)
├── zone-api.example.com     → SvelteKit API
└── zone-storage.example.com → lighttpd (streaming)

Interne:
└── zone-radarr (port 7878)  → Gestion catalogue
```

## ⚙️ Variables d'Environnement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DOMAIN` | Domaine principal | `example.com` |
| `FRONTEND_SUBDOMAIN` | Sous-domaine frontend 3D | `videoclub` |
| `SUBDOMAIN` | Sous-domaine API | `zone-api` |
| `STORAGE_SUBDOMAIN` | Sous-domaine streaming | `zone-storage` |
| `TMDB_API_KEY` | Clé API TMDB | [themoviedb.org](https://www.themoviedb.org/settings/api) |
| `RADARR_API_KEY` | Clé API Radarr | Settings > General |
| `HMAC_SECRET` | Secret sessions | `openssl rand -hex 32` |
| `TRANSMISSION_DOWNLOADS` | Chemin downloads | `/var/lib/transmission/downloads` |

## 🎮 Contrôles

| Touche | Action |
|--------|--------|
| `Z/W` | Avancer |
| `S` | Reculer |
| `Q/A` | Gauche |
| `D` | Droite |
| `Souris` | Regarder |
| `Clic` | Interagir |
| `Échap` | Quitter l'interaction |

## 📖 Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md) - Guide de déploiement complet
- [CLAUDE.md](CLAUDE.md) - Documentation technique frontend
- [backend-zone-club/CLAUDE.md](backend-zone-club/CLAUDE.md) - Documentation backend

## 🔧 Commandes Utiles

```bash
# Rebuild frontend
docker compose build --no-cache frontend && docker compose up -d frontend

# Rebuild backend
docker compose build --no-cache sveltekit && docker compose up -d sveltekit

# Logs en temps réel
docker compose logs -f

# Accéder au container backend
docker exec -it zone-app sh

# Backup base de données
docker cp zone-app:/data/zone.db ./backup.db

# Promouvoir un utilisateur admin
docker exec -it zone-app node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/zone.db');
db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run('pseudo');
"
```

## 🤝 Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📝 Licence

Ce projet est sous licence MIT.

---

Développé avec ❤️ pour les nostalgiques des vidéoclubs
