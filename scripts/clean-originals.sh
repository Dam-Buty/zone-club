#!/run/current-system/sw/bin/bash
#
# Supprime les fichiers vidéo originaux dans /data/big-boi/zone-club
# en préservant les versions transcodées (.web.mp4).
#
# Usage:
#   ./scripts/clean-originals.sh          # dry-run (affiche ce qui serait supprimé)
#   ./scripts/clean-originals.sh --delete  # supprime pour de vrai

BASE="/data/big-boi/zone-club"
DELETE=false

if [[ "$1" == "--delete" ]]; then
  DELETE=true
fi

# Extensions vidéo à cibler
VIDEO_EXTS=( "mkv" "avi" "mov" "wmv" "flv" "ts" "m4v" "mp4" )

# Construire les arguments find : toutes les extensions sauf .web.mp4
FIND_ARGS=()
first=true
for ext in "${VIDEO_EXTS[@]}"; do
  if [[ "$first" == true ]]; then
    first=false
  else
    FIND_ARGS+=( "-o" )
  fi
  FIND_ARGS+=( "-name" "*.${ext}" )
done

# Trouver les fichiers vidéo, exclure .web.mp4
files=()
while IFS= read -r f; do
  [[ "$f" == *.web.mp4 ]] && continue
  files+=("$f")
done < <(find "$BASE" -type f \( "${FIND_ARGS[@]}" \) 2>/dev/null | sort)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Rien à nettoyer."
  exit 0
fi

# Calculer la taille totale
total_size=0
for f in "${files[@]}"; do
  size=$(stat -c%s "$f" 2>/dev/null || echo 0)
  total_size=$((total_size + size))
done

human_size() {
  local bytes=$1
  if (( bytes >= 1073741824 )); then
    printf "%.1f GB" "$(echo "scale=1; $bytes / 1073741824" | bc)"
  elif (( bytes >= 1048576 )); then
    printf "%.1f MB" "$(echo "scale=1; $bytes / 1048576" | bc)"
  else
    printf "%d KB" "$((bytes / 1024))"
  fi
}

for f in "${files[@]}"; do
  size=$(stat -c%s "$f" 2>/dev/null || echo 0)
  printf "  %-80s %s\n" "${f#$BASE/}" "$(human_size $size)"
done

echo ""
echo "${#files[@]} fichiers — $(human_size $total_size) à libérer"
echo ""

if [[ "$DELETE" == true ]]; then
  for f in "${files[@]}"; do
    rm "$f"
  done
  echo "Supprimé ${#files[@]} fichiers ($(human_size $total_size) libérés)."
else
  echo "Dry-run. Relancer avec --delete pour supprimer."
fi
