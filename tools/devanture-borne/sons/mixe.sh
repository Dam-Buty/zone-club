#!/bin/sh
# Bande-son du film de distribution (n° 3, validée « globalement » par Rusmir le 22/11/2026), recalée sur la
# chronologie à arrêt allongé de distribution_film.py (mêmes prises, retards resserrés du même facteur).
# À lancer depuis le dossier des prises : sh ../../sons/mixe.sh   (prises .wav fabriquées avec Woosh, hors dépôt)
# Bande-son d'essai n° 2 (Rusmir, 22/11 : « un peu trop grossiers et un peu trop forts ») : prises plus fines, niveaux
# bas, attaques adoucies, et un filtre qui étouffe les aigus comme derrière une vitre et une tôle.
# p <entrée> <début> <fin> <retard ms> <gain dB> <nom> : découpe, fondus, retard.
set -e
p() { echo "[$1:a]atrim=$2:$3,asetpts=PTS-STARTPTS,afade=t=in:d=0.08,afade=t=out:st=$(python3 -c "print(max(0,$3-$2-0.12))"):d=0.12,volume=$5dB,adelay=$4:all=1[$6];"; }
ffmpeg -v error -y -i ambiance-0.wav -i chariot-1.wav -i accroc-2.wav -i pince-1.wav -i extraction-2.wav -i pose-0.wav -i descente-2.wav -i ejection-0.wav -i tiroir-1.wav -i volet-1.wav -filter_complex "
[0:a]aloop=loop=1:size=240000,atrim=0:8.05,volume=-22dB,afade=t=in:d=0.6,afade=t=out:st=7.3:d=0.7[amb];
$(p 1 1.0 1.9 500 0 allerA)
$(p 2 2.6 3.0 1238 14 accroc)
$(p 1 2.0 2.5 1515 0 allerB)
$(p 3 0.35 0.75 2372 -10 pince)
$(p 1 2.6 3.1 1976 -6 avance)
$(p 4 0.0 0.6 2760 -3 extraction)
$(p 8 0.2 1.0 2714 6 tiroir)
$(p 9 0.2 0.75 4632 -12 volet)
$(p 5 0.0 0.4 3249 -8 pose)
$(p 6 0.0 0.9 3406 -16 descente)
$(p 1 3.2 3.9 4171 -3 glisse)
$(p 7 0.6 1.0 4881 -10 sortieA)
$(p 7 0.05 0.35 5204 -9 butee)
$(p 7 1.1 1.6 5435 -10 sortieB)
$(p 1 3.4 4.8 4835 -5 retour)
[amb][allerA][accroc][allerB][pince][avance][extraction][tiroir][volet][pose][descente][glisse][sortieA][butee][sortieB][retour]amix=inputs=16:normalize=0:duration=longest,highpass=f=70,lowpass=f=7000,apad=whole_dur=8.05,atrim=0:8.05[m]" -map "[m]" -ar 48000 -ac 2 bande-son-film.wav
