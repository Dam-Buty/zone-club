# Zone Club Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a retro video club website with credit-based rentals, French cuisine passphrases, and Radarr integration.

**Architecture:** SvelteKit monolith with SQLite, lighttpd for streaming, Traefik ingress, Radarr for downloads. Symlinks for secure time-limited video access.

**Tech Stack:** SvelteKit 2, SQLite (better-sqlite3), Docker Compose, Traefik v3, lighttpd, Radarr, bcrypt, TMDB API

---

## Phase 1: Project Foundation

### Task 1: Initialize SvelteKit Project

**Files:**
- Create: `app/package.json`
- Create: `app/svelte.config.js`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`

**Step 1: Create SvelteKit project**

Run:
```bash
cd /home/chad/dev/zone-club
npm create svelte@latest app -- --template skeleton --types typescript --no-add-ons
```

**Step 2: Install dependencies**

Run:
```bash
cd /home/chad/dev/zone-club/app
npm install
npm install better-sqlite3 bcrypt uuid
npm install -D @types/better-sqlite3 @types/bcrypt @types/uuid
```

**Step 3: Verify project runs**

Run:
```bash
cd /home/chad/dev/zone-club/app
npm run dev -- --port 5173 &
sleep 3
curl -s http://localhost:5173 | head -20
pkill -f "vite"
```
Expected: HTML response with SvelteKit content

**Step 4: Commit**

```bash
git add app/
git commit -m "feat: initialize SvelteKit project with dependencies"
```

---

### Task 2: Docker Compose Infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `traefik/traefik.yml`
- Create: `traefik/dynamic.yml`
- Create: `lighttpd.conf`
- Create: `.env.example`
- Create: `app/Dockerfile`

**Step 1: Create docker-compose.yml**

```yaml
services:
  traefik:
    image: traefik:v3.0
    container_name: zone-traefik
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik:/etc/traefik
    networks:
      - zone-network

  sveltekit:
    build: ./app
    container_name: zone-app
    environment:
      - DATABASE_PATH=/data/zone.db
      - DOMAIN=${DOMAIN}
      - SUBDOMAIN=${SUBDOMAIN}
      - STORAGE_SUBDOMAIN=${STORAGE_SUBDOMAIN}
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=${RADARR_API_KEY}
      - TMDB_API_KEY=${TMDB_API_KEY}
      - HMAC_SECRET=${HMAC_SECRET}
    volumes:
      - db_data:/data
      - media_films:/media/films:ro
      - media_public:/media/public:rw
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`${SUBDOMAIN}.${DOMAIN}`)"
      - "traefik.http.routers.app.entrypoints=websecure"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=3000"
    networks:
      - zone-network
    depends_on:
      - radarr

  lighttpd:
    image: sebp/lighttpd
    container_name: zone-storage
    volumes:
      - media_films:/media/films:ro
      - media_public:/media/public:ro
      - ./lighttpd.conf:/etc/lighttpd/lighttpd.conf:ro
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.storage.rule=Host(`${STORAGE_SUBDOMAIN}.${DOMAIN}`)"
      - "traefik.http.routers.storage.entrypoints=websecure"
      - "traefik.http.routers.storage.tls.certresolver=letsencrypt"
      - "traefik.http.services.storage.loadbalancer.server.port=80"
    networks:
      - zone-network

  radarr:
    image: linuxserver/radarr:latest
    container_name: zone-radarr
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Paris
    volumes:
      - radarr_config:/config
      - media_films:/movies
      - ${TRANSMISSION_DOWNLOADS}:/downloads
    networks:
      - zone-network
    extra_hosts:
      - "host.docker.internal:host-gateway"

networks:
  zone-network:
    driver: bridge

volumes:
  db_data:
  media_films:
  media_public:
  radarr_config:
```

**Step 2: Create traefik/traefik.yml**

```yaml
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    filename: /etc/traefik/dynamic.yml

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${ACME_EMAIL}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
```

**Step 3: Create traefik/dynamic.yml**

```yaml
# Dynamic configuration (empty for now, can add middlewares later)
```

**Step 4: Create lighttpd.conf**

```lighttpd
server.document-root = "/media/public/symlinks"
server.port = 80

server.modules = (
    "mod_access",
    "mod_accesslog"
)

mimetype.assign = (
    ".mp4" => "video/mp4",
    ".webm" => "video/webm",
    ".vtt" => "text/vtt",
    ".srt" => "application/x-subrip"
)

# Enable symlink following
server.follow-symlink = "enable"

# Enable range requests for video seeking
server.range-requests = "enable"

# CORS headers for cross-origin video requests
server.modules += ("mod_setenv")
setenv.add-response-header = (
    "Access-Control-Allow-Origin" => "*",
    "Access-Control-Allow-Methods" => "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers" => "Range"
)

# Logging
accesslog.filename = "/dev/stdout"

# Index files disabled - direct file access only
index-file.names = ()
dir-listing.activate = "disable"
```

**Step 5: Create .env.example**

```bash
# Domain configuration
DOMAIN=example.com
SUBDOMAIN=zone
STORAGE_SUBDOMAIN=zone-storage
ACME_EMAIL=admin@example.com

# API Keys
RADARR_API_KEY=your_radarr_api_key
TMDB_API_KEY=your_tmdb_api_key

# Security
HMAC_SECRET=generate_a_random_32_char_string

# Paths
TRANSMISSION_DOWNLOADS=/path/to/transmission/downloads
```

**Step 6: Create app/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production

# Create media directories
RUN mkdir -p /data /media/films /media/public/symlinks

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "build"]
```

**Step 7: Update app/svelte.config.js for node adapter**

Run:
```bash
cd /home/chad/dev/zone-club/app
npm install @sveltejs/adapter-node
```

Then update `app/svelte.config.js`:
```javascript
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			out: 'build'
		})
	}
};

export default config;
```

**Step 8: Commit**

```bash
git add docker-compose.yml traefik/ lighttpd.conf .env.example app/Dockerfile app/svelte.config.js app/package*.json
git commit -m "feat: add Docker Compose infrastructure with Traefik, lighttpd, Radarr"
```

---

### Task 3: Database Schema and Initialization

**Files:**
- Create: `app/src/lib/server/db.ts`
- Create: `app/src/lib/server/schema.sql`

**Step 1: Create schema.sql**

Create `app/src/lib/server/schema.sql`:
```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    recovery_phrase_hash TEXT NOT NULL,
    credits INTEGER DEFAULT 5,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Films table
CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id INTEGER UNIQUE NOT NULL,
    title TEXT NOT NULL,
    title_original TEXT,
    synopsis TEXT,
    release_year INTEGER,
    poster_url TEXT,
    backdrop_url TEXT,
    genres TEXT,
    directors TEXT,
    actors TEXT,
    runtime INTEGER,
    file_path_vf TEXT,
    file_path_vo TEXT,
    subtitle_path TEXT,
    radarr_id INTEGER,
    is_available BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Genres table (rayons)
CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    tmdb_id INTEGER UNIQUE
);

-- Film-Genre relationship
CREATE TABLE IF NOT EXISTS film_genres (
    film_id INTEGER NOT NULL,
    genre_id INTEGER NOT NULL,
    PRIMARY KEY (film_id, genre_id),
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

-- Rentals table
CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    symlink_uuid TEXT NOT NULL,
    rented_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    rating_direction INTEGER NOT NULL CHECK(rating_direction BETWEEN 1 AND 5),
    rating_screenplay INTEGER NOT NULL CHECK(rating_screenplay BETWEEN 1 AND 5),
    rating_acting INTEGER NOT NULL CHECK(rating_acting BETWEEN 1 AND 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    UNIQUE(user_id, film_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_film ON rentals(film_id);
CREATE INDEX IF NOT EXISTS idx_rentals_active ON rentals(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_reviews_film ON reviews(film_id);
CREATE INDEX IF NOT EXISTS idx_films_available ON films(is_available);
CREATE INDEX IF NOT EXISTS idx_films_tmdb ON films(tmdb_id);
```

**Step 2: Create db.ts**

Create `app/src/lib/server/db.ts`:
```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DATABASE_PATH || './zone.db';

export const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
const schemaPath = join(__dirname, 'schema.sql');
const schema = readFileSync(schemaPath, 'utf-8');
db.exec(schema);

export default db;
```

**Step 3: Commit**

```bash
git add app/src/lib/server/
git commit -m "feat: add SQLite database schema and initialization"
```

---

### Task 4: French Cuisine Passphrase Generator

**Files:**
- Create: `app/src/lib/server/passphrase.ts`
- Create: `app/src/lib/server/dictionaries/plats.json`
- Create: `app/src/lib/server/dictionaries/origines.json`
- Create: `app/src/lib/server/dictionaries/qualificatifs.json`

