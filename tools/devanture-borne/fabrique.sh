#!/bin/sh
# Fabrique les images de la devanture mobile (la borne à côté de la porte).
# Usage : sh tools/devanture-borne/fabrique.sh [échantillons borne] [échantillons mur]
# Tout l'intermédiaire va dans travail/ (ignoré par git). S'arrête à la première erreur.
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

echo "1/6 fond (mur, toit, ciel autour de la photo)"
python3 "$ICI/fond.py" > "$T/fond.log"
echo "2/6 textures (usure, autocollants, tranches tirées de TMDB)"
python3 "$ICI/textures.py" | tail -2
echo "3/6 parcours des tubes du néon"
python3 "$ICI/neon.py" | tail -1
echo "4/6 rendu de la borne ($ECH_BORNE échantillons ; le premier rendu d'une session compile ~3 min)"
rendu rendu-borne.log "$ECH_BORNE" "$T/borne.png"
echo "5/6 passe « mur » ($ECH_MUR échantillons)"
rendu rendu-mur.log "$ECH_MUR" "$T/mur-passe.exr" mur
echo "6/6 composition (lumière du mur, halo du néon, pluie)"
python3 "$ICI/compo.py" "$T/borne.png" "$T/compo.png" | tail -1
echo "→ $T/compo.png"
