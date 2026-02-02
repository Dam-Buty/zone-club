# Guide de Déploiement - Zone Club

Ce guide explique comment déployer Zone Club (frontend 3D + backend) en production avec Docker.

## Prérequis

### Serveur
- Docker + Docker Compose v2
- Traefik configuré avec le Docker socket
- Ports 80/443 ouverts
- Certificats SSL via Let's Encrypt (géré par Traefik)

### Services externes
- **Transmission** : Client torrent installé sur l'hôte
- **Clé API TMDB** : [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

### DNS
Configurer 3 enregistrements A pointant vers votre serveur :
```
videoclub.example.com    → IP_SERVEUR
zone-api.example.com     → IP_SERVEUR
zone-storage.example.com → IP_SERVEUR
```

## Installation

### 1. Cloner le projet

```bash
git clone <url-du-repo> zone-club
cd zone-club
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
nano .env
```

Remplir les valeurs :

```bash
# Domaine principal (sans sous-domaine)
DOMAIN=example.com

# Sous-domaines
FRONTEND_SUBDOMAIN=videoclub      # Frontend 3D
SUBDOMAIN=zone-api                # API Backend
STORAGE_SUBDOMAIN=zone-storage    # Streaming vidéo

# Clés API
TMDB_API_KEY=votre_cle_tmdb       # Obtenir sur themoviedb.org
RADARR_API_KEY=                   # Sera rempli après config Radarr

# Sécurité (générer une chaîne aléatoire)
HMAC_SECRET=$(openssl rand -hex 32)

# Chemin vers les téléchargements Transmission sur l'hôte
TRANSMISSION_DOWNLOADS=/var/lib/transmission-daemon/downloads
```

### 3. Configurer Traefik (si pas déjà fait)

Traefik doit être sur le même réseau Docker que les containers.

Exemple `traefik.yml` minimal :
```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: votre@email.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web

providers:
  docker:
    exposedByDefault: false
```

### 4. Lancer les services

```bash
docker compose up -d
```

Vérifier que tout est lancé :
```bash
docker compose ps
```

Résultat attendu :
```
NAME            STATUS
zone-frontend   Up
zone-app        Up
zone-storage    Up
zone-radarr     Up
```

### 5. Configurer Radarr

1. Accéder à Radarr : `http://IP_SERVEUR:7878`

2. **Settings > Media Management** :
   - Root Folder : `/movies`

3. **Settings > Download Clients** :
   - Ajouter Transmission
   - Host : `host.docker.internal`
   - Port : `9091`
   - Tester la connexion

4. **Settings > General** :
   - Copier la clé API

5. Mettre à jour `.env` avec la clé Radarr :
   ```bash
   RADARR_API_KEY=votre_cle_radarr
   ```

6. Relancer les services :
   ```bash
   docker compose up -d
   ```

### 6. Créer un administrateur

```bash
# Se connecter au container backend
docker exec -it zone-app sh

# Créer un compte via l'interface d'abord, puis le promouvoir admin
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/zone.db');
db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run('votre_pseudo');
console.log('Admin créé !');
"

# Quitter
exit
```

## Architecture Finale

```
Internet
    │
    ▼
┌─────────┐
│ Traefik │ (reverse proxy + SSL)
└────┬────┘
     │
     ├── videoclub.example.com ──► zone-frontend (nginx:80)
     │                              └── React 3D App
     │
     ├── zone-api.example.com ───► zone-app (node:3000)
     │                              └── SvelteKit API
     │                              └── SQLite DB
     │
     └── zone-storage.example.com ► zone-storage (lighttpd:80)
                                    └── Fichiers vidéo
                                    └── Symlinks temporaires

zone-radarr (linuxserver/radarr:7878)
    └── Gestion catalogue
    └── Téléchargements via Transmission
```

## Gestion

### Logs

```bash
# Tous les services
docker compose logs -f

# Un service spécifique
docker compose logs -f frontend
docker compose logs -f sveltekit
```

### Rebuild après modification

```bash
# Frontend uniquement
docker compose build --no-cache frontend
docker compose up -d frontend

# Backend uniquement
docker compose build --no-cache sveltekit
docker compose up -d sveltekit

# Tout
docker compose build --no-cache
docker compose up -d
```

### Backup

```bash
# Base de données
docker cp zone-app:/data/zone.db ./backup-zone.db

# Config Radarr
docker cp zone-radarr:/config ./backup-radarr/
```

### Mise à jour

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

## Dépannage

### Le frontend ne charge pas

```bash
# Vérifier les logs nginx
docker compose logs frontend

# Vérifier que le build a fonctionné
docker compose exec frontend ls -la /usr/share/nginx/html
```

### Erreur API "Failed to fetch"

1. Vérifier que `VITE_API_URL` est correct dans `.env`
2. Vérifier les CORS côté backend
3. Vérifier les logs : `docker compose logs sveltekit`

### Vidéos ne se lancent pas

1. Vérifier que le film a des fichiers configurés (admin)
2. Vérifier lighttpd : `docker compose logs lighttpd`
3. Vérifier les symlinks : `docker compose exec zone-app ls -la /media/public/symlinks/`

### Radarr ne télécharge pas

1. Vérifier la connexion Transmission dans Radarr
2. Vérifier que `host.docker.internal` résout correctement
3. Vérifier les permissions sur `TRANSMISSION_DOWNLOADS`

## Variables d'environnement - Référence

| Variable | Obligatoire | Description | Exemple |
|----------|-------------|-------------|---------|
| `DOMAIN` | ✅ | Domaine principal | `example.com` |
| `FRONTEND_SUBDOMAIN` | ✅ | Sous-domaine frontend | `videoclub` |
| `SUBDOMAIN` | ✅ | Sous-domaine API | `zone-api` |
| `STORAGE_SUBDOMAIN` | ✅ | Sous-domaine streaming | `zone-storage` |
| `TMDB_API_KEY` | ✅ | Clé API TMDB | `abc123...` |
| `RADARR_API_KEY` | ✅ | Clé API Radarr | `xyz789...` |
| `HMAC_SECRET` | ✅ | Secret sessions (32+ chars) | `openssl rand -hex 32` |
| `TRANSMISSION_DOWNLOADS` | ✅ | Chemin downloads hôte | `/var/lib/transmission/downloads` |

## Ports utilisés

| Service | Port interne | Exposé via Traefik |
|---------|--------------|-------------------|
| Frontend (nginx) | 80 | ✅ HTTPS |
| Backend (SvelteKit) | 3000 | ✅ HTTPS |
| Storage (lighttpd) | 80 | ✅ HTTPS |
| Radarr | 7878 | ❌ (accès direct IP:7878) |
