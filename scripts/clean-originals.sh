#!/run/current-system/sw/bin/bash
#
# Supprime les fichiers vidéo originaux dans /data/big-boi/zone-club
# en préservant les versions transcodées (.web.mp4).
#
# Usage:
#   ./scripts/clean-originals.sh                    # dry-run local
#   ./scripts/clean-originals.sh --delete            # supprime en local
#   ./scripts/clean-originals.sh --backup            # dry-run local + backup
#   ./scripts/clean-originals.sh --delete --backup   # supprime en local + backup

LOCAL_BASE="/data/big-boi/zone-club"
BACKUP_DIRS=( "/mnt/backup/zone-club-vo" "/mnt/backup/zone-club-vf" )
DELETE=false
BACKUP=false

for arg in "$@"; do
  case "$arg" in
    --delete) DELETE=true ;;
    --backup) BACKUP=true ;;
    *) echo "Option inconnue: $arg"; exit 1 ;;
  esac
done

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

# Scan et nettoyage d'un répertoire
# Usage: clean_dir <path> <label>
clean_dir() {
  local base="$1"
  local label="$2"

  if [[ ! -d "$base" ]]; then
    echo "=== $label ==="
    echo "  Répertoire $base non accessible (non monté ?)"
    echo ""
    return
  fi

  local files=()
  while IFS= read -r f; do
    [[ "$f" == *.web.mp4 ]] && continue
    files+=("$f")
  done < <(find "$base" -type f \( "${FIND_ARGS[@]}" \) 2>/dev/null | sort)

  echo "=== $label ==="

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "  Rien à nettoyer."
    echo ""
    return
  fi

  local total_size=0
  for f in "${files[@]}"; do
    local size
    size=$(stat -c%s "$f" 2>/dev/null || echo 0)
    total_size=$((total_size + size))
    printf "  %-80s %s\n" "${f#$base/}" "$(human_size $size)"
  done

  echo ""
  echo "  ${#files[@]} fichiers — $(human_size $total_size) à libérer"
  echo ""

  if [[ "$DELETE" == true ]]; then
    for f in "${files[@]}"; do
      rm "$f"
    done
    echo "  Supprimé ${#files[@]} fichiers ($(human_size $total_size) libérés)."
  fi
}

# Nettoyage local
clean_dir "$LOCAL_BASE" "Local ($LOCAL_BASE)"

# Nettoyage backup
if [[ "$BACKUP" == true ]]; then
  for dir in "${BACKUP_DIRS[@]}"; do
    clean_dir "$dir" "Backup ($dir)"
  done
fi

if [[ "$DELETE" != true ]]; then
  echo "Dry-run. Relancer avec --delete pour supprimer."
fi
