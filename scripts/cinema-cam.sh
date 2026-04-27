#!/usr/bin/env bash
# Bridge HLS de Zone Club Cinéma vers /dev/video{VIDEO_NR}.
#
# Si le module v4l2loopback n'est pas chargé et qu'on est root, on le charge.
# Sinon on attend que /dev/video${VIDEO_NR} existe (modprobe doit être fait par le caller).

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
HLS_URL="${HLS_URL:-https://club-storage.lazone.at/cinema-live/live.m3u8}"
SCALE="${SCALE:-1280:720}"
CARD_LABEL="${CARD_LABEL:-Zone Club Cinéma}"

# Si on tourne en root et que le module n'est pas chargé, on le charge
if [ "$(id -u)" = "0" ] && ! lsmod | grep -q '^v4l2loopback'; then
  modprobe v4l2loopback \
    video_nr="${VIDEO_NR}" \
    card_label="${CARD_LABEL}" \
    exclusive_caps=1
fi

if [ ! -e "/dev/video${VIDEO_NR}" ]; then
  echo "Erreur : /dev/video${VIDEO_NR} n'existe pas." >&2
  echo "Charge le module avec :" >&2
  echo "  sudo modprobe v4l2loopback video_nr=${VIDEO_NR} card_label=\"${CARD_LABEL}\" exclusive_caps=1" >&2
  exit 1
fi

exec ffmpeg \
  -hide_banner -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -rw_timeout 30000000 \
  -re -i "${HLS_URL}" \
  -vf "format=yuv420p,scale=${SCALE}" \
  -f v4l2 "/dev/video${VIDEO_NR}"
