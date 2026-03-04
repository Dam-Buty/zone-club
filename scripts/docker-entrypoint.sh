#!/bin/sh
set -e

# Standalone needs static assets and public folder
echo "[zone-club] Linking static assets..."
ln -sfn /app/public /app/.next/standalone/public
ln -sfn /app/.next/static /app/.next/standalone/.next/static

echo "[zone-club] Starting server..."
cd /app/.next/standalone
exec node server.js