**Step 1: Create plats.json**

Create `app/src/lib/server/dictionaries/plats.json`:
```json
[
  "ratatouille", "cassoulet", "tartiflette", "bouillabaisse", "gratin",
  "quiche", "souffle", "blanquette", "bourguignon", "potaufeu",
  "brandade", "choucroute", "aligot", "piperade", "garbure",
  "tian", "croustade", "tourte", "pissaladiere", "flammekueche",
  "raclette", "fondue", "galette", "crepe", "kouignamann",
  "canele", "clafoutis", "far", "gateau", "tarte",
  "baeckeoffe", "carbonnade", "cotriade", "daube", "estouffade",
  "fricassee", "gibelotte", "hochepot", "matelote", "navarin",
  "ossobuco", "paella", "parmentier", "pastilla", "paupiette",
  "poule", "poulet", "rillettes", "roti", "salmis",
  "tajine", "terrine", "tourtiere", "truffade", "veau",
  "boeuf", "agneau", "canard", "lapin", "porc",
  "saucisse", "andouillette", "boudin", "jambon", "pate",
  "foiegras", "confit", "magret", "gésier", "ris",
  "cervelle", "langue", "joue", "queue", "pied",
  "moules", "huitres", "coquilles", "crevettes", "homard",
  "langouste", "crabe", "bulots", "palourdes", "morue",
  "saumon", "truite", "sole", "turbot", "lotte",
  "cabillaud", "merlu", "rouget", "sardine", "maquereau",
  "anchois", "thon", "daurade", "bar", "brochet",
  "carpe", "anguille", "ecrevisse", "grenouille", "escargot",
  "omelette", "oeuf", "cocotte", "brouille", "poché",
  "frittata", "tortilla", "soupe", "potage", "veloute",
  "consomme", "bisque", "creme", "mousse", "bavarois",
  "charlotte", "mille", "feuille", "eclair", "religieuse",
  "chou", "profiterole", "macaron", "madeleine", "financier",
  "brioche", "croissant", "painperdu", "beignet", "gaufre",
  "flan", "creme", "ile", "flottante", "riz",
  "semoule", "tapioca", "compote", "confiture", "gelee",
  "sorbet", "glace", "parfait", "bombe", "souffle",
  "sabayon", "zabaglione", "tiramisu", "panna", "cotta",
  "fondant", "moelleux", "coulant", "brownie", "cookie",
  "crumble", "cobbler", "trifle", "pavlova", "meringue",
  "nougat", "praline", "truffe", "ganache", "caramel",
  "nougatine", "croquant", "tuile", "palmier", "sable",
  "palet", "galette", "biscuit", "speculoos", "pain",
  "focaccia", "fougasse", "ficelle", "baguette", "boule",
  "miche", "couronne", "epi", "fendu", "batard",
  "taboulé", "couscous", "risotto", "polenta", "gnocchi",
  "ravioli", "tortellini", "lasagne", "cannelloni", "tagliatelle",
  "spaghetti", "penne", "fusilli", "farfalle", "rigatoni"
]
```

**Step 2: Create origines.json**

Create `app/src/lib/server/dictionaries/origines.json`:
```json
[
  "lyonnaise", "provencale", "bretonne", "alsacienne", "normande",
  "basque", "perigourdine", "auvergnate", "catalane", "landaise",
  "savoyarde", "nicoise", "bordelaise", "flamande", "picarde",
  "tourangelle", "vendeenne", "charentaise", "limousine", "gasconne",
  "bourguignonne", "champenoise", "lorraine", "vosgienne", "jurassienne",
  "dauphinoise", "ardechoise", "cevenole", "languedocienne", "roussillonnaise",
  "corse", "reunionnaise", "antillaise", "guyanaise", "polynesienne",
  "parisienne", "francilienne", "beauceronne", "solognote", "berrichonne",
  "bourbonnaise", "nivernaise", "morvandelle", "bressane", "dombiste",
  "bugiste", "beaujolaise", "mâconnaise", "chalonnaise", "beaunoise",
  "dijonnaise", "auxerroise", "senonaise", "tonnerroise", "avallonnaise",
  "vezelienne", "clunisoise", "tourquennoise", "lilloise", "douaisienne",
  "valenciennoise", "cambrésienne", "arrageoise", "bethunoise", "boulonnaise",
  "calaisienne", "dunkerquoise", "hazebrouckoise", "armentieroise", "roubaisienne",
  "amiénoise", "abbévilloise", "peronnaise", "montdidierienne", "compiégnoise",
  "laonnoise", "soissonnaise", "chaunoise", "vervinnoise", "guisarde",
  "thiérachienne", "rethéloise", "sedanaise", "charlottine", "chalonnaise",
  "vitryate", "epernaysienne", "reimoise", "troyenne", "barsurauboise",
  "chaumontaise", "langroise", "nancéienne", "messine", "thionvilloise",
  "saarregueminoise", "sarrebourgoise", "lunevilloise", "epinalienne", "remirepontaine",
  "geromoise", "plombiéroise", "bussangaise", "ventronaise", "strasbourgeoise",
  "colmarienne", "mulhousienne", "altkirchoise", "guebwilleroise", "thannoise",
  "bischwilleroise", "haguenovienne", "wissembourgoise", "savernoise", "selestatienne",
  "obernoise", "molsheimoise", "schirmeckoise", "villoise", "barraine",
  "pontoise", "versaillaise", "rambolitaine", "etampoise", "corbelloise",
  "evryenne", "melfontaine", "fontainebloise", "nemourienne", "monterelaise",
  "meluniaise", "melunoise", "lagnyssienne", "champignolaise", "noisyenne",
  "audonienne", "dionysienne", "rosnéenne", "aulnaysienne", "sevranaise",
  "livrienne", "pavillonaise", "gagnyenne", "bondinoise", "clichoise",
  "levalloisienne", "neuilloise", "puteolienne", "suresnesienne", "nantérienne",
  "colombienne", "asniéroise", "gennevilloise", "clichyssoise", "villeneuvoise",
  "montreuilloise", "bagnoletaise", "romainvilloise", "pantinoise", "bobignyssienne",
  "drancyenne", "blancmesniloise", "bourgetine", "dugnyenne", "stainoise",
  "pierrfitaise", "villetaneusienne", "epinaysienne", "argenteuillaise", "bezonnaise",
  "sartrouvilloise", "houillaise", "carrieroise", "chatouvienne", "vesnetaise"
]
```

**Step 3: Create qualificatifs.json**

Create `app/src/lib/server/dictionaries/qualificatifs.json`:
```json
[
  "doree", "gratinee", "fumee", "braisee", "mijotee",
  "rissolee", "caramelisee", "flambee", "poelee", "rotie",
  "confite", "farcie", "truffee", "persillee", "citronnee",
  "safranee", "rustique", "fondante", "croustillante", "veloutee",
  "moelleuse", "cremeuse", "onctueuse", "legere", "aerienne",
  "delicate", "savoureuse", "gourmande", "genereuse", "copieuse",
  "parfumee", "aromatique", "epicee", "relevee", "pimentee",
  "poivree", "aillée", "herbeuse", "anisee", "mentholée",
  "vanillee", "chocolatee", "fruitee", "agrumee", "acidulee",
  "sucree", "salee", "amere", "umami", "iodee",
  "beurrée", "huilee", "vinaigrée", "moutardée", "mayonnaisée",
  "fromagere", "lactée", "tomatée", "olivée", "capree",
  "anchoiade", "tapenadée", "pistouée", "aiollée", "rouillée",
  "bourride", "brandadée", "raviolée", "risottée", "gnocchée",
  "polentée", "couscousée", "quinoée", "boulgouree", "epeautree",
  "orgeée", "avoinée", "sarrasinée", "seiglée", "fromentée",
  "champetree", "forestière", "printaniere", "estivale", "automnale",
  "hivernale", "paysanne", "fermiere", "maraichere", "potagere",
  "jardiniere", "bouchere", "charcutiere", "tripiere", "fromagère",
  "boulangere", "patissiere", "confisiere", "chocolatiere", "glaciere",
  "mariniere", "pecheur", "chasseur", "braconniere", "vigneronne",
  "vignoble", "bordelaise", "bourguignonne", "champenoise", "alsacienne",
  "cognacaise", "armagnacaise", "calvadosienne", "cidree", "poiree",
  "hydromelee", "biéree", "vineuse", "spiritueuse", "liquoreuse",
  "traditionnelle", "classique", "moderne", "revisitee", "fusion",
  "creative", "inventive", "audacieuse", "osée", "surprenante",
  "authentique", "veritable", "originale", "unique", "exceptionnelle",
  "remarquable", "memorable", "inoubliable", "sublime", "divine",
  "celeste", "paradisiaque", "royale", "imperiale", "princiere",
  "ducale", "comtale", "baroniale", "seigneuriale", "bourgeoise",
  "populaire", "ouvriere", "paysanne", "campagnarde", "montagnarde",
  "littorale", "maritime", "fluviale", "lacustre", "insulaire",
  "nordique", "meridionale", "orientale", "occidentale", "centrale",
  "exotique", "tropicale", "mediterraneenne", "atlantique", "continentale",
  "grillée", "sautée", "vapeur", "etuvee", "pochee",
  "blanchie", "revenus", "saisie", "marquee", "laquee",
  "glacée", "napée", "saucée", "jussée", "reduite"
]
```

