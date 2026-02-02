# Zone Club - Backend API

Backend SvelteKit pour Zone Club, un vidéoclub en ligne inspiré des vidéoclubs d'époque.

> **Note** : Ce backend est utilisé par le [Frontend 3D React](../README.md). Pour le déploiement complet, voir [DEPLOYMENT.md](../DEPLOYMENT.md).

## Stack

- **Backend** : SvelteKit (Svelte 5, TypeScript)
- **Base de données** : SQLite (better-sqlite3)
- **Streaming** : lighttpd (fichiers vidéo via symlinks temporaires)
- **Téléchargement** : Radarr + Transmission
- **Ingress** : Traefik

## Architecture

```
Traefik (externe)
├── ${FRONTEND_SUBDOMAIN}.${DOMAIN} → Frontend 3D React (nginx)
├── ${SUBDOMAIN}.${DOMAIN}          → SvelteKit API (port 3000)
└── ${STORAGE_SUBDOMAIN}.${DOMAIN}  → lighttpd (port 80)

SvelteKit ←→ SQLite (local)
         ←→ Radarr API → Transmission → fichiers MP4
         ←→ Symlinks → lighttpd → streaming vidéo
```

## Fonctionnalités

- **Rayons** : navigation par genre de films
- **Location** : 1 crédit = 1 film pour 24h, un seul locataire à la fois
- **Crédits** : 5 à l'inscription, +1 par critique publiée
- **Critiques** : 500 caractères minimum, 3 notes sur 5 (réalisation, scénario, jeu d'acteur)
- **Streaming** : switch VF/VO dans le player, sous-titres français
- **Auth** : pseudo + mot de passe, passphrase de récupération culinaire française
- **Admin** : ajout de films par ID TMDB, gestion de la disponibilité

## Développement Local

```bash
cd app
npm install
npm run dev
```

La base SQLite sera créée automatiquement au premier lancement.

## Déploiement Docker

Voir le fichier [docker-compose.yml](../docker-compose.yml) à la racine du projet parent.

```bash
# Depuis la racine du projet parent
docker compose up -d
```

## API REST

Le frontend 3D utilise exclusivement l'API REST. Voir [CLAUDE.md](./CLAUDE.md) pour la documentation complète des endpoints.

### Endpoints principaux

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/auth/login` | POST | Connexion |
| `/api/auth/register` | POST | Inscription |
| `/api/films` | GET | Liste des films |
| `/api/films/[tmdbId]` | GET | Détails d'un film |
| `/api/films/genre/[slug]` | GET | Films par genre |
| `/api/rentals/[filmId]` | POST | Louer un film |
| `/api/reviews/[filmId]` | GET/POST | Critiques |
| `/api/me` | GET | Profil utilisateur |
| `/api/admin/*` | * | Administration |

## Variables d'environnement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_PATH` | Chemin DB SQLite | `/data/zone.db` |
| `DOMAIN` | Domaine principal | `example.com` |
| `SUBDOMAIN` | Sous-domaine API | `zone-api` |
| `STORAGE_SUBDOMAIN` | Sous-domaine streaming | `zone-storage` |
| `RADARR_URL` | URL Radarr | `http://radarr:7878` |
| `RADARR_API_KEY` | Clé API Radarr | |
| `TMDB_API_KEY` | Clé API TMDB | |
| `HMAC_SECRET` | Secret sessions | |

## Flux d'ajout d'un film

1. L'admin saisit un ID TMDB (via terminal 3D ou `/admin/films`)
2. L'app récupère les métadonnées TMDB (titre FR, synopsis, casting, jaquette FR)
3. Le film est ajouté dans Radarr qui lance le téléchargement
4. Une fois les fichiers prêts, l'admin active le film
5. Le film apparaît dans les rayons pour les utilisateurs

## Flux de location

1. L'utilisateur clique sur une cassette dans le frontend 3D → modal → "Louer"
2. Des symlinks sont créés vers les fichiers VO/VF/sous-titres dans `/media/public/symlinks/{uuid}/`
3. lighttpd sert ces fichiers pendant 24h
4. Un cleanup automatique (toutes les 5 min) nettoie les symlinks expirés

## Documentation technique

Voir [CLAUDE.md](./CLAUDE.md) pour :
- Architecture détaillée du code
- Conventions de développement
- Points d'attention
- Intégration avec le frontend 3D
