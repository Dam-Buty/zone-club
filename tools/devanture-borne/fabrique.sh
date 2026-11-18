#!/bin/sh
# Fabrique les images de la devanture mobile (la borne à côté de la porte).
# Usage : sh tools/devanture-borne/fabrique.sh [échantillons borne] [échantillons mur]
# Écrit public/storefront-mobile.{webp,jpeg}, public/storefront-borne-zoom.webp et src/data/storefront-mobile.json.
# Tout l'intermédiaire va dans travail/ (ignoré par git). S'arrête à la première erreur : aucune étape n'est
# suivie d'un tube (sous « set -e », « python3 … | tail » rendrait le code de sortie de tail, et un échec passerait).
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
T="$ICI/travail"
BLENDER="${BLENDER:-/Applications/Blender 5.3.app/Contents/MacOS/Blender}"
ECH_BORNE="${1:-256}"
ECH_MUR="${2:-384}"
mkdir -p "$T"
[ -x "$BLENDER" ] || { echo "Blender introuvable : $BLENDER (variable BLENDER pour un autre chemin)"; exit 1; }

rendu() {   # rendu <journal> <arguments de borne.py…> : Blender en tâche de fond, échec si le script lève une erreur
    journal="$1"; shift
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$ICI/borne.py" -- "$@" > "$T/$journal" 2>&1 \
        || { echo "échec du rendu, fin de $T/$journal :"; tail -12 "$T/$journal"; exit 1; }
}

echo "1/8 fond (mur, toit, ciel autour de la photo)"
python3 "$ICI/fond.py" > "$T/fond.log"
echo "2/8 textures (usure, autocollants, tranches tirées de TMDB)"
python3 "$ICI/textures.py" > "$T/textures.log"
tail -2 "$T/textures.log"
echo "3/8 parcours des tubes du néon"
python3 "$ICI/neon.py" > "$T/neon.log"
tail -1 "$T/neon.log"
echo "4/8 rendu de la borne ($ECH_BORNE échantillons ; le premier rendu d'une session compile ~3 min)"
rendu rendu-borne.log "$ECH_BORNE" "$T/borne.png"
echo "5/8 passe « mur » ($ECH_MUR échantillons)"
rendu rendu-mur.log "$ECH_MUR" "$T/mur-passe.exr" mur
echo "6/8 composition (lumière du mur, halo du néon, pluie)"
python3 "$ICI/compo.py" "$T/borne.png" "$T/compo.png" > "$T/compo.log"
tail -1 "$T/compo.log"
echo "7/8 vue rapprochée de l'écran, pour le zoom ($ECH_BORNE échantillons)"
rendu rendu-zoom.log "$ECH_BORNE" "$T/zoom.png" zoom
echo "8/8 sorties pour le site (public/ et src/data/)"
python3 "$ICI/sorties.py"