**Step 4: Create passphrase.ts**

Create `app/src/lib/server/passphrase.ts`:
```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomInt } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDictionary(name: string): string[] {
    const path = join(__dirname, 'dictionaries', `${name}.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
}

const plats = loadDictionary('plats');
const origines = loadDictionary('origines');
const qualificatifs = loadDictionary('qualificatifs');

function secureRandomChoice<T>(array: T[]): T {
    return array[randomInt(0, array.length)];
}

export function generatePassphrase(): string {
    const plat = secureRandomChoice(plats);
    const origine = secureRandomChoice(origines);
    const qualificatif = secureRandomChoice(qualificatifs);

    return `${plat}-${origine}-${qualificatif}`;
}

export function getPassphraseCombinations(): number {
    return plats.length * origines.length * qualificatifs.length;
}
```

**Step 5: Commit**

```bash
git add app/src/lib/server/passphrase.ts app/src/lib/server/dictionaries/
git commit -m "feat: add French cuisine passphrase generator with dictionaries"
```

---

## Phase 2: Authentication System

### Task 5: Auth Utilities

**Files:**
- Create: `app/src/lib/server/auth.ts`

**Step 1: Create auth.ts**

Create `app/src/lib/server/auth.ts`:
```typescript
import bcrypt from 'bcrypt';
import { db } from './db';
import { generatePassphrase } from './passphrase';

const SALT_ROUNDS = 12;

export interface User {
    id: number;
    username: string;
    credits: number;
    is_admin: boolean;
    created_at: string;
}

export interface RegisterResult {
    user: User;
    recoveryPhrase: string;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export async function registerUser(username: string, password: string): Promise<RegisterResult> {
    const passwordHash = await hashPassword(password);
    const recoveryPhrase = generatePassphrase();
    const recoveryPhraseHash = await hashPassword(recoveryPhrase);

    const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, recovery_phrase_hash)
        VALUES (?, ?, ?)
    `);

    const result = stmt.run(username, passwordHash, recoveryPhraseHash);

    const user = db.prepare('SELECT id, username, credits, is_admin, created_at FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as User;

    return { user, recoveryPhrase };
}

export async function loginUser(username: string, password: string): Promise<User | null> {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!row) return null;

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) return null;

    return {
        id: row.id,
        username: row.username,
        credits: row.credits,
        is_admin: row.is_admin,
        created_at: row.created_at
    };
}

export async function recoverAccount(username: string, recoveryPhrase: string, newPassword: string): Promise<{ user: User; newRecoveryPhrase: string } | null> {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!row) return null;

    const valid = await verifyPassword(recoveryPhrase, row.recovery_phrase_hash);
    if (!valid) return null;

    const newPasswordHash = await hashPassword(newPassword);
    const newRecoveryPhrase = generatePassphrase();
    const newRecoveryPhraseHash = await hashPassword(newRecoveryPhrase);

    db.prepare(`
        UPDATE users
        SET password_hash = ?, recovery_phrase_hash = ?
        WHERE id = ?
    `).run(newPasswordHash, newRecoveryPhraseHash, row.id);

    return {
        user: {
            id: row.id,
            username: row.username,
            credits: row.credits,
            is_admin: row.is_admin,
            created_at: row.created_at
        },
        newRecoveryPhrase
    };
}

export function getUserById(id: number): User | null {
    const row = db.prepare('SELECT id, username, credits, is_admin, created_at FROM users WHERE id = ?')
        .get(id) as User | undefined;
    return row || null;
}

export function usernameExists(username: string): boolean {
    const row = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    return !!row;
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/auth.ts
git commit -m "feat: add authentication utilities with bcrypt and passphrase recovery"
```

---

### Task 6: Session Management with Cookies

**Files:**
- Create: `app/src/lib/server/session.ts`
- Create: `app/src/hooks.server.ts`

**Step 1: Install cookie signing dependency**

Run:
```bash
cd /home/chad/dev/zone-club/app
npm install cookie-signature
npm install -D @types/cookie-signature
```

**Step 2: Create session.ts**

Create `app/src/lib/server/session.ts`:
```typescript
import { sign, unsign } from 'cookie-signature';
import { getUserById, type User } from './auth';

const SECRET = process.env.HMAC_SECRET || 'dev-secret-change-in-production';

export interface Session {
    userId: number;
}

export function createSessionToken(userId: number): string {
    const payload = JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }); // 7 days
    return sign(Buffer.from(payload).toString('base64'), SECRET);
}

export function verifySessionToken(token: string): Session | null {
    const unsigned = unsign(token, SECRET);
    if (!unsigned) return null;

    try {
        const payload = JSON.parse(Buffer.from(unsigned, 'base64').toString());
        if (payload.exp < Date.now()) return null;
        return { userId: payload.userId };
    } catch {
        return null;
    }
}

export function getUserFromSession(token: string | undefined): User | null {
    if (!token) return null;

    const session = verifySessionToken(token);
    if (!session) return null;

    return getUserById(session.userId);
}
```

**Step 3: Create hooks.server.ts**

Create `app/src/hooks.server.ts`:
```typescript
import type { Handle } from '@sveltejs/kit';
import { getUserFromSession } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
    const sessionToken = event.cookies.get('session');
    event.locals.user = getUserFromSession(sessionToken);

    return resolve(event);
};
```

**Step 4: Create app.d.ts for types**

Create `app/src/app.d.ts`:
```typescript
import type { User } from '$lib/server/auth';

declare global {
    namespace App {
        interface Locals {
            user: User | null;
        }
    }
}

export {};
```

**Step 5: Commit**

```bash
git add app/src/lib/server/session.ts app/src/hooks.server.ts app/src/app.d.ts app/package*.json
git commit -m "feat: add session management with signed cookies"
```

---

### Task 7: Auth API Routes

**Files:**
- Create: `app/src/routes/api/auth/register/+server.ts`
- Create: `app/src/routes/api/auth/login/+server.ts`
- Create: `app/src/routes/api/auth/logout/+server.ts`
- Create: `app/src/routes/api/auth/recover/+server.ts`

**Step 1: Create register endpoint**

Create `app/src/routes/api/auth/register/+server.ts`:
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registerUser, usernameExists } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30) {
        return json({ error: 'Le pseudo doit faire entre 3 et 30 caractères' }, { status: 400 });
    }

    if (password.length < 8) {
        return json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
    }

    if (usernameExists(username)) {
        return json({ error: 'Ce pseudo est déjà pris' }, { status: 409 });
    }

    try {
        const { user, recoveryPhrase } = await registerUser(username, password);

        const token = createSessionToken(user.id);
        cookies.set('session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        return json({ user, recoveryPhrase });
    } catch (error) {
        console.error('Registration error:', error);
        return json({ error: 'Erreur lors de l\'inscription' }, { status: 500 });
    }
};
```

**Step 2: Create login endpoint**

Create `app/src/routes/api/auth/login/+server.ts`:
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loginUser } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    const user = await loginUser(username, password);

    if (!user) {
        return json({ error: 'Pseudo ou mot de passe incorrect' }, { status: 401 });
    }

    const token = createSessionToken(user.id);
    cookies.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return json({ user });
};
```

**Step 3: Create logout endpoint**

