#!/usr/bin/env bash
# Setup du bridge HLS → caméra virtuelle pour Zone Club Cinéma.
#
# Approche minimale : un seul fichier permanent (/etc/systemd/system/cinema-cam.service).
# Le module v4l2loopback est chargé au start du service et déchargé au stop — rien
# n'est laissé en place en cas de uninstall ou reboot.
#
# Usage : ./scripts/cinema-cam-install.sh
# Variables (optionnelles) :
#   VIDEO_NR=10
#   CARD_LABEL="Zone Club Cinéma"
#   HLS_URL=https://club-storage.lazone.at/cinema-live/live.m3u8
#   SCALE=1280:720

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
CARD_LABEL="${CARD_LABEL:-Zone Club Cinéma}"
HLS_URL="${HLS_URL:-https://club-storage.lazone.at/cinema-live/live.m3u8}"
SCALE="${SCALE:-1280:720}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { color "1;34" "==> $*"; }
ok()   { color "1;32" "    $*"; }
warn() { color "1;33" "    $*"; }
fail() { color "1;31" "!!! $*"; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "Ce script ne fonctionne que sous Linux (v4l2loopback est un module kernel Linux)."

# 1. Install deps
step "Installation des dépendances (v4l2loopback-dkms + ffmpeg)"
if command -v apt >/dev/null 2>&1; then
  sudo apt update -qq
  sudo apt install -y v4l2loopback-dkms ffmpeg
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --needed --noconfirm v4l2loopback-dkms ffmpeg
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y v4l2loopback ffmpeg
else
  fail "Pas de package manager reconnu (apt/pacman/dnf). Installe v4l2loopback-dkms et ffmpeg manuellement."
fi
ok "deps installées"

# 2. Install cinema-cam.sh dans /usr/local/bin (pour qu'il soit accessible au service système)
step "Installation de cinema-cam.sh dans /usr/local/bin"
sudo install -m 0755 "$REPO_DIR/scripts/cinema-cam.sh" /usr/local/bin/cinema-cam.sh
ok "/usr/local/bin/cinema-cam.sh installé"

# 3. Generate + install systemd system unit avec les variables choisies
step "Installation du service systemd (system-level)"
sudo tee /etc/systemd/system/cinema-cam.service >/dev/null <<EOF
[Unit]
Description=Zone Club Cinéma — bridge HLS vers caméra virtuelle (v4l2loopback)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment="VIDEO_NR=${VIDEO_NR}"
Environment="CARD_LABEL=${CARD_LABEL}"
Environment="HLS_URL=${HLS_URL}"
Environment="SCALE=${SCALE}"
ExecStart=/usr/local/bin/cinema-cam.sh
ExecStopPost=-/sbin/modprobe -r v4l2loopback
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
ok "/etc/systemd/system/cinema-cam.service écrit"

# 4. Cleanup éventuel de l'ancienne version user-level
if [ -f "$HOME/.config/systemd/user/cinema-cam.service" ]; then
  warn "Ancienne version user-level détectée — désactivation"
  systemctl --user disable --now cinema-cam.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/cinema-cam.service"
fi

# 5. Enable + start
step "Activation et démarrage du service"
sudo systemctl daemon-reload
sudo systemctl enable --now cinema-cam.service
ok "service démarré"

# 6. Recap
echo
color "1;32" "✓ Tout est en place."
echo
echo "Vérification :"
echo "  systemctl status cinema-cam.service"
echo "  journalctl -u cinema-cam.service -f"
echo
echo "Dans Discord :"
echo "  Settings → Voice & Video → Camera → \"$CARD_LABEL\""
echo "  Rejoins le voice → bouton vidéo → Share Camera"
echo
echo "Pour désinstaller proprement :"
echo "  sudo systemctl disable --now cinema-cam.service"
echo "  sudo rm /etc/systemd/system/cinema-cam.service /usr/local/bin/cinema-cam.sh"
