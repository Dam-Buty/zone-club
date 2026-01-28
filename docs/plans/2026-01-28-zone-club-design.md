# Zone Club - Design Document

> Vidéoclub rétro inspiré des vidéoclubs d'époque

## Vue d'ensemble

Site web permettant aux utilisateurs de parcourir des "rayons" (genres de films), louer des films avec un système de crédits, et écrire des critiques pour gagner des crédits supplémentaires.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          TRAEFIK                                │
│    (ingress + SSL + routing par subdomain)                      │
└──────────────┬────────────────────────┬─────────────────────────┘
               │                        │
    ${SUBDOMAIN}.${DOMAIN}    ${SUBDOMAIN}-storage.${DOMAIN}
               │                        │
               ▼                        ▼
┌──────────────────────┐    ┌──────────────────────┐
│      SVELTEKIT       │    │      LIGHTTPD        │
│  (app + API + auth)  │    │   (fichiers vidéo)   │
└──────────┬───────────┘    └──────────────────────┘
           │                           ▲
           ▼                           │ volume partagé
┌──────────────────────┐    ┌──────────────────────┐
│       RADARR         │───▶│    /media/films/     │
│  (gestion downloads) │    │  (stockage vidéos)   │
└──────────────────────┘    └──────────────────────┘
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend/Backend | SvelteKit |
| Base de données | SQLite |
| Streaming fichiers | lighttpd |
| Ingress/SSL | Traefik v3 |
| Gestion films | Radarr |
| Téléchargement | Transmission (existant sur l'hôte) |
| Conteneurisation | Docker Compose |

## Schéma de base de données

```sql
-- Utilisateurs
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  recovery_phrase_hash  TEXT NOT NULL,
  credits         INTEGER DEFAULT 5,
  is_admin        BOOLEAN DEFAULT FALSE,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Films
CREATE TABLE films (
  id              INTEGER PRIMARY KEY,
  tmdb_id         INTEGER UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  title_original  TEXT,
  synopsis        TEXT,
  release_year    INTEGER,
  poster_url      TEXT,
  genres          TEXT,      -- JSON array
  directors       TEXT,      -- JSON array [{name, tmdb_id}]
  actors          TEXT,      -- JSON array [{name, character, tmdb_id}]
  file_path_vf    TEXT,
  file_path_vo    TEXT,
  subtitle_path   TEXT,
  is_available    BOOLEAN DEFAULT FALSE,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Genres (rayons)
CREATE TABLE genres (
  id              INTEGER PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,
  slug            TEXT UNIQUE NOT NULL
);

-- Relation films <-> genres
CREATE TABLE film_genres (
  film_id         INTEGER REFERENCES films(id),
  genre_id        INTEGER REFERENCES genres(id),
  PRIMARY KEY (film_id, genre_id)
);

-- Locations
CREATE TABLE rentals (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  film_id         INTEGER REFERENCES films(id),
  symlink_uuid    TEXT NOT NULL,
  rented_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE
);

-- Critiques
CREATE TABLE reviews (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  film_id         INTEGER REFERENCES films(id),
  content         TEXT NOT NULL,
  rating_direction    INTEGER NOT NULL CHECK(rating_direction BETWEEN 1 AND 5),
  rating_screenplay   INTEGER NOT NULL CHECK(rating_screenplay BETWEEN 1 AND 5),
  rating_acting       INTEGER NOT NULL CHECK(rating_acting BETWEEN 1 AND 5),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, film_id)
);
```

## Système de crédits

| Action | Crédits |
|--------|---------|
| Inscription | +5 |
| Rédiger une critique | +1 |
| Louer un film | -1 |

### Contraintes pour écrire une critique
- L'utilisateur doit avoir loué le film au moins une fois
- Une seule critique par film par utilisateur
- Minimum 500 caractères
- Les 3 notes obligatoires (réalisation, scénario, jeu d'acteur) de 1 à 5

## Authentification

### Inscription
1. Choix pseudo unique + mot de passe
2. Génération passphrase de récupération : `{plat}-{origine}-{qualificatif}`
3. Affichage unique de la passphrase
4. Stockage du hash bcrypt

### Passphrase culinaire française
Format : `plat-origine-qualificatif`
Exemple : `tartiflette-savoyarde-gratinée`

Dictionnaires de ~200 mots chacun = ~8 millions de combinaisons

### Récupération
1. Saisie pseudo + passphrase
2. Si valide : nouveau mot de passe + nouvelle passphrase générée

## Streaming vidéo

### Sécurisation par symlinks
Lors d'une location :
```
/media/public/symlinks/{uuid}/
    ├── film_vf.mp4  → /media/films/{tmdb_id}/vf.mp4
    ├── film_vo.mp4  → /media/films/{tmdb_id}/vo.mp4
    └── subs_fr.vtt  → /media/films/{tmdb_id}/subs_fr.vtt
```

URL de streaming : `https://${SUBDOMAIN}-storage.${DOMAIN}/{uuid}/film_vf.mp4`

### Nettoyage (cron toutes les 5 min)
1. Sélection des rentals expirés et actifs
2. Suppression des dossiers symlinks
3. Marquage `is_active = FALSE`

## Gestion VO/VF
- Les deux versions accessibles pendant la location
- Switch dans le player HTML5 natif
- Sous-titres français disponibles sur les deux versions

## Pages de l'application

### Publiques
- `/` - Accueil
- `/login` - Connexion
- `/register` - Inscription
- `/recover` - Récupération

### Authentifiées
- `/rayons` - Liste des genres
- `/rayons/{slug}` - Films d'un genre
- `/film/{tmdb_id}` - Fiche film
- `/film/{tmdb_id}/watch` - Player vidéo
- `/film/{tmdb_id}/review` - Formulaire critique
- `/compte` - Profil utilisateur

### Admin
- `/admin/films` - Gestion catalogue
- `/admin/films/add` - Ajout par ID TMDB

## Docker Compose

```yaml
services:
  traefik:
    image: traefik:v3
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik:/etc/traefik

  sveltekit:
    build: ./app
    environment:
      - DATABASE_PATH=/data/zone.db
      - DOMAIN=${DOMAIN}
      - SUBDOMAIN=${SUBDOMAIN}
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=${RADARR_API_KEY}
      - TMDB_API_KEY=${TMDB_API_KEY}
    volumes:
      - db_data:/data
      - media_films:/media/films:ro
      - media_public:/media/public:rw
    labels:
      - "traefik.http.routers.app.rule=Host(`${SUBDOMAIN}.${DOMAIN}`)"

  lighttpd:
    image: sebp/lighttpd
    volumes:
      - media_films:/media/films:ro
      - media_public:/media/public:ro
      - ./lighttpd.conf:/etc/lighttpd/lighttpd.conf:ro
    labels:
      - "traefik.http.routers.storage.rule=Host(`${SUBDOMAIN}-storage.${DOMAIN}`)"

  radarr:
    image: linuxserver/radarr
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - radarr_config:/config
      - media_films:/media/films:rw
      - downloads:/downloads

volumes:
  db_data:
  media_films:
  media_public:
  radarr_config:
  downloads:
```

## Variables d'environnement

```
DOMAIN=example.com
SUBDOMAIN=zone
RADARR_API_KEY=xxx
TMDB_API_KEY=xxx
```

## Flux d'ajout d'un film

1. Admin saisit l'ID TMDB dans l'interface
2. SvelteKit fetch la metadata TMDB
3. Ajout du film dans Radarr via API
4. Radarr télécharge VO + VF + sous-titres
5. Admin marque le film comme disponible

## États d'un film

| État | Affichage | Action |
|------|-----------|--------|
| Disponible | Normal | [Louer] 1 crédit |
| Loué par toi | Highlight | [Regarder] + temps restant |
| Loué par autre | Grisé | Indisponible |