Create `app/src/routes/api/auth/logout/+server.ts`:
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
    cookies.delete('session', { path: '/' });
    return json({ success: true });
};
```

**Step 4: Create recover endpoint**

Create `app/src/routes/api/auth/recover/+server.ts`:
```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recoverAccount } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, recoveryPhrase, newPassword } = await request.json();

    if (!username || !recoveryPhrase || !newPassword) {
        return json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    if (newPassword.length < 8) {
        return json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
    }

    const result = await recoverAccount(username, recoveryPhrase, newPassword);

    if (!result) {
        return json({ error: 'Pseudo ou passphrase incorrect' }, { status: 401 });
    }

    const token = createSessionToken(result.user.id);
    cookies.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return json({ user: result.user, newRecoveryPhrase: result.newRecoveryPhrase });
};
```

**Step 5: Commit**

```bash
git add app/src/routes/api/auth/
git commit -m "feat: add authentication API endpoints (register, login, logout, recover)"
```

---

## Phase 3: TMDB Integration and Film Management

### Task 8: TMDB API Client

**Files:**
- Create: `app/src/lib/server/tmdb.ts`

**Step 1: Create tmdb.ts**

Create `app/src/lib/server/tmdb.ts`:
```typescript
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface TmdbMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    release_date: string;
    poster_path: string | null;
    backdrop_path: string | null;
    runtime: number;
    genres: { id: number; name: string }[];
}

export interface TmdbCredits {
    cast: {
        id: number;
        name: string;
        character: string;
        profile_path: string | null;
        order: number;
    }[];
    crew: {
        id: number;
        name: string;
        job: string;
        department: string;
    }[];
}

export interface TmdbImages {
    posters: {
        file_path: string;
        iso_639_1: string | null;
    }[];
}

async function tmdbFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY || '');
    url.searchParams.set('language', 'fr-FR');

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status}`);
    }

    return response.json();
}

export async function getMovie(tmdbId: number): Promise<TmdbMovie> {
    return tmdbFetch<TmdbMovie>(`/movie/${tmdbId}`);
}

export async function getMovieCredits(tmdbId: number): Promise<TmdbCredits> {
    return tmdbFetch<TmdbCredits>(`/movie/${tmdbId}/credits`);
}

export async function getMovieImages(tmdbId: number): Promise<TmdbImages> {
    return tmdbFetch<TmdbImages>(`/movie/${tmdbId}/images`, {
        include_image_language: 'fr,null'
    });
}

export function getPosterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'original' = 'w500'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getBackdropUrl(path: string | null, size: 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export async function fetchFullMovieData(tmdbId: number) {
    const [movie, credits, images] = await Promise.all([
        getMovie(tmdbId),
        getMovieCredits(tmdbId),
        getMovieImages(tmdbId)
    ]);

    // Try to find French poster first
    const frenchPoster = images.posters.find(p => p.iso_639_1 === 'fr');
    const posterPath = frenchPoster?.file_path || movie.poster_path;

    // Get top 10 actors
    const actors = credits.cast
        .sort((a, b) => a.order - b.order)
        .slice(0, 10)
        .map(a => ({
            tmdb_id: a.id,
            name: a.name,
            character: a.character
        }));

    // Get directors
    const directors = credits.crew
        .filter(c => c.job === 'Director')
        .map(d => ({
            tmdb_id: d.id,
            name: d.name
        }));

    return {
        tmdb_id: movie.id,
        title: movie.title,
        title_original: movie.original_title,
        synopsis: movie.overview,
        release_year: movie.release_date ? parseInt(movie.release_date.split('-')[0]) : null,
        poster_url: getPosterUrl(posterPath),
        backdrop_url: getBackdropUrl(movie.backdrop_path),
        runtime: movie.runtime,
        genres: movie.genres,
        actors,
        directors
    };
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/tmdb.ts
git commit -m "feat: add TMDB API client with French poster prioritization"
```

---

### Task 9: Radarr API Client

**Files:**
- Create: `app/src/lib/server/radarr.ts`

**Step 1: Create radarr.ts**

Create `app/src/lib/server/radarr.ts`:
```typescript
const RADARR_URL = process.env.RADARR_URL || 'http://radarr:7878';
const RADARR_API_KEY = process.env.RADARR_API_KEY;

interface RadarrMovie {
    id: number;
    title: string;
    tmdbId: number;
    path: string;
    hasFile: boolean;
    movieFile?: {
        path: string;
        relativePath: string;
    };
}

interface RadarrRootFolder {
    id: number;
    path: string;
}

interface RadarrQualityProfile {
    id: number;
    name: string;
}

async function radarrFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${RADARR_URL}/api/v3${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'X-Api-Key': RADARR_API_KEY || '',
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Radarr API error: ${response.status} - ${text}`);
    }

    return response.json();
}

export async function getRootFolders(): Promise<RadarrRootFolder[]> {
    return radarrFetch<RadarrRootFolder[]>('/rootfolder');
}

export async function getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    return radarrFetch<RadarrQualityProfile[]>('/qualityprofile');
}

export async function getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
    const movies = await radarrFetch<RadarrMovie[]>(`/movie?tmdbId=${tmdbId}`);
    return movies[0] || null;
}

