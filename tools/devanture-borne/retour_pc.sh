#!/bin/sh
# Le film de retour de la K7 sur PC, de bout en bout (environ 1 h sur le Mac mini, carte graphique).
#   sh tools/devanture-borne/retour_pc.sh            tout : film, relevé, passes, planches, sorties du site
#   sh tools/devanture-borne/retour_pc.sh 0,44,76    seulement ces images du film, assemblées (images clés à montrer
#                                                    AVANT le rendu complet) — rien n'est écrit dans public/
# Il faut : la borne du PC fabriquée (fabrique.sh, variante bureau : fond, repère, textures, film d'approche), le film de
# location du PC (son décor, travail-bureau/distribution/pc/decor_0000.png, sert de référence au raccord), les planches
# du film de location du téléphone (la lumière des tranches) et la bande-son (sons/mixe-retour.sh).
set -e
cd "$(dirname "$0")"
B=${BLENDER:-/Applications/Blender 5.3.app/Contents/MacOS/Blender}
R=travail-bureau/retour
T=$R/pc
CHOIX=$1
etape() { echo "$(date +%H:%M:%S) $1"; }

etape "trajet de l'appareil"
DEVANTURE=bureau python3 retour_pc_trajet.py
# L'afficheur « K7 REÇUE » : fait par textures.py pour chaque variante, le même pour toutes.
[ -f travail-bureau/tex/afficheur-recue.png ] || cp travail/tex/afficheur-recue.png travail-bureau/tex/
etape "la borne et la main (128 échantillons)"
TRAJET=$PWD/$T/trajet.json "$B" -b main/retour-anim-pc.blend --python-exit-code 1 -P retour_rendu.py -- 128 100 $T $CHOIX > $T/borne.log 2>&1
etape "la lumière du mur"
DEVANTURE=bureau ANIM=retour/pc "$B" -b --factory-startup --python-exit-code 1 -P approche_rendu.py -- mur $CHOIX > $T/mur.log 2>&1
etape "assemblage avec la photo, flou de l'appareil, pluie"
# BOUGE_TOUJOURS : toutes les images par le chemin qu'a pris le décor de la page (voir approche_compo.py).
DEVANTURE=bureau ANIM=retour/pc BOUGE_TOUJOURS=1 python3 approche_compo.py $CHOIX | tail -1
rm -f $T/mur_*.npy $T/tmp-mur.exr
if [ -n "$CHOIX" ]; then etape "images choisies : $T/film_NNNN.png"; exit 0; fi

etape "relevé de la tranche et de l'écran"
TRAJET=$PWD/$T/trajet.json SUIVI=1 "$B" -b main/retour-anim-pc.blend --python-exit-code 1 -P retour_rendu.py -- 16 100 $R > $R/suivi.log 2>&1
etape "passes de la K7 (cache, lumière)"
TRAJET=$PWD/$T/trajet.json PASSES=1 "$B" -b main/retour-anim-pc.blend --python-exit-code 1 -P retour_rendu.py -- 96 100 $R > $R/passes.log 2>&1
etape "planches"
DEVANTURE=bureau FILM=retour ARRET=77,84 LUMIERE_DE=$PWD/travail/distribution/site/suivi.json python3 distribution_planches.py | tail -1
etape "sorties du site"
DEVANTURE=bureau python3 retour_pc_sorties.py
etape "FINI"
