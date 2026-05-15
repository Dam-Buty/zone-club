# Discord Setup — Zone Club Status Bot

Le bot Discord de Zone Club ne stream pas de vidéo. Il se connecte au voice channel et met à jour son statut + son activity en permanence avec le film en cours dans la "chaîne" Zone Club Cinéma 24/7.

Le streaming vidéo lui-même est assuré par le service `cinema-stream` côté serveur (HLS via lighttpd) et ingéré côté client par une caméra virtuelle. Voir `CINEMA_SETUP.md`.

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications
2. **New Application** → nomme-la `Zone Club Cinéma`
3. Onglet **Bot** :
   - **Reset Token** → copie le token, c'est ton `DISCORD_BOT_TOKEN`
   - Active **Server Members Intent** (Privileged Gateway Intents)
   - Active **Voice State Intent** (Privileged Gateway Intents)
   - Décoche **Public Bot** si tu veux qu'il reste privé

## 2. Permissions et invitation

1. Onglet **OAuth2 → URL Generator**
2. Coche les scopes :
   - `bot`
3. Coche les bot permissions :
   - `View Channels`
   - `Connect`
   - `Speak`
   - `Use Voice Activity`
   - `Set Voice Channel Status`
4. Copie l'URL générée en bas
5. Ouvre l'URL dans ton navigateur, sélectionne le serveur, **Authorize**

## 3. Récupérer les IDs

Active le mode développeur dans Discord :
- **User Settings → Advanced → Developer Mode → ON**

Puis :
- Clic droit sur ton serveur → **Copy Server ID** → c'est ton `DISCORD_GUILD_ID`
- Clic droit sur le voice channel → **Copy Channel ID** → c'est ton `DISCORD_VOICE_CHANNEL_ID`

## 4. Variables d'environnement

Ajoute au `.env` à la racine du projet :

```bash
DISCORD_BOT_TOKEN=ton_token_ici
DISCORD_GUILD_ID=123456789012345678
DISCORD_VOICE_CHANNEL_ID=123456789012345678
PLAYLIST_START=1993-06-11
```

`PLAYLIST_START` est la date à laquelle la "chaîne" est censée avoir commencé à émettre (interprété 00:00 Europe/Paris). On en déduit la position courante dans la boucle de films.

## 5. Lancer le bot

```bash
npm run bot:rebuild   # première fois (build de l'image)
npm run bot:logs      # pour suivre les logs

# Plus tard :
npm run bot:restart   # redémarrer (sans rebuild)
npm run bot:up        # relancer si arrêté
npm run bot:down      # arrêter
```

À l'allumage le bot :
1. Lit le cache `films.duration_sec` en DB (pas de probing — c'est `cinema-stream` qui s'en charge)
2. Calcule la position courante dans la playlist
3. Se connecte au voice channel
4. Met à jour le voice channel status (`🎬 Robocop (1987) — 23:12 / 1:43:00`) toutes les 60s
5. Met à jour son activity (`Watching Robocop (1987)`) toutes les 60s

> Le bot dépend de `cinema-stream` pour avoir des durations en DB. Lance `cinema-stream` au moins une fois avant le bot, sinon les films sans `duration_sec` sont ignorés.

## Troubleshooting

**Le bot rejoint mais le voice channel status ne se met pas à jour**
- Vérifie que la permission `Set Voice Channel Status` est bien donnée au rôle du bot dans le voice channel (clic droit channel → Edit → Permissions)

**`Missing Access` dans les logs**
- Le bot n'est pas invité sur le serveur, ou le `DISCORD_VOICE_CHANNEL_ID` ne correspond pas au serveur indiqué par `DISCORD_GUILD_ID`

**`No films with VF found, exiting`**
- La DB n'a aucun film avec `file_path_vf` non null. Lance `npm run seed` côté app principale, ou attends que Radarr télécharge des fichiers
