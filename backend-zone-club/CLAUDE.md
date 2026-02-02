# CLAUDE.md - Zone Club Backend

## Projet

Zone Club - Backend API pour vidéoclub en ligne avec SvelteKit + SQLite + Docker.

**Note** : Ce backend est utilisé par le frontend 3D React (voir `../CLAUDE.md`).

## Commandes

```bash
# Dev
cd app && npm run dev

# Type check
cd app && npm run check

# Build
cd app && npm run build

# Docker (depuis la racine du projet parent)
docker compose up -d
docker compose build --no-cache sveltekit
```

## Architecture du code

### Backend (`app/src/lib/server/`)

Tout le backend est dans des modules TypeScript serveur-only :

| Fichier | Description |
|---------|-------------|
| `db.ts` | Singleton SQLite, exécute `schema.sql` au démarrage |
| `schema.sql` | DDL complet (users, films, genres, film_genres, rentals, reviews, film_requests) |
| `auth.ts` | Register, login, recover. Bcrypt pour les hashes |
| `session.ts` | Tokens signés avec cookie-signature, expiration 7 jours |
| `passphrase.ts` | Générateur `plat-origine-qualificatif` depuis les JSON dans `dictionaries/` |
| `tmdb.ts` | Client TMDB, fetch metadata + jaquette FR en priorité |
| `radarr.ts` | Client Radarr v3 API, ajout de films + déclenchement recherche |
| `films.ts` | CRUD films, genres, slugify, intégration TMDB+Radarr |
| `rentals.ts` | Location 24h, vérification crédits, création symlinks, cleanup expirations |
| `symlinks.ts` | Création/suppression de dossiers UUID avec symlinks vers les fichiers |
| `reviews.ts` | Critiques avec 3 axes de notation, validation 500 chars, +1 crédit |

### Routes (`app/src/routes/`)

#### Pages (SSR SvelteKit)
- `/` - Accueil (genres + derniers films)
- `/login`, `/register`, `/recover` - Auth
- `/rayons` - Liste des genres
- `/rayons/[slug]` - Films d'un genre avec statut location
- `/film/[id]` - Fiche film (id = tmdb_id)
- `/film/[id]/watch` - Player vidéo (auth + location active requise)
- `/film/[id]/review` - Formulaire critique (auth + a loué le film + pas déjà critiqué)
- `/compte` - Profil (crédits, locations actives, historique)
- `/admin/films` - Gestion catalogue (admin only)

#### API REST (utilisée par le frontend 3D)

**Auth**
- `POST /api/auth/register` - `{ username, password }` → `{ user, recoveryPhrase }`
- `POST /api/auth/login` - `{ username, password }` → `{ user }`
- `POST /api/auth/logout` - Supprime le cookie
- `POST /api/auth/recover` - `{ username, recoveryPhrase, newPassword }` → `{ user, newRecoveryPhrase }`

**Films**
- `GET /api/films` - Liste tous les films disponibles
- `GET /api/films/[tmdbId]` - Détails d'un film + statut location
- `GET /api/films/genre/[slug]` - Films d'un genre

**Genres**
- `GET /api/genres` - Liste des genres avec compteur de films

**Locations**
- `POST /api/rentals/[filmId]` - Louer un film (auth requise, coûte 1 crédit)

**Critiques**
- `GET /api/reviews/[filmId]` - Critiques d'un film + moyennes + droit de critiquer
- `POST /api/reviews/[filmId]` - Publier critique (auth + a loué + pas déjà critiqué)

**Utilisateur**
- `GET /api/me` - Profil complet (user, locations actives, historique, critiques)

**Demandes de films**
- `GET /api/requests` - Liste des demandes de l'utilisateur
- `POST /api/requests` - Demander un film `{ tmdb_id, title, poster_url }`

**Admin**
- `GET /api/admin/stats` - Statistiques (total users, films, rentals, etc.)
- `GET /api/admin/requests` - Toutes les demandes de films
- `PATCH /api/admin/requests/[id]` - Traiter une demande `{ status, admin_note }`
- `POST /api/admin/films` - Ajouter film depuis TMDB `{ tmdb_id }`
- `PATCH /api/admin/films/[filmId]/availability` - `{ available }`

## Conventions

- **Langue** : Tous les messages d'erreur et l'UI sont en français
- **Svelte 5** : Utiliser `$props()`, `$state()`, `{@render children()}`, `onclick={handler}` (pas `export let`, `on:click`)
- **SQLite** : `better-sqlite3` (synchrone), les appels sont directs (pas d'ORM)
- **JSON dans SQLite** : `genres`, `directors`, `actors` sont des colonnes TEXT stockant du JSON, parsées dans `parseFilm()`
- **Auth** : Cookies httpOnly signés, pas de JWT. Le hook `hooks.server.ts` peuple `locals.user`
- **IDs films** : En interne c'est `film.id` (autoincrement), dans les URLs c'est `film.tmdb_id`
- **Streaming** : Les URLs vidéo pointent vers `${STORAGE_SUBDOMAIN}.${DOMAIN}/{uuid}/film_vf.mp4`
- **Symlinks** : Créés à la location dans `/media/public/symlinks/{uuid}/`, nettoyés par `cleanupExpiredRentals()`

## CORS et Frontend 3D

Le frontend 3D React appelle l'API avec `credentials: 'include'` pour les cookies de session.

S'assurer que les headers CORS sont configurés dans `hooks.server.ts` :
```typescript
// Autoriser le frontend 3D
response.headers.set('Access-Control-Allow-Origin', 'https://videoclub.example.com');
response.headers.set('Access-Control-Allow-Credentials', 'true');
```

## Cleanup automatique des locations

Le cleanup des locations expirées est géré via `setInterval` dans `hooks.server.ts` :

```typescript
// hooks.server.ts
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup() {
  const count = await cleanupExpiredRentals();
  if (count > 0) {
    console.log(`[CRON] Cleaned up ${count} expired rental(s)`);
  }
}

// Démarré au premier appel du hook
if (!cleanupInterval) {
  runCleanup();
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}
```

## Points d'attention

- Le fichier `db.ts` lit `schema.sql` avec `readFileSync` relatif à `__dirname`. En production (build), le fichier SQL doit être copié dans le bundle ou le schema doit être inline.
- Radarr télécharge les films mais ne gère pas automatiquement la distinction VO/VF. Les chemins `file_path_vf` et `file_path_vo` doivent être renseignés manuellement par l'admin pour l'instant.
- Les containers doivent être sur un réseau Docker accessible par le Traefik externe. Si Traefik utilise un réseau dédié, ajouter `networks: external: true` dans le compose.

## Intégration avec le Frontend 3D

Le frontend 3D (React Three Fiber) utilise exclusivement l'API REST.

**Fichier client côté frontend** : `../src/api/index.ts`

Exemple d'appel :
```typescript
// Frontend 3D
import { api } from '../api';

// Login
const { user } = await api.auth.login(username, password);

// Louer un film
const { rental } = await api.rentals.rent(filmId);

// Récupérer le profil
const { user, activeRentals, reviews } = await api.me.get();
```

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `DATABASE_PATH` | Chemin vers la DB SQLite (`/data/zone.db`) |
| `DOMAIN` | Domaine principal |
| `SUBDOMAIN` | Sous-domaine de l'API |
| `STORAGE_SUBDOMAIN` | Sous-domaine du streaming vidéo |
| `RADARR_URL` | URL Radarr interne (`http://radarr:7878`) |
| `RADARR_API_KEY` | Clé API Radarr |
| `TMDB_API_KEY` | Clé API TMDB |
| `HMAC_SECRET` | Secret pour signer les sessions |
