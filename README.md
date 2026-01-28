# Zone Club

Vidéoclub en ligne inspiré des vidéoclubs d'époque. Les utilisateurs parcourent des rayons (genres), louent des films avec un système de crédits, et écrivent des critiques pour en gagner.

## Stack

- **Frontend/Backend** : SvelteKit (Svelte 5, TypeScript)
- **Base de données** : SQLite (better-sqlite3)
- **Streaming** : lighttpd (fichiers vidéo via symlinks temporaires)
- **Téléchargement** : Radarr + Transmission (existant sur l'hôte)
- **Ingress** : Traefik (externe, déjà installé sur la machine)

## Architecture

```
Traefik (externe)
├── ${SUBDOMAIN}.${DOMAIN}         → SvelteKit (port 3000)
└── ${STORAGE_SUBDOMAIN}.${DOMAIN} → lighttpd (port 80)

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
- **Auth** : pseudo + mot de passe, passphrase de récupération culinaire française (ex: `tartiflette-savoyarde-gratinée`)
- **Admin** : ajout de films par ID TMDB, gestion de la disponibilité

## Prérequis

- Docker + Docker Compose
- Traefik configuré avec le Docker socket
- Transmission installé sur l'hôte
- Clé API TMDB ([themoviedb.org](https://www.themoviedb.org/settings/api))

## Installation

```bash
# 1. Cloner et configurer
cp .env.example .env
# Remplir les valeurs dans .env

# 2. Lancer
docker compose up -d

# 3. Configurer Radarr
# Accéder à Radarr via son port (7878) et configurer :
# - Root folder : /movies
# - Download client : Transmission sur host.docker.internal
# - Quality profile selon préférence
# - Récupérer la clé API dans Settings > General

# 4. Créer un admin
# Se connecter au container et ouvrir la DB :
docker exec -it zone-app sh
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/zone.db');
db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run('ton_pseudo');
"
```

## Variables d'environnement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DOMAIN` | Domaine principal | `example.com` |
| `SUBDOMAIN` | Sous-domaine de l'app | `zone` |
| `STORAGE_SUBDOMAIN` | Sous-domaine du streaming | `zone-storage` |
| `RADARR_API_KEY` | Clé API Radarr | |
| `TMDB_API_KEY` | Clé API TMDB | |
| `HMAC_SECRET` | Secret pour signer les sessions | |
| `TRANSMISSION_DOWNLOADS` | Chemin des téléchargements Transmission | `/var/lib/transmission/downloads` |

## Flux d'ajout d'un film

1. L'admin saisit un ID TMDB dans `/admin/films`
2. L'app récupère les métadonnées TMDB (titre FR, synopsis, casting, jaquette FR)
3. Le film est ajouté dans Radarr qui lance le téléchargement
4. Une fois les fichiers prêts, l'admin active le film (bouton "Activer")
5. Le film apparaît dans les rayons pour les utilisateurs

## Flux de location

1. L'utilisateur clique "Louer" sur une fiche film (coûte 1 crédit)
2. Des symlinks sont créés vers les fichiers VO/VF/sous-titres dans un dossier UUID
3. lighttpd sert ces fichiers pendant 24h
4. Un cron nettoie les symlinks expirés et marque les locations comme inactives

## Développement

```bash
cd app
npm install
npm run dev
```

La base SQLite sera créée automatiquement au premier lancement.
