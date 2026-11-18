#!/bin/sh
# Fabrique les images des devantures (la borne à côté de la porte), une variante après l'autre : « mobile »
# (geometrie.json, travail/) et toute variante qui a sa géométrie geometrie-<nom>.json (travail-<nom>/).
# Usage : [DEVANTURES="mobile bureau"] sh tools/devanture-borne/fabrique.sh [échantillons borne] [échantillons mur]
# Écrit dans public/ et src/data/ à la dernière étape de chaque variante (sorties.py). Tout l'intermédiaire reste dans
# le dossier de la variante (ignoré par git). S'arrête à la première erreur : aucune étape n'est suivie d'un tube
# (sous « set -e », « python3 … | tail » rendrait le code de sortie de tail, et un échec passerait).
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
BLENDER="${BLENDER:-/Applications/Blender 5.3.app/Contents/MacOS/Blender}"
ECH_BORNE="${1:-256}"
ECH_MUR="${2:-384}"
[ -x "$BLENDER" ] || { echo "Blender introuvable : $BLENDER (variable BLENDER pour un autre chemin)"; exit 1; }
if [ -z "$DEVANTURES" ]; then
    DEVANTURES="mobile"
    for g in "$ICI"/geometrie-*.json; do
        [ -e "$g" ] || continue
        n=${g##*/geometrie-}
        DEVANTURES="$DEVANTURES ${n%.json}"
    done
fi

rendu() {   # rendu <journal> <arguments de borne.py…> : Blender en tâche de fond, échec si le script lève une erreur
    journal="$1"; shift
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$ICI/borne.py" -- "$@" > "$T/$journal" 2>&1 \
        || { echo "échec du rendu, fin de $T/$journal :"; tail -12 "$T/$journal"; exit 1; }
}

rendu_approche() {   # rendu_approche <borne|mur> : chaque image du film d'approche, pour cette passe
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$ICI/approche_rendu.py" -- "$1" > "$T/approche-rendu-$1.log" 2>&1 \
        || { echo "échec du rendu du film, fin de $T/approche-rendu-$1.log :"; tail -12 "$T/approche-rendu-$1.log"; exit 1; }
}

a() {       # a <clé> : vrai si la géométrie de la variante porte cette clé
    python3 "$ICI/variante.py" "$1" > /dev/null 2>&1
}

for V in $DEVANTURES; do
    export DEVANTURE="$V"
    T=$(python3 "$ICI/variante.py" --dossier)
    FOND=$(python3 "$ICI/variante.py" fond)
    echo "===== devanture « $V » ($T)"
    echo "fond (le mur autour de la photo)"
    python3 "$ICI/$FOND" > "$T/fond.log"
    echo "textures (usure, autocollants, tranches tirées de TMDB)"
    python3 "$ICI/textures.py" > "$T/textures.log"
    tail -2 "$T/textures.log"
    echo "parcours des tubes du néon"
    python3 "$ICI/neon.py" > "$T/neon.log"
    tail -1 "$T/neon.log"
    echo "rendu de la borne ($ECH_BORNE échantillons ; le premier rendu d'une session compile ~3 min)"
    rendu rendu-borne.log "$ECH_BORNE" "$T/borne.png"
    echo "passe « mur » ($ECH_MUR échantillons)"
    rendu rendu-mur.log "$ECH_MUR" "$T/mur-passe.exr" mur
    echo "composition (lumière du mur, halo du néon, pluie)"
    python3 "$ICI/compo.py" "$T/borne.png" "$T/compo.png" > "$T/compo.log"
    tail -1 "$T/compo.log"
    if a masque; then
        echo "masque de reflets (la borne en aplats, sur le masque de la photo)"
        rendu rendu-masque.log 16 "$T/borne-masque.png" masque
        python3 "$ICI/masque.py" > "$T/masque.log"
        tail -1 "$T/masque.log"
    fi
    if a approche; then
        command -v ffmpeg > /dev/null || { echo "ffmpeg introuvable : il encode le film d'approche (brew install ffmpeg)"; exit 1; }
        echo "film d'approche : trajet de l'appareil"
        python3 "$ICI/approche_trajet.py" > "$T/approche-trajet.log"
        tail -1 "$T/approche-trajet.log"
        echo "film d'approche : la borne, image par image (un quart d'heure environ en 1920 × 1020)"
        rendu_approche borne
        echo "film d'approche : la lumière du mur, image par image"
        rendu_approche mur
        echo "film d'approche : assemblage (mur recalé, borne, halo, flou de bougé, pluie)"
        python3 "$ICI/approche_compo.py" > "$T/approche-compo.log"
        tail -1 "$T/approche-compo.log"
        echo "film d'approche : encodage"
        IPS=$(python3 "$ICI/variante.py" approche.ips)
        CRF=$(python3 "$ICI/variante.py" approche.film.crf)
        ffmpeg -y -loglevel error -framerate "$IPS" -i "$T/approche/film_%04d.png" \
            -vf "scale=out_color_matrix=bt709:out_range=tv" -c:v libx264 -preset slow -crf "$CRF" -pix_fmt yuv420p \
            -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -an -movflags +faststart "$T/approche/film.mp4"
    fi
    echo "sorties pour le site (public/ et src/data/)"
    python3 "$ICI/sorties.py"
done
