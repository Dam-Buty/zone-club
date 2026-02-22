#!/bin/sh
set -e

# Install ffmpeg/ffprobe if missing (needed by transcoder)
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "[zone-club] Installing ffmpeg..."
  apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null 2>&1
fi

# Standalone needs static assets and public folder
echo "[zone-club] Linking static assets..."
ln -sfn /app/public /app/.next/standalone/public
ln -sfn /app/.next/static /app/.next/standalone/.next/static

echo "[zone-club] Starting server..."
cd /app/.next/standalone
exec node server.js
