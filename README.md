# Zone Club

Videoclub 3D immersif — experience FPS dans un videoclub retro des annees 90.

Naviguez entre les etageres, prenez des cassettes VHS, louez des films et regardez-les directement dans le navigateur.

## Stack

- Next.js 15 (App Router) + React 19
- Three.js (React Three Fiber, WebGPU renderer)
- Zustand + Tailwind CSS v4
- SQLite (better-sqlite3) + cookie auth
- Docker (5 services, 0 builds)

## Demarrage rapide

```bash
cp .env.example .env   # Configurer les variables d'environnement
npm install
npm run seed           # Initialiser la base de donnees
npm run dev            # http://localhost:3000
```

## Production (Docker)

```bash
npm run build          # Genere .next/standalone
docker compose up -d   # 5 services (app, storage, radarr-vo, radarr-vf, bazarr)
```

Pas de Docker build — le container `app` monte `.next/standalone` directement.

## Controles

| Action | Clavier | Souris |
|---|---|---|
| Avancer | Z / W | - |
| Reculer | S | - |
| Gauche | Q / A | - |
| Droite | D | - |
| Regarder | - | Mouvement |
| Interagir | - | Clic gauche |
| Quitter menu | Echap | - |

Support tactile mobile (joystick virtuel + swipe).

## Variables d'environnement

Voir `.env.example` pour la liste complete. Variables principales :

- `NEXT_PUBLIC_TMDB_API_KEY` — Cle TMDB (client)
- `TMDB_API_KEY` — Cle TMDB (serveur)
- `RADARR_VO_API_KEY` / `RADARR_VF_API_KEY` — API keys Radarr
- `HMAC_SECRET` — Signature cookies
- `DOMAIN` / `SUBDOMAIN` / `STORAGE_SUBDOMAIN` — Configuration domaine
