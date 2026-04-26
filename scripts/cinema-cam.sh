#!/usr/bin/env bash
# Linux client : ingère le flux HLS de Zone Club Cinéma vers /dev/video{VIDEO_NR}.
# v4l2loopback doit être chargé au préalable (modprobe v4l2loopback ...).

set -euo pipefail

VIDEO_NR="${VIDEO_NR:-10}"
HLS_URL="${HLS_URL:-https://stream.lazone.at/cinema-live/live.m3u8}"
SCALE="${SCALE:-1280:720}"

if [ ! -e "/dev/video${VIDEO_NR}" ]; then
  echo "Erreur : /dev/video${VIDEO_NR} n'existe pas. Charge le module v4l2loopback :"
  echo "  sudo modprobe v4l2loopback video_nr=${VIDEO_NR} card_label=\"Zone Club Cinéma\" exclusive_caps=1"
  exit 1
fi

exec ffmpeg \
  -hide_banner -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -rw_timeout 30000000 \
  -re -i "${HLS_URL}" \
  -vf "format=yuv420p,scale=${SCALE}" \
  -f v4l2 "/dev/video${VIDEO_NR}"
