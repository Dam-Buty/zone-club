#!/usr/bin/env bash
# Setup complet du bridge HLS → caméra virtuelle + sink audio pour Zone Club Cinéma.
#
# Architecture :
#   - cinema-cam-module.service (system) : charge/décharge v4l2loopback (root)
#   - cinema-cam.service         (user)  : null-sink audio + ffmpeg (en session user)
#
# Usage : ./scripts/cinema-cam-install.sh
# Variables (optionnelles) :
#   VIDEO_NR=10
#   CARD_LABEL="Zone Club Cinéma"
#   HLS_URL=https://club-storage.lazone.at/cinema-live/live.m3u8
#   SCALE=1280:720
#   AUDIO_SINK_NAME=zone-cinema

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
CARD_LABEL="${CARD_LABEL:-Zone Club Cinéma}"
HLS_URL="${HLS_URL:-https://club-storage.lazone.at/cinema-live/live.m3u8}"
SCALE="${SCALE:-1280:720}"
FRAMERATE="${FRAMERATE:-24}"
AUDIO_SINK_NAME="${AUDIO_SINK_NAME:-zone-cinema}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_UNIT_DIR="$HOME/.config/systemd/user"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { color "1;34" "==> $*"; }
ok()   { color "1;32" "    $*"; }
warn() { color "1;33" "    $*"; }
fail() { color "1;31" "!!! $*"; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "Ce script ne fonctionne que sous Linux."

# 1. Install deps
step "Installation des dépendances (v4l2loopback-dkms + ffmpeg + pactl)"
if command -v apt >/dev/null 2>&1; then
  sudo apt update -qq
  sudo apt install -y v4l2loopback-dkms ffmpeg pulseaudio-utils
elif command -v pacman >/dev/null 2>&1; then
  case "$(uname -r)" in
    *zen*)      HEADERS_PKG=linux-zen-headers ;;
    *lts*)      HEADERS_PKG=linux-lts-headers ;;
    *hardened*) HEADERS_PKG=linux-hardened-headers ;;
    *)          HEADERS_PKG=linux-headers ;;
  esac
  sudo pacman -S --needed --noconfirm "$HEADERS_PKG" v4l2loopback-dkms ffmpeg libpulse
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y v4l2loopback "kernel-devel-$(uname -r)" ffmpeg pulseaudio-utils
else
  fail "Pas de package manager reconnu (apt/pacman/dnf)."
fi
ok "deps installées"

# 1b. Force la build DKMS pour le kernel courant
if command -v dkms >/dev/null 2>&1; then
  step "Build DKMS pour kernel $(uname -r)"
  sudo dkms autoinstall -k "$(uname -r)" >/dev/null 2>&1 || true
  ok "build DKMS appliqué"
fi

# 1c. Sanity check : le module doit être trouvable
step "Vérification que le module v4l2loopback est disponible"
if ! sudo modprobe --dry-run v4l2loopback 2>/dev/null; then
  fail "Module v4l2loopback introuvable pour le kernel $(uname -r).
       Si tu viens d'update le kernel, reboote.
       Sinon : sudo dkms status puis sudo dkms install v4l2loopback/<ver> -k $(uname -r)"
fi
ok "module disponible"

# 2. Cleanup d'éventuelles anciennes versions
if [ -f /etc/systemd/system/cinema-cam.service ] && \
   grep -q 'modprobe' /etc/systemd/system/cinema-cam.service 2>/dev/null; then
  warn "Ancienne version system-level détectée — désinstallation"
  sudo systemctl disable --now cinema-cam.service 2>/dev/null || true
  sudo rm -f /etc/systemd/system/cinema-cam.service
fi
if [ -f "$USER_UNIT_DIR/cinema-cam.service" ]; then
  systemctl --user disable --now cinema-cam.service 2>/dev/null || true
fi

# 3. Install cinema-cam.sh dans /usr/local/bin
# On lit le fichier avec l'uid de l'utilisateur (sshfs peut bloquer root)
# puis on le pipe vers sudo tee qui écrit en /usr/local/bin/.
step "Installation de cinema-cam.sh dans /usr/local/bin"
sudo tee /usr/local/bin/cinema-cam.sh < "$REPO_DIR/scripts/cinema-cam.sh" >/dev/null
sudo chmod 0755 /usr/local/bin/cinema-cam.sh
ok "/usr/local/bin/cinema-cam.sh installé"

# 4. Install service système (charge le module)
step "Installation du service système cinema-cam-module.service"
sudo tee /etc/systemd/system/cinema-cam-module.service >/dev/null <<EOF
[Unit]
Description=Zone Club Cinéma — load v4l2loopback module
After=systemd-modules-load.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/modprobe v4l2loopback video_nr=${VIDEO_NR} card_label=${CARD_LABEL} exclusive_caps=1 max_buffers=8
ExecStop=/sbin/modprobe -r v4l2loopback

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now cinema-cam-module.service
ok "module chargé"

# 5. Install service user (ffmpeg + null-sink)
step "Installation du service user cinema-cam.service"
mkdir -p "$USER_UNIT_DIR"
cat > "$USER_UNIT_DIR/cinema-cam.service" <<EOF
[Unit]
Description=Zone Club Cinéma — bridge HLS vers caméra virtuelle + sink audio
After=graphical-session.target pipewire.service

[Service]
Type=simple
Environment="VIDEO_NR=${VIDEO_NR}"
Environment="CARD_LABEL=${CARD_LABEL}"
Environment="HLS_URL=${HLS_URL}"
Environment="SCALE=${SCALE}"
Environment="FRAMERATE=${FRAMERATE}"
Environment="AUDIO_SINK_NAME=${AUDIO_SINK_NAME}"
ExecStart=/usr/local/bin/cinema-cam.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now cinema-cam.service
ok "ffmpeg lancé"

# 6. Linger pour que le service user tourne hors session
step "Activation du linger (le service tourne hors session)"
sudo loginctl enable-linger "$USER" || warn "linger pas activé (optionnel)"

# 7. Recap
echo
color "1;32" "✓ Tout est en place."
echo
echo "Vérification :"
echo "  systemctl status cinema-cam-module.service   # module"
echo "  systemctl --user status cinema-cam.service   # ffmpeg"
echo "  journalctl --user -u cinema-cam.service -f   # logs ffmpeg"
echo
echo "Dans Discord :"
echo "  Settings → Voice & Video :"
echo "    - Camera = \"$CARD_LABEL\""
echo "    - Input Device = \"Monitor of $CARD_LABEL\"  (ou similaire)"
echo "  Rejoins le voice → bouton vidéo → Share Camera"
echo
echo "Pour désinstaller :"
echo "  systemctl --user disable --now cinema-cam.service"
echo "  sudo systemctl disable --now cinema-cam-module.service"
echo "  rm \$HOME/.config/systemd/user/cinema-cam.service"
echo "  sudo rm /etc/systemd/system/cinema-cam-module.service /usr/local/bin/cinema-cam.sh"
