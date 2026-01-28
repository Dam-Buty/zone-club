# CLAUDE.md

## Projet

Zone Club - vidéoclub en ligne avec SvelteKit + SQLite + Docker.

## Commandes

```bash
# Dev
cd app && npm run dev

# Type check
cd app && npm run check

# Build
cd app && npm run build

# Docker
docker compose up -d
docker compose build --no-cache sveltekit
```

## Architecture du code

### Backend (`app/src/lib/server/`)

Tout le backend est dans des modules TypeScript serveur-only :

- `db.ts` - Singleton SQLite, exécute `schema.sql` au démarrage
- `schema.sql` - DDL complet (users, films, genres, film_genres, rentals, reviews)
- `auth.ts` - Register, login, recover. Bcrypt pour les hashes
- `session.ts` - Tokens signés avec cookie-signature, expiration 7 jours
- `passphrase.ts` - Générateur `plat-origine-qualificatif` depuis les JSON dans `dictionaries/`
- `tmdb.ts` - Client TMDB, fetch metadata + jaquette FR en priorité
- `radarr.ts` - Client Radarr v3 API, ajout de films + déclenchement recherche
- `films.ts` - CRUD films, genres, slugify, intégration TMDB+Radarr
- `rentals.ts` - Location 24h, vérification crédits, création symlinks, cleanup expirations
- `symlinks.ts` - Création/suppression de dossiers UUID avec symlinks vers les fichiers
- `reviews.ts` - Critiques avec 3 axes de notation, validation 500 chars, +1 crédit

### Routes (`app/src/routes/`)

- `/` - Accueil (genres + derniers films)
- `/login`, `/register`, `/recover` - Auth
- `/rayons` - Liste des genres
- `/rayons/[slug]` - Films d'un genre avec statut location
- `/film/[id]` - Fiche film (id = tmdb_id)
- `/film/[id]/watch` - Player vidéo (auth + location active requise)
- `/film/[id]/review` - Formulaire critique (auth + a loué le film + pas déjà critiqué)
- `/compte` - Profil (crédits, locations actives, historique)
- `/admin/films` - Gestion catalogue (admin only)

### API

- `POST /api/auth/register` - `{ username, password }` → `{ user, recoveryPhrase }`
- `POST /api/auth/login` - `{ username, password }` → `{ user }`
- `POST /api/auth/logout` - Supprime le cookie
- `POST /api/auth/recover` - `{ username, recoveryPhrase, newPassword }` → `{ user, newRecoveryPhrase }`
- `POST /api/rentals/[filmId]` - Louer un film (auth requise)
- `POST /api/reviews/[filmId]` - Publier critique (auth requise)
- `POST /api/admin/films` - `{ tmdb_id }` → Ajouter film depuis TMDB (admin)
- `PATCH /api/admin/films/[filmId]/availability` - `{ available }` (admin)

## Conventions

- **Langue** : Tous les messages d'erreur et l'UI sont en français
- **Svelte 5** : Utiliser `$props()`, `$state()`, `{@render children()}`, `onclick={handler}` (pas `export let`, `on:click`)
- **SQLite** : `better-sqlite3` (synchrone), les appels sont directs (pas d'ORM)
- **JSON dans SQLite** : `genres`, `directors`, `actors` sont des colonnes TEXT stockant du JSON, parsées dans `parseFilm()`
- **Auth** : Cookies httpOnly signés, pas de JWT. Le hook `hooks.server.ts` peuple `locals.user`
- **IDs films** : En interne c'est `film.id` (autoincrement), dans les URLs c'est `film.tmdb_id`
- **Streaming** : Les URLs vidéo pointent vers `${STORAGE_SUBDOMAIN}.${DOMAIN}/{uuid}/film_vf.mp4`
- **Symlinks** : Créés à la location dans `/media/public/symlinks/{uuid}/`, nettoyés par `cleanupExpiredRentals()`

## Points d'attention

- La fonction `cleanupExpiredRentals()` dans `rentals.ts` doit être appelée périodiquement (cron ou setInterval). Ce n'est pas encore câblé automatiquement.
- Le fichier `db.ts` lit `schema.sql` avec `readFileSync` relatif à `__dirname`. En production (build), le fichier SQL doit être copié dans le bundle ou le schema doit être inline.
- Radarr télécharge les films mais ne gère pas automatiquement la distinction VO/VF. Les chemins `file_path_vf` et `file_path_vo` doivent être renseignés manuellement par l'admin pour l'instant.
- Les containers doivent être sur un réseau Docker accessible par le Traefik externe. Si Traefik utilise un réseau dédié, ajouter `networks: external: true` dans le compose.
