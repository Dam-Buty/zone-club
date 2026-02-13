#!/bin/sh
set -e

echo "[zone-club] Installing dependencies..."
npm install --prefer-offline 2>&1 | tail -1

echo "[zone-club] Building..."
npm run build 2>&1 | tail -3

# Standalone needs static assets and public folder
echo "[zone-club] Linking static assets..."
ln -sfn /app/public /app/.next/standalone/public
ln -sfn /app/.next/static /app/.next/standalone/.next/static

echo "[zone-club] Starting server..."
cd /app/.next/standalone
exec node server.js