export async function addMovie(tmdbId: number, title: string): Promise<RadarrMovie> {
    const [rootFolders, qualityProfiles] = await Promise.all([
        getRootFolders(),
        getQualityProfiles()
    ]);

    const rootFolder = rootFolders[0];
    const qualityProfile = qualityProfiles[0];

    if (!rootFolder || !qualityProfile) {
        throw new Error('Radarr not configured: missing root folder or quality profile');
    }

    // Lookup movie in TMDB via Radarr
    const lookupResults = await radarrFetch<any[]>(`/movie/lookup?term=tmdb:${tmdbId}`);

    if (lookupResults.length === 0) {
        throw new Error(`Movie not found in TMDB: ${tmdbId}`);
    }

    const movieData = lookupResults[0];

    const payload = {
        ...movieData,
        rootFolderPath: rootFolder.path,
        qualityProfileId: qualityProfile.id,
        monitored: true,
        addOptions: {
            searchForMovie: true
        }
    };

    return radarrFetch<RadarrMovie>('/movie', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function getMovieStatus(radarrId: number): Promise<RadarrMovie> {
    return radarrFetch<RadarrMovie>(`/movie/${radarrId}`);
}

export async function searchMovie(radarrId: number): Promise<void> {
    await radarrFetch('/command', {
        method: 'POST',
        body: JSON.stringify({
            name: 'MoviesSearch',
            movieIds: [radarrId]
        })
    });
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/radarr.ts
git commit -m "feat: add Radarr API client for movie management"
```

---

### Task 10: Film Database Operations

**Files:**
- Create: `app/src/lib/server/films.ts`

**Step 1: Create films.ts**

Create `app/src/lib/server/films.ts`:
```typescript
import { db } from './db';
import { fetchFullMovieData } from './tmdb';
import { addMovie as addToRadarr, getMovieByTmdbId } from './radarr';

export interface Film {
    id: number;
    tmdb_id: number;
    title: string;
    title_original: string | null;
    synopsis: string | null;
    release_year: number | null;
    poster_url: string | null;
    backdrop_url: string | null;
    genres: { id: number; name: string }[];
    directors: { tmdb_id: number; name: string }[];
    actors: { tmdb_id: number; name: string; character: string }[];
    runtime: number | null;
    file_path_vf: string | null;
    file_path_vo: string | null;
    subtitle_path: string | null;
    radarr_id: number | null;
    is_available: boolean;
    created_at: string;
}

export interface Genre {
    id: number;
    name: string;
    slug: string;
    tmdb_id: number | null;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function parseFilm(row: any): Film {
    return {
        ...row,
        genres: JSON.parse(row.genres || '[]'),
        directors: JSON.parse(row.directors || '[]'),
        actors: JSON.parse(row.actors || '[]'),
        is_available: !!row.is_available
    };
}

export async function addFilmFromTmdb(tmdbId: number): Promise<Film> {
    // Check if film already exists
    const existing = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
    if (existing) {
        throw new Error('Ce film est déjà dans le catalogue');
    }

    // Fetch data from TMDB
    const tmdbData = await fetchFullMovieData(tmdbId);

    // Ensure genres exist
    for (const genre of tmdbData.genres) {
        db.prepare(`
            INSERT OR IGNORE INTO genres (name, slug, tmdb_id)
            VALUES (?, ?, ?)
        `).run(genre.name, slugify(genre.name), genre.id);
    }

    // Insert film
    const stmt = db.prepare(`
        INSERT INTO films (
            tmdb_id, title, title_original, synopsis, release_year,
            poster_url, backdrop_url, genres, directors, actors, runtime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        tmdbData.tmdb_id,
        tmdbData.title,
        tmdbData.title_original,
        tmdbData.synopsis,
        tmdbData.release_year,
        tmdbData.poster_url,
        tmdbData.backdrop_url,
        JSON.stringify(tmdbData.genres),
        JSON.stringify(tmdbData.directors),
        JSON.stringify(tmdbData.actors),
        tmdbData.runtime
    );

    const filmId = result.lastInsertRowid as number;

    // Link genres
    for (const genre of tmdbData.genres) {
        const genreRow = db.prepare('SELECT id FROM genres WHERE tmdb_id = ?').get(genre.id) as { id: number };
        db.prepare('INSERT INTO film_genres (film_id, genre_id) VALUES (?, ?)').run(filmId, genreRow.id);
    }

    // Try to add to Radarr
    try {
        const radarrMovie = await addToRadarr(tmdbId, tmdbData.title);
        db.prepare('UPDATE films SET radarr_id = ? WHERE id = ?').run(radarrMovie.id, filmId);
    } catch (error) {
        console.error('Failed to add to Radarr:', error);
        // Continue anyway, can be added later
    }

    return getFilmById(filmId)!;
}

export function getFilmById(id: number): Film | null {
    const row = db.prepare('SELECT * FROM films WHERE id = ?').get(id);
    return row ? parseFilm(row) : null;
}

export function getFilmByTmdbId(tmdbId: number): Film | null {
    const row = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
    return row ? parseFilm(row) : null;
}

export function getAllFilms(availableOnly = true): Film[] {
    const query = availableOnly
        ? 'SELECT * FROM films WHERE is_available = 1 ORDER BY created_at DESC'
        : 'SELECT * FROM films ORDER BY created_at DESC';

    return db.prepare(query).all().map(parseFilm);
}

export function getFilmsByGenre(genreSlug: string): Film[] {
    const rows = db.prepare(`
        SELECT f.* FROM films f
        JOIN film_genres fg ON f.id = fg.film_id
        JOIN genres g ON fg.genre_id = g.id
        WHERE g.slug = ? AND f.is_available = 1
        ORDER BY f.release_year DESC
    `).all(genreSlug);

    return rows.map(parseFilm);
}

export function getAllGenres(): Genre[] {
    return db.prepare('SELECT * FROM genres ORDER BY name').all() as Genre[];
}

export function getGenresWithFilmCount(): (Genre & { film_count: number })[] {
    return db.prepare(`
        SELECT g.*, COUNT(fg.film_id) as film_count
        FROM genres g
        LEFT JOIN film_genres fg ON g.id = fg.genre_id
        LEFT JOIN films f ON fg.film_id = f.id AND f.is_available = 1
        GROUP BY g.id
        HAVING film_count > 0
        ORDER BY g.name
    `).all() as (Genre & { film_count: number })[];
}

export function setFilmAvailability(filmId: number, available: boolean): void {
    db.prepare('UPDATE films SET is_available = ? WHERE id = ?').run(available ? 1 : 0, filmId);
}

export function updateFilmPaths(filmId: number, paths: {
    file_path_vf?: string;
    file_path_vo?: string;
    subtitle_path?: string;
}): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (paths.file_path_vf !== undefined) {
        updates.push('file_path_vf = ?');
        values.push(paths.file_path_vf);
    }
    if (paths.file_path_vo !== undefined) {
        updates.push('file_path_vo = ?');
        values.push(paths.file_path_vo);
    }
    if (paths.subtitle_path !== undefined) {
        updates.push('subtitle_path = ?');
        values.push(paths.subtitle_path);
    }

    if (updates.length > 0) {
        values.push(filmId);
        db.prepare(`UPDATE films SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/films.ts
git commit -m "feat: add film database operations with TMDB and Radarr integration"
```

---

## Phase 4: Rental System

### Task 11: Symlink Manager

**Files:**
- Create: `app/src/lib/server/symlinks.ts`

**Step 1: Create symlinks.ts**

Create `app/src/lib/server/symlinks.ts`:
```typescript
import { mkdir, symlink, rm, access } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const MEDIA_FILMS_PATH = process.env.MEDIA_FILMS_PATH || '/media/films';
const SYMLINKS_PATH = process.env.SYMLINKS_PATH || '/media/public/symlinks';

export interface SymlinkPaths {
    uuid: string;
    vf: string | null;
    vo: string | null;
    subtitles: string | null;
}

export async function createRentalSymlinks(
    tmdbId: number,
    filePaths: {
        vf: string | null;
        vo: string | null;
        subtitles: string | null;
    }
): Promise<SymlinkPaths> {
    const uuid = uuidv4();
    const symlinkDir = join(SYMLINKS_PATH, uuid);

    await mkdir(symlinkDir, { recursive: true });

    const result: SymlinkPaths = {
        uuid,
        vf: null,
        vo: null,
        subtitles: null
    };

    if (filePaths.vf) {
        const source = join(MEDIA_FILMS_PATH, filePaths.vf);
        const target = join(symlinkDir, 'film_vf.mp4');
        await symlink(source, target);
        result.vf = `${uuid}/film_vf.mp4`;
    }

    if (filePaths.vo) {
        const source = join(MEDIA_FILMS_PATH, filePaths.vo);
        const target = join(symlinkDir, 'film_vo.mp4');
        await symlink(source, target);
        result.vo = `${uuid}/film_vo.mp4`;
    }

    if (filePaths.subtitles) {
        const source = join(MEDIA_FILMS_PATH, filePaths.subtitles);
        const target = join(symlinkDir, 'subs_fr.vtt');
        await symlink(source, target);
        result.subtitles = `${uuid}/subs_fr.vtt`;
    }

    return result;
}

export async function deleteRentalSymlinks(uuid: string): Promise<void> {
    const symlinkDir = join(SYMLINKS_PATH, uuid);

    try {
        await access(symlinkDir);
        await rm(symlinkDir, { recursive: true });
    } catch {
        // Directory doesn't exist, ignore
    }
}

export function getStreamingUrl(uuid: string, filename: string): string {
    const domain = process.env.DOMAIN || 'localhost';
    const storageSubdomain = process.env.STORAGE_SUBDOMAIN || 'zone-storage';

    return `https://${storageSubdomain}.${domain}/${uuid}/${filename}`;
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/symlinks.ts
git commit -m "feat: add symlink manager for secure video streaming"
```

---

### Task 12: Rental Operations

**Files:**
- Create: `app/src/lib/server/rentals.ts`

**Step 1: Create rentals.ts**

Create `app/src/lib/server/rentals.ts`:
```typescript
import { db } from './db';
import { createRentalSymlinks, deleteRentalSymlinks, getStreamingUrl } from './symlinks';
import { getFilmById, type Film } from './films';

const RENTAL_DURATION_HOURS = 24;

export interface Rental {
    id: number;
    user_id: number;
    film_id: number;
    symlink_uuid: string;
    rented_at: string;
    expires_at: string;
    is_active: boolean;
}

export interface RentalWithFilm extends Rental {
    film: Film;
    streaming_urls: {
        vf: string | null;
        vo: string | null;
        subtitles: string | null;
    };
    time_remaining: number; // minutes
}

export interface RentalStatus {
    is_rented: boolean;
    rented_by_current_user: boolean;
    rental?: RentalWithFilm;
}

export function getActiveRentalForFilm(filmId: number): Rental | null {
    return db.prepare(`
        SELECT * FROM rentals
        WHERE film_id = ? AND is_active = 1 AND expires_at > datetime('now')
    `).get(filmId) as Rental | null;
}

export function getUserActiveRentals(userId: number): RentalWithFilm[] {
    const rentals = db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now')
        ORDER BY rented_at DESC
    `).all(userId) as Rental[];

    return rentals.map(rental => enrichRental(rental)).filter((r): r is RentalWithFilm => r !== null);
}

export function getUserRentalHistory(userId: number): Rental[] {
    return db.prepare(`
        SELECT * FROM rentals
        WHERE user_id = ?
        ORDER BY rented_at DESC
    `).all(userId) as Rental[];
}

export function hasUserRentedFilm(userId: number, filmId: number): boolean {
    const rental = db.prepare(`
        SELECT 1 FROM rentals WHERE user_id = ? AND film_id = ?
    `).get(userId, filmId);
    return !!rental;
}

export function getFilmRentalStatus(filmId: number, userId: number | null): RentalStatus {
    const activeRental = getActiveRentalForFilm(filmId);

    if (!activeRental) {
        return { is_rented: false, rented_by_current_user: false };
    }

    const isCurrentUser = userId !== null && activeRental.user_id === userId;

    return {
        is_rented: true,
        rented_by_current_user: isCurrentUser,
        rental: isCurrentUser ? enrichRental(activeRental) || undefined : undefined
    };
}

function enrichRental(rental: Rental): RentalWithFilm | null {
    const film = getFilmById(rental.film_id);
    if (!film) return null;

    const expiresAt = new Date(rental.expires_at + 'Z');
    const now = new Date();
    const timeRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60000));

    return {
        ...rental,
        film,
        streaming_urls: {
            vf: film.file_path_vf ? getStreamingUrl(rental.symlink_uuid, 'film_vf.mp4') : null,
            vo: film.file_path_vo ? getStreamingUrl(rental.symlink_uuid, 'film_vo.mp4') : null,
            subtitles: film.subtitle_path ? getStreamingUrl(rental.symlink_uuid, 'subs_fr.vtt') : null
        },
        time_remaining: timeRemaining
    };
}

export async function rentFilm(userId: number, filmId: number): Promise<RentalWithFilm> {
    const film = getFilmById(filmId);
    if (!film) {
        throw new Error('Film non trouvé');
    }

    if (!film.is_available) {
        throw new Error('Ce film n\'est pas disponible');
    }

    // Check if already rented by someone else
    const existingRental = getActiveRentalForFilm(filmId);
    if (existingRental && existingRental.user_id !== userId) {
        throw new Error('Ce film est déjà loué par un autre membre');
    }

    // Check if user already has an active rental for this film
    if (existingRental && existingRental.user_id === userId) {
        return enrichRental(existingRental)!;
    }

    // Check user credits
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (user.credits < 1) {
        throw new Error('Crédits insuffisants');
    }

    // Create symlinks
    const symlinks = await createRentalSymlinks(film.tmdb_id, {
        vf: film.file_path_vf,
        vo: film.file_path_vo,
        subtitles: film.subtitle_path
    });

    // Create rental and deduct credit in transaction
    const expiresAt = new Date(Date.now() + RENTAL_DURATION_HOURS * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');

    db.transaction(() => {
        db.prepare(`
            INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, filmId, symlinks.uuid, expiresAt);

        db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
    })();

    const rental = db.prepare(`
        SELECT * FROM rentals WHERE user_id = ? AND film_id = ? AND is_active = 1
    `).get(userId, filmId) as Rental;

    return enrichRental(rental)!;
}

export async function cleanupExpiredRentals(): Promise<number> {
    const expiredRentals = db.prepare(`
        SELECT * FROM rentals
        WHERE is_active = 1 AND expires_at <= datetime('now')
    `).all() as Rental[];

    for (const rental of expiredRentals) {
        await deleteRentalSymlinks(rental.symlink_uuid);
        db.prepare('UPDATE rentals SET is_active = 0 WHERE id = ?').run(rental.id);
    }

    return expiredRentals.length;
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/rentals.ts
git commit -m "feat: add rental operations with credit management and symlink creation"
```

---

## Phase 5: Review System

### Task 13: Review Operations

**Files:**
- Create: `app/src/lib/server/reviews.ts`

**Step 1: Create reviews.ts**

Create `app/src/lib/server/reviews.ts`:
```typescript
import { db } from './db';
import { hasUserRentedFilm } from './rentals';

const MIN_REVIEW_LENGTH = 500;

export interface Review {
    id: number;
    user_id: number;
    film_id: number;
    content: string;
    rating_direction: number;
    rating_screenplay: number;
    rating_acting: number;
    created_at: string;
}

export interface ReviewWithUser extends Review {
    username: string;
    average_rating: number;
}

export interface FilmRatings {
    direction: number;
    screenplay: number;
    acting: number;
    overall: number;
    count: number;
}

export function getReviewsByFilm(filmId: number): ReviewWithUser[] {
    return db.prepare(`
        SELECT r.*, u.username,
            (r.rating_direction + r.rating_screenplay + r.rating_acting) / 3.0 as average_rating
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.film_id = ?
        ORDER BY r.created_at DESC
    `).all(filmId) as ReviewWithUser[];
}

export function getFilmRatings(filmId: number): FilmRatings | null {
    const result = db.prepare(`
        SELECT
            AVG(rating_direction) as direction,
            AVG(rating_screenplay) as screenplay,
            AVG(rating_acting) as acting,
            AVG((rating_direction + rating_screenplay + rating_acting) / 3.0) as overall,
            COUNT(*) as count
        FROM reviews
        WHERE film_id = ?
    `).get(filmId) as any;

    if (!result || result.count === 0) return null;

    return {
        direction: Math.round(result.direction * 10) / 10,
        screenplay: Math.round(result.screenplay * 10) / 10,
        acting: Math.round(result.acting * 10) / 10,
        overall: Math.round(result.overall * 10) / 10,
        count: result.count
    };
}

export function getUserReview(userId: number, filmId: number): Review | null {
    return db.prepare(`
        SELECT * FROM reviews WHERE user_id = ? AND film_id = ?
    `).get(userId, filmId) as Review | null;
}

export function getUserReviews(userId: number): ReviewWithUser[] {
    return db.prepare(`
        SELECT r.*, u.username,
            (r.rating_direction + r.rating_screenplay + r.rating_acting) / 3.0 as average_rating
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
    `).all(userId) as ReviewWithUser[];
}

export function canUserReview(userId: number, filmId: number): { allowed: boolean; reason?: string } {
    // Check if user has rented this film
    if (!hasUserRentedFilm(userId, filmId)) {
        return { allowed: false, reason: 'Vous devez d\'abord louer ce film pour pouvoir le critiquer' };
    }

    // Check if user already reviewed this film
    const existingReview = getUserReview(userId, filmId);
    if (existingReview) {
        return { allowed: false, reason: 'Vous avez déjà critiqué ce film' };
    }

    return { allowed: true };
}

export function createReview(
    userId: number,
    filmId: number,
    content: string,
    ratings: {
        direction: number;
        screenplay: number;
        acting: number;
    }
): Review {
    // Validate content length
    if (content.length < MIN_REVIEW_LENGTH) {
        throw new Error(`La critique doit faire au moins ${MIN_REVIEW_LENGTH} caractères`);
    }

    // Validate ratings
    for (const [key, value] of Object.entries(ratings)) {
        if (value < 1 || value > 5 || !Number.isInteger(value)) {
            throw new Error(`La note de ${key} doit être entre 1 et 5`);
        }
    }

    // Check if user can review
    const canReview = canUserReview(userId, filmId);
    if (!canReview.allowed) {
        throw new Error(canReview.reason);
    }

    // Create review and add credit in transaction
    db.transaction(() => {
        db.prepare(`
            INSERT INTO reviews (user_id, film_id, content, rating_direction, rating_screenplay, rating_acting)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, filmId, content, ratings.direction, ratings.screenplay, ratings.acting);

        db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId);
    })();

    return getUserReview(userId, filmId)!;
}
```

**Step 2: Commit**

```bash
git add app/src/lib/server/reviews.ts
git commit -m "feat: add review system with ratings and credit rewards"
```

---

## Phase 6: Frontend Pages

### Task 14: Layout and Base Styles

**Files:**
- Create: `app/src/routes/+layout.svelte`
- Create: `app/src/routes/+layout.server.ts`
- Create: `app/src/app.css`
- Update: `app/src/app.html`

**Step 1: Create layout.server.ts**

Create `app/src/routes/+layout.server.ts`:
```typescript
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
    return {
        user: locals.user
    };
};
```

**Step 2: Create app.css**

Create `app/src/app.css`:
```css
:root {
    --bg-primary: #1a1a2e;
    --bg-secondary: #16213e;
    --bg-card: #0f3460;
    --accent: #e94560;
    --accent-hover: #ff6b6b;
    --text-primary: #eee;
    --text-secondary: #aaa;
    --text-muted: #666;
    --success: #4ade80;
    --warning: #fbbf24;
    --error: #ef4444;
    --border-radius: 8px;
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
}

a {
    color: var(--accent);
    text-decoration: none;
}

a:hover {
    color: var(--accent-hover);
}

button {
    cursor: pointer;
    font-family: inherit;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1rem;
}

.btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: var(--border-radius);
    font-size: 1rem;
    font-weight: 500;
    transition: all 0.2s;
}

.btn-primary {
    background: var(--accent);
    color: white;
}

.btn-primary:hover {
    background: var(--accent-hover);
}

.btn-primary:disabled {
    background: var(--text-muted);
    cursor: not-allowed;
}

.btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--text-muted);
}

.btn-secondary:hover {
    border-color: var(--accent);
}

.card {
    background: var(--bg-card);
    border-radius: var(--border-radius);
    padding: 1.5rem;
}

.input {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--text-muted);
    border-radius: var(--border-radius);
    color: var(--text-primary);
    font-size: 1rem;
}

.input:focus {
    outline: none;
    border-color: var(--accent);
}

.label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
}

.error-message {
    color: var(--error);
    font-size: 0.9rem;
    margin-top: 0.5rem;
}

.success-message {
    color: var(--success);
    font-size: 0.9rem;
    margin-top: 0.5rem;
}
```

**Step 3: Update app.html**

Update `app/src/app.html`:
```html
<!doctype html>
<html lang="fr">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" href="%sveltekit.assets%/favicon.png" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Zone Club - Vidéoclub</title>
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

**Step 4: Create layout.svelte**

Create `app/src/routes/+layout.svelte`:
```svelte
<script lang="ts">
    import '../app.css';
    import type { LayoutData } from './$types';

    export let data: LayoutData;

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    }
</script>

<header>
    <nav class="container">
        <a href="/" class="logo">Zone Club</a>

        <div class="nav-links">
            {#if data.user}
                <a href="/rayons">Rayons</a>
                <a href="/compte">Mon compte</a>
                <span class="credits">{data.user.credits} crédit{data.user.credits !== 1 ? 's' : ''}</span>
                {#if data.user.is_admin}
                    <a href="/admin/films">Admin</a>
                {/if}
                <button class="btn-logout" on:click={logout}>Déconnexion</button>
            {:else}
                <a href="/login">Connexion</a>
                <a href="/register">Inscription</a>
            {/if}
        </div>
    </nav>
</header>

<main>
    <slot />
</main>

<footer>
    <div class="container">
        <p>Zone Club - Votre vidéoclub en ligne</p>
    </div>
</footer>

<style>
    header {
        background: var(--bg-secondary);
        padding: 1rem 0;
        position: sticky;
        top: 0;
        z-index: 100;
    }

    nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .logo {
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--accent);
    }

    .nav-links {
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }

    .credits {
        background: var(--accent);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.9rem;
    }

    .btn-logout {
        background: none;
        border: 1px solid var(--text-muted);
        color: var(--text-secondary);
        padding: 0.5rem 1rem;
        border-radius: var(--border-radius);
        font-size: 0.9rem;
    }

    .btn-logout:hover {
        border-color: var(--accent);
        color: var(--accent);
    }

    main {
        min-height: calc(100vh - 140px);
        padding: 2rem 0;
    }

    footer {
        background: var(--bg-secondary);
        padding: 1.5rem 0;
        text-align: center;
        color: var(--text-muted);
    }
</style>
```

**Step 5: Commit**

```bash
git add app/src/routes/+layout.svelte app/src/routes/+layout.server.ts app/src/app.css app/src/app.html
git commit -m "feat: add base layout with navigation and styles"
```

---

### Task 15: Homepage

**Files:**
- Create: `app/src/routes/+page.svelte`
- Create: `app/src/routes/+page.server.ts`

**Step 1: Create page.server.ts**

Create `app/src/routes/+page.server.ts`:
```typescript
import type { PageServerLoad } from './$types';
import { getAllFilms, getGenresWithFilmCount } from '$lib/server/films';

export const load: PageServerLoad = async () => {
    const films = getAllFilms(true).slice(0, 12);
    const genres = getGenresWithFilmCount().slice(0, 6);

    return { films, genres };
};
```

**Step 2: Create page.svelte**

Create `app/src/routes/+page.svelte`:
```svelte
<script lang="ts">
    import type { PageData } from './$types';

    export let data: PageData;
</script>

<svelte:head>
    <title>Zone Club - Vidéoclub en ligne</title>
</svelte:head>

<div class="container">
    <section class="hero">
        <h1>Bienvenue au Zone Club</h1>
        <p>Votre vidéoclub en ligne. Parcourez les rayons, louez des films, partagez vos critiques.</p>

        {#if !data.user}
            <div class="hero-actions">
                <a href="/register" class="btn btn-primary">S'inscrire</a>
                <a href="/login" class="btn btn-secondary">Se connecter</a>
            </div>
        {:else}
            <a href="/rayons" class="btn btn-primary">Parcourir les rayons</a>
        {/if}
    </section>

    {#if data.genres.length > 0}
        <section class="genres-section">
            <h2>Les rayons</h2>
            <div class="genres-grid">
                {#each data.genres as genre}
                    <a href="/rayons/{genre.slug}" class="genre-card">
                        <span class="genre-name">{genre.name}</span>
                        <span class="genre-count">{genre.film_count} film{genre.film_count > 1 ? 's' : ''}</span>
                    </a>
                {/each}
            </div>
            <a href="/rayons" class="see-all">Voir tous les rayons →</a>
        </section>
    {/if}

    {#if data.films.length > 0}
        <section class="films-section">
            <h2>Derniers ajouts</h2>
            <div class="films-grid">
                {#each data.films as film}
                    <a href="/film/{film.tmdb_id}" class="film-card">
                        {#if film.poster_url}
                            <img src={film.poster_url} alt={film.title} />
                        {:else}
                            <div class="no-poster">{film.title}</div>
                        {/if}
                        <div class="film-info">
                            <h3>{film.title}</h3>
                            <span class="year">{film.release_year || 'N/A'}</span>
                        </div>
                    </a>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    .hero {
        text-align: center;
        padding: 4rem 0;
    }

    .hero h1 {
        font-size: 3rem;
        margin-bottom: 1rem;
        color: var(--accent);
    }

    .hero p {
        font-size: 1.25rem;
        color: var(--text-secondary);
        margin-bottom: 2rem;
    }

    .hero-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
    }

    section {
        margin-bottom: 3rem;
    }

    h2 {
        font-size: 1.75rem;
        margin-bottom: 1.5rem;
    }

    .genres-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 1rem;
    }

    .genre-card {
        background: var(--bg-card);
        padding: 1.5rem;
        border-radius: var(--border-radius);
        text-align: center;
        transition: transform 0.2s;
    }

    .genre-card:hover {
        transform: translateY(-4px);
    }

    .genre-name {
        display: block;
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .genre-count {
        font-size: 0.9rem;
        color: var(--text-muted);
    }

    .see-all {
        display: inline-block;
        margin-top: 1rem;
    }

    .films-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 1.5rem;
    }

    .film-card {
        display: block;
    }

    .film-card img {
        width: 100%;
        aspect-ratio: 2/3;
        object-fit: cover;
        border-radius: var(--border-radius);
        transition: transform 0.2s;
    }

    .film-card:hover img {
        transform: scale(1.05);
    }

    .no-poster {
        width: 100%;
        aspect-ratio: 2/3;
        background: var(--bg-card);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 1rem;
        border-radius: var(--border-radius);
        color: var(--text-muted);
    }

    .film-info {
        padding: 0.75rem 0;
    }

    .film-info h3 {
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .year {
        font-size: 0.85rem;
        color: var(--text-muted);
    }
</style>
```

**Step 3: Commit**

```bash
git add app/src/routes/+page.svelte app/src/routes/+page.server.ts
git commit -m "feat: add homepage with genres and recent films"
```

---

### Task 16: Auth Pages (Login, Register, Recover)

**Files:**
- Create: `app/src/routes/login/+page.svelte`
- Create: `app/src/routes/register/+page.svelte`
- Create: `app/src/routes/recover/+page.svelte`

**Step 1: Create login page**

Create `app/src/routes/login/+page.svelte`:
```svelte
<script lang="ts">
    import { goto } from '$app/navigation';

    let username = '';
    let password = '';
    let error = '';
    let loading = false;

    async function handleSubmit() {
        error = '';
        loading = true;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                error = data.error;
                return;
            }

            goto('/rayons');
        } catch {
            error = 'Erreur de connexion';
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Connexion - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            <h1>Connexion</h1>

            <form on:submit|preventDefault={handleSubmit}>
                <div class="form-group">
                    <label class="label" for="username">Pseudo</label>
                    <input
                        type="text"
                        id="username"
                        class="input"
                        bind:value={username}
                        required
                    />
                </div>

                <div class="form-group">
                    <label class="label" for="password">Mot de passe</label>
                    <input
                        type="password"
                        id="password"
                        class="input"
                        bind:value={password}
                        required
                    />
                </div>

                {#if error}
                    <p class="error-message">{error}</p>
                {/if}

                <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                    {loading ? 'Connexion...' : 'Se connecter'}
                </button>
            </form>

            <div class="auth-links">
                <a href="/recover">Mot de passe oublié ?</a>
                <a href="/register">Pas encore inscrit ?</a>
            </div>
        </div>
    </div>
</div>

<style>
    .auth-page {
        display: flex;
        justify-content: center;
        padding: 2rem 0;
    }

    .auth-card {
        width: 100%;
        max-width: 400px;
    }

    h1 {
        text-align: center;
        margin-bottom: 2rem;
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    .full-width {
        width: 100%;
        justify-content: center;
    }

    .auth-links {
        margin-top: 1.5rem;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
</style>
```

**Step 2: Create register page**

Create `app/src/routes/register/+page.svelte`:
```svelte
<script lang="ts">
    import { goto } from '$app/navigation';

    let username = '';
    let password = '';
    let confirmPassword = '';
    let error = '';
    let loading = false;
    let recoveryPhrase = '';
    let showRecovery = false;

    async function handleSubmit() {
        error = '';

        if (password !== confirmPassword) {
            error = 'Les mots de passe ne correspondent pas';
            return;
        }

        loading = true;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                error = data.error;
                return;
            }

            recoveryPhrase = data.recoveryPhrase;
            showRecovery = true;
        } catch {
            error = 'Erreur lors de l\'inscription';
        } finally {
            loading = false;
        }
    }

    function copyPhrase() {
        navigator.clipboard.writeText(recoveryPhrase);
    }

    function continueToSite() {
        goto('/rayons');
    }
</script>

<svelte:head>
    <title>Inscription - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            {#if showRecovery}
                <h1>Bienvenue !</h1>

                <div class="recovery-section">
                    <p class="warning">
                        <strong>Important !</strong> Notez votre passphrase de récupération.
                        Elle ne sera plus jamais affichée.
                    </p>

                    <div class="passphrase-box">
                        <code>{recoveryPhrase}</code>
                        <button class="btn btn-secondary" on:click={copyPhrase}>Copier</button>
                    </div>

                    <p class="hint">
                        Cette passphrase vous permettra de récupérer votre compte si vous oubliez votre mot de passe.
                    </p>

                    <button class="btn btn-primary full-width" on:click={continueToSite}>
                        J'ai noté ma passphrase, continuer
                    </button>
                </div>
            {:else}
                <h1>Inscription</h1>

                <form on:submit|preventDefault={handleSubmit}>
                    <div class="form-group">
                        <label class="label" for="username">Pseudo</label>
                        <input
                            type="text"
                            id="username"
                            class="input"
                            bind:value={username}
                            minlength="3"
                            maxlength="30"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label class="label" for="password">Mot de passe</label>
                        <input
                            type="password"
                            id="password"
                            class="input"
                            bind:value={password}
                            minlength="8"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label class="label" for="confirmPassword">Confirmer le mot de passe</label>
                        <input
                            type="password"
                            id="confirmPassword"
                            class="input"
                            bind:value={confirmPassword}
                            required
                        />
                    </div>

                    {#if error}
                        <p class="error-message">{error}</p>
                    {/if}

                    <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                        {loading ? 'Inscription...' : 'S\'inscrire'}
                    </button>
                </form>

                <div class="auth-links">
                    <a href="/login">Déjà inscrit ?</a>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .auth-page {
        display: flex;
        justify-content: center;
        padding: 2rem 0;
    }

    .auth-card {
        width: 100%;
        max-width: 450px;
    }

    h1 {
        text-align: center;
        margin-bottom: 2rem;
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    .full-width {
        width: 100%;
        justify-content: center;
    }

    .auth-links {
        margin-top: 1.5rem;
        text-align: center;
    }

    .recovery-section {
        text-align: center;
    }

    .warning {
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid var(--warning);
        padding: 1rem;
        border-radius: var(--border-radius);
        margin-bottom: 1.5rem;
    }

    .passphrase-box {
        background: var(--bg-secondary);
        padding: 1.5rem;
        border-radius: var(--border-radius);
        margin-bottom: 1rem;
    }

    .passphrase-box code {
        display: block;
        font-size: 1.25rem;
        margin-bottom: 1rem;
        color: var(--accent);
        word-break: break-all;
    }

    .hint {
        color: var(--text-muted);
        font-size: 0.9rem;
        margin-bottom: 1.5rem;
    }
</style>
```

**Step 3: Create recover page**

Create `app/src/routes/recover/+page.svelte`:
```svelte
<script lang="ts">
    import { goto } from '$app/navigation';

    let username = '';
    let recoveryPhrase = '';
    let newPassword = '';
    let confirmPassword = '';
    let error = '';
    let loading = false;
    let newRecoveryPhrase = '';
    let showNewPhrase = false;

    async function handleSubmit() {
        error = '';

        if (newPassword !== confirmPassword) {
            error = 'Les mots de passe ne correspondent pas';
            return;
        }

        loading = true;

        try {
            const res = await fetch('/api/auth/recover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, recoveryPhrase, newPassword })
            });

            const data = await res.json();

            if (!res.ok) {
                error = data.error;
                return;
            }

            newRecoveryPhrase = data.newRecoveryPhrase;
            showNewPhrase = true;
        } catch {
            error = 'Erreur lors de la récupération';
        } finally {
            loading = false;
        }
    }

    function copyPhrase() {
        navigator.clipboard.writeText(newRecoveryPhrase);
    }

    function continueToSite() {
        goto('/rayons');
    }
</script>

<svelte:head>
    <title>Récupération - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            {#if showNewPhrase}
                <h1>Compte récupéré !</h1>

                <div class="recovery-section">
                    <p class="warning">
                        <strong>Nouvelle passphrase !</strong>
                        Votre ancienne passphrase n'est plus valide. Notez la nouvelle.
                    </p>

                    <div class="passphrase-box">
                        <code>{newRecoveryPhrase}</code>
                        <button class="btn btn-secondary" on:click={copyPhrase}>Copier</button>
                    </div>

                    <button class="btn btn-primary full-width" on:click={continueToSite}>
                        J'ai noté ma passphrase, continuer
                    </button>
                </div>
            {:else}
                <h1>Récupération</h1>

                <p class="intro">
                    Entrez votre pseudo et votre passphrase de récupération pour définir un nouveau mot de passe.
                </p>

                <form on:submit|preventDefault={handleSubmit}>
                    <div class="form-group">
                        <label class="label" for="username">Pseudo</label>
                        <input
                            type="text"
                            id="username"
                            class="input"
                            bind:value={username}
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label class="label" for="recoveryPhrase">Passphrase de récupération</label>
                        <input
                            type="text"
                            id="recoveryPhrase"
                            class="input"
                            bind:value={recoveryPhrase}
                            placeholder="plat-origine-qualificatif"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label class="label" for="newPassword">Nouveau mot de passe</label>
                        <input
                            type="password"
                            id="newPassword"
                            class="input"
                            bind:value={newPassword}
                            minlength="8"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label class="label" for="confirmPassword">Confirmer le mot de passe</label>
                        <input
                            type="password"
                            id="confirmPassword"
                            class="input"
                            bind:value={confirmPassword}
                            required
                        />
                    </div>

                    {#if error}
                        <p class="error-message">{error}</p>
                    {/if}

                    <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                        {loading ? 'Récupération...' : 'Récupérer mon compte'}
                    </button>
                </form>

                <div class="auth-links">
                    <a href="/login">Retour à la connexion</a>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .auth-page {
        display: flex;
        justify-content: center;
        padding: 2rem 0;
    }

    .auth-card {
        width: 100%;
        max-width: 450px;
    }

    h1 {
        text-align: center;
        margin-bottom: 1rem;
    }

    .intro {
        text-align: center;
        color: var(--text-secondary);
        margin-bottom: 2rem;
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    .full-width {
        width: 100%;
        justify-content: center;
    }

    .auth-links {
        margin-top: 1.5rem;
        text-align: center;
    }

    .recovery-section {
        text-align: center;
    }

    .warning {
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid var(--warning);
        padding: 1rem;
        border-radius: var(--border-radius);
        margin-bottom: 1.5rem;
    }

    .passphrase-box {
        background: var(--bg-secondary);
        padding: 1.5rem;
        border-radius: var(--border-radius);
        margin-bottom: 1.5rem;
    }

    .passphrase-box code {
        display: block;
        font-size: 1.25rem;
        margin-bottom: 1rem;
        color: var(--accent);
    }
</style>
```

**Step 4: Commit**

```bash
git add app/src/routes/login/ app/src/routes/register/ app/src/routes/recover/
git commit -m "feat: add authentication pages (login, register, recover)"
```

---

I'll continue with the remaining tasks in Part 2, covering:
- Task 17: Rayons (Genre) Pages
- Task 18: Film Detail Page
- Task 19: Video Player Page
- Task 20: Review Page
- Task 21: User Account Page
- Task 22: Admin Pages
- Task 23: API Routes for Rentals and Reviews
- Task 24: Cleanup Cron Job
- Task 25: Final Integration and Testing

---

**Plan complete and saved to `docs/plans/2026-01-28-zone-club-implementation.md`.**

Ce plan couvre les 14 premières tâches essentielles. Le document est conséquent, je peux continuer avec les tâches 15-25 si tu veux, ou on peut commencer l'implémentation maintenant.

**Deux options d'exécution :**

1. **Subagent-Driven (cette session)** - Je dispatche un agent frais par tâche, revue entre chaque, itération rapide

2. **Session parallèle (séparée)** - Tu ouvres une nouvelle session avec le plan, exécution par lots avec checkpoints

Quelle approche préfères-tu ?