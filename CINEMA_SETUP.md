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

Empreinte minimale sur le système — un seul fichier permanent : `/etc/systemd/system/cinema-cam.service`. Le module `v4l2loopback` est chargé au start du service, déchargé au stop. Pas de config dans `/etc/modules-load.d` ni `/etc/modprobe.d`.

Le script :
1. Installe `v4l2loopback-dkms` + `ffmpeg` (apt / pacman / dnf)
2. Copie `cinema-cam.sh` dans `/usr/local/bin/` (le service en a besoin)
3. Écrit `/etc/systemd/system/cinema-cam.service`
4. `systemctl enable --now cinema-cam.service`

Variables surchargeables :
```bash
VIDEO_NR=10 \
CARD_LABEL="Zone Club Cinéma" \
HLS_URL=https://club-storage.lazone.at/cinema-live/live.m3u8 \
SCALE=1280:720 \
./scripts/cinema-cam-install.sh
```

### Vérification + logs

```bash
systemctl status cinema-cam.service
journalctl -u cinema-cam.service -f
```

### Dans Discord

1. **User Settings → Voice & Video → Camera** → choisis `Zone Club Cinéma`
2. Rejoins le voice channel
3. Bouton vidéo → **Share Camera**

### Désinstall complète

```bash
sudo systemctl disable --now cinema-cam.service
sudo rm /etc/systemd/system/cinema-cam.service /usr/local/bin/cinema-cam.sh
sudo modprobe -r v4l2loopback
sudo apt remove v4l2loopback-dkms   # optionnel
```

### Lancement à la main (sans systemd)

Le script `cinema-cam.sh` charge le module si on l'invoque en root :
```bash
sudo HLS_URL="https://club-storage.lazone.at/cinema-live/live.m3u8" \
     ./scripts/cinema-cam.sh
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
