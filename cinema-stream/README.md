# Cinema Setup — Diffusion Zone Club Cinéma

Le service `cinema-stream` expose un flux HLS continu via :

```
https://${STORAGE_SUBDOMAIN}.${DOMAIN}/cinema-live/live.m3u8
```

Pour partager ce flux dans un voice Discord, on l'ingère côté machine cliente vers une caméra virtuelle, puis on partage cette caméra dans Discord. Trois chemins selon ta plateforme.

## 1. Démarrer le serveur HLS

```bash
npm run cinema:rebuild  # première fois
npm run cinema:logs     # suivre les logs
```

Le service va :
1. Pour chaque film VF sans `duration_sec` en DB : ffprobe + UPDATE (~quelques minutes au premier boot ; instantané ensuite)
2. Calculer la position courante depuis `PLAYLIST_START`
3. Lancer un ffmpeg long-running qui écrit le HLS dans `/media/public/symlinks/cinema-live/`
4. lighttpd existant le sert automatiquement

Vérifie que ça marche depuis ton navigateur :
```
https://${STORAGE_SUBDOMAIN}.${DOMAIN}/cinema-live/live.m3u8
```
Tu dois pouvoir le lire dans VLC, mpv, Safari, ou un player HLS.

## 2. Client Linux (headless, recommandé)

### Setup en une commande

```bash
./scripts/cinema-cam-install.sh
```

Le script crée deux services systemd :
- **`cinema-cam-module.service`** (system, oneshot) — charge `v4l2loopback` au boot, le décharge au stop
- **`cinema-cam.service`** (user) — crée un null-sink PipeWire/Pulse (audio) + lance `ffmpeg` qui pompe le HLS dans `/dev/video10` (vidéo) et le sink (audio)

Variables surchargeables :
```bash
VIDEO_NR=10 \
CARD_LABEL="Zone Club Cinéma" \
HLS_URL=https://${STORAGE_SUBDOMAIN}.${DOMAIN}/cinema-live/live.m3u8 \
SCALE=1280:720 \
./scripts/cinema-cam-install.sh
```

### Vérification + logs

```bash
systemctl status cinema-cam-module.service   # le module
systemctl --user status cinema-cam.service   # ffmpeg + sink audio
journalctl --user -u cinema-cam.service -f
```

### Dans Discord

1. **User Settings → Voice & Video** :
   - **Camera** = `Zone Club Cinéma`
   - **Input Device** = `Monitor of Zone Club Cinéma` (le micro virtuel branché sur le sink)
2. Rejoins le voice channel
3. Bouton vidéo → **Share Camera**

> Le bot Discord parle dans le voice avec son "micro" qui est en fait l'audio du film. Si tu veux parler par-dessus, faut switcher l'Input Device sur ton vrai micro temporairement (Discord ne mixe pas deux inputs).

### Désinstall

```bash
systemctl --user disable --now cinema-cam.service
sudo systemctl disable --now cinema-cam-module.service
rm $HOME/.config/systemd/user/cinema-cam.service
sudo rm /etc/systemd/system/cinema-cam-module.service /usr/local/bin/cinema-cam.sh
```

## 3. Client macOS

Apple a verrouillé l'écosystème caméras virtuelles depuis macOS 12.3, donc OBS reste le chemin le plus simple.

### Installation

```bash
brew install --cask obs
```

### Configuration OBS

1. Ouvre OBS
2. **Sources → +  → Media Source**
3. Décoche **Local File**
4. Dans **Input** colle l'URL HLS
5. Coche **Restart playback when source becomes active**
6. Coche **Use hardware decoding when available**
7. **OK**

### Lancement

1. Menu OBS → **Tools → Start Virtual Camera**
2. OBS peut être minimisé, la cam tourne en arrière-plan

### Dans Discord

1. **Settings → Voice & Video → Camera** → choisis `OBS Virtual Camera`
2. Rejoins le voice channel
3. Bouton vidéo → **Share Camera**

## 4. Client Raspberry Pi (alternative headless)

Pareil que Linux x86 — `v4l2loopback` marche en ARM. Tu peux dédier un Pi à ce job, qui run en permanence le script et expose la caméra virtuelle. Discord en revanche n'a pas de client natif ARM Linux, donc tu ouvres Discord dans Chromium qui voit la `/dev/video10`.

```bash
sudo apt install -y v4l2loopback-dkms ffmpeg chromium-browser
# Puis suit les étapes Linux
```

## Troubleshooting

**Le flux HLS répond 404**
- Vérifie que le service `cinema-stream` tourne : `npm run cinema:logs`
- Vérifie qu'il a fini son ffprobe initial et que ffmpeg a démarré (cherche `[ffmpeg] starting at film`)
- Vérifie que `lighttpd.conf` contient bien les mime types `.m3u8` et `.ts` (devrait déjà être le cas)

**ffmpeg côté client lit le HLS mais bloque sur `Cannot find ext`**
- Augmente le buffer : `-rw_timeout 30000000 -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5`

**Discord voit la caméra noire**
- ffmpeg doit avoir été lancé avant de cliquer sur Share Camera
- Sur Linux : vérifie que `/dev/video10` existe et a les bonnes permissions (`ls -la /dev/video10`)

**Pas assez d'upload pour Discord**
- Discord exige ~3-4 Mbps en upload pour 720p30. Vérifie ton upload (https://fast.com).
- Tu peux baisser la qualité du flux en ajustant les params ffmpeg côté serveur (preset plus rapide, bitrate plus bas)
