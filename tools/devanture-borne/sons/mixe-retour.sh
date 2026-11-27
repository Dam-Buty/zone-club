#!/bin/sh
# Bande-son du film de RETOUR de la K7 (spec 2026-11-26-borne-retour-k7-design.md § 5.1), calée sur l'animation de
# main/retour-anim.blend (143 images à 24 im/s = 5,96 s) : le clapet se relève (0,9 → 1,25 s), la main engage la K7
# dans la fente (2,6 → 3,2 s, frottement), l'afficheur écrit « K7 REÇUE » (3,45 s, bip), les rouleaux l'avalent
# (3,5 → 3,8 s, moteur bref), le clapet retombe (3,95 → 4,2 s, « clac »).
# Mêmes prises, même ambiance et même filtre « derrière une vitre et une tôle » que le film de location (mixe.sh) ; le
# bip, électronique, est synthétisé (deux sinus brefs). Le « clac » : l'impact de pose-1 est à 0,5 s de la prise,
# placé à 4,18 s, quand le clapet touche. À lancer depuis le dossier des prises : sh ../../sons/mixe-retour.sh
set -e
p() { echo "[$1:a]atrim=$2:$3,asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=$(python3 -c "print(max(0,$3-$2-0.1))"):d=0.1,volume=$5dB,adelay=$4:all=1[$6];"; }
D=5.96
ffmpeg -v error -y -i ambiance-0.wav -i volet-1.wav -i extraction-1.wav -i ejection-0.wav -i pose-1.wav \
  -f lavfi -i "sine=frequency=2400:duration=0.09:sample_rate=48000" -f lavfi -i "sine=frequency=3200:duration=0.07:sample_rate=48000" \
  -filter_complex "
[0:a]aloop=loop=1:size=240000,atrim=0:$D,volume=-22dB,afade=t=in:d=0.4,afade=t=out:st=$(python3 -c "print($D-0.6)"):d=0.6[amb];
$(p 1 0.2 0.75 880 -12 ouvre)
$(p 2 0.15 0.7 2600 -4 frotte)
[5:a]afade=t=in:d=0.005,afade=t=out:st=0.07:d=0.02,volume=-22dB,adelay=3450:all=1,aformat=channel_layouts=stereo[bipA];
[6:a]afade=t=in:d=0.005,afade=t=out:st=0.05:d=0.02,volume=-22dB,adelay=3560:all=1,aformat=channel_layouts=stereo[bipB];
$(p 3 0.6 1.0 3480 -10 rouleaux)
$(p 3 1.1 1.4 3760 -13 fin_rouleaux)
$(p 4 0.40 0.95 4080 -4 clac)
[amb][ouvre][frotte][bipA][bipB][rouleaux][fin_rouleaux][clac]amix=inputs=8:normalize=0:duration=longest,highpass=f=70,lowpass=f=7000,apad=whole_dur=$D,atrim=0:$D[m]" \
  -map "[m]" -ar 48000 -ac 2 bande-son-retour.wav
