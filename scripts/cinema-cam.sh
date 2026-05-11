#!/usr/bin/env bash
# Bridge HLS de Zone Club Cinéma :
#  - vidéo  → /dev/video{VIDEO_NR}             (caméra virtuelle v4l2loopback)
#  - audio  → null-sink PipeWire/Pulse         (visible côté Discord comme micro)
#
# Le module v4l2loopback doit déjà être chargé (cinema-cam-module.service le fait).

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
HLS_URL="${HLS_URL:-https://club-storage.lazone.at/cinema-live/live.m3u8}"
SCALE="${SCALE:-1280:720}"
FRAMERATE="${FRAMERATE:-24}"
CARD_LABEL="${CARD_LABEL:-Zone Club Cinéma}"
AUDIO_SINK_NAME="${AUDIO_SINK_NAME:-zone-cinema}"

if [ ! -e "/dev/video${VIDEO_NR}" ]; then
  echo "Erreur : /dev/video${VIDEO_NR} n'existe pas. Charge v4l2loopback :" >&2
  echo "  sudo systemctl start cinema-cam-module.service" >&2
  exit 1
fi

if ! command -v pactl >/dev/null 2>&1; then
  echo "Erreur : pactl introuvable (installe pulseaudio-utils ou pipewire-pulse)." >&2
  exit 1
fi

# Cleanup d'éventuels null-sinks "zone-cinema" orphelins (précédents runs tués sans cleanup)
pactl list modules \
  | awk -v name="${AUDIO_SINK_NAME}" '/^Module #/{id=$2} $0 ~ ("sink_name=" name){print id}' \
  | tr -d '#' \
  | xargs -rn1 pactl unload-module 2>/dev/null || true

# Crée un null-sink dédié, dont le monitor sera utilisable comme input mic
SINK_MODULE_ID="$(pactl load-module module-null-sink \
  sink_name="${AUDIO_SINK_NAME}" \
  sink_properties="device.description=\"${CARD_LABEL}\"")"

cleanup() {
  if [ -n "${SINK_MODULE_ID:-}" ]; then
    pactl unload-module "${SINK_MODULE_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

exec ffmpeg \
  -hide_banner -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -rw_timeout 30000000 \
  -re -i "${HLS_URL}" \
  -map 0:v -vf "format=yuv420p,scale=${SCALE},fps=${FRAMERATE}" -f v4l2 "/dev/video${VIDEO_NR}" \
  -map 0:a -f pulse -ac 2 -ar 48000 "${AUDIO_SINK_NAME}"
