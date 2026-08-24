# Debian 13 (trixie) pour ffmpeg 7.1 : le 5.1 de Debian 12 traite les sorties
# multiples EN SÉRIE — un mux à deux sorties y coûte exactement le double d'une
# seule (mesuré 10,37 s contre 5,42 s sur un segment de test), alors qu'à partir
# de la 6/7 les deux encodages AAC tournent en parallèle (5,78 s en 8.0).
FROM node:22-trixie-slim

# tesseract + pgsrip : OCR des sous-titres PGS (bitmaps des BluRay). Sans eux, les
# releases dont les sous-titres français ne sont QUE des images étaient refusées au
# contrôle qualité alors qu'elles en portaient — cas majoritaire sur le catalogue
# ancien (Saving Private Ryan, Die Hard 2, Naked Gun).
#
# libgl1 et libglib2.0-0 ne sont pas superflus : pgsrip dépend d'opencv, qui
# échoue à l'import (`import cv2`) dans une image slim sans ces deux bibliothèques.
# mkvtoolnix fournit mkvextract, utilisé par pgsrip.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    openssh-client \
    tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng \
    mkvtoolnix \
    python3 python3-pip \
    libgl1 libglib2.0-0 \
    && pip install --break-system-packages --no-cache-dir pgsrip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
