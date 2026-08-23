# Debian 13 (trixie) pour ffmpeg 7.1 : le 5.1 de Debian 12 traite les sorties
# multiples EN SÉRIE — un mux à deux sorties y coûte exactement le double d'une
# seule (mesuré 10,37 s contre 5,42 s sur un segment de test), alors qu'à partir
# de la 6/7 les deux encodages AAC tournent en parallèle (5,78 s en 8.0).
FROM node:22-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
