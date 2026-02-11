#!/usr/bin/env bash
#
# Convert PBR textures (JPEG) to KTX2 with UASTC compression.
# Requires: ktx-software (https://github.com/KhronosGroup/KTX-Software/releases)
#
# UASTC level 4: highest quality (near-lossless)
# Zstandard supercompression level 5: good compression for network transfer
# NO resize: preserves original resolution exactly
#
# Usage: ./scripts/convert-textures-ktx2.sh

set -euo pipefail

TEXTURES_DIR="public/textures"
DIRS=("floor" "wall" "wood" "storefront" "fabric")

# Check toktx is available
if ! command -v toktx &>/dev/null; then
  echo "ERROR: toktx not found."
  echo "Install from: https://github.com/KhronosGroup/KTX-Software/releases"
  exit 1
fi

for dir in "${DIRS[@]}"; do
  echo "=== Converting $dir ==="
  for file in "$TEXTURES_DIR/$dir"/*.jpg; do
    [ -f "$file" ] || continue

    base=$(basename "$file" .jpg)
    out="$TEXTURES_DIR/$dir/$base.ktx2"

    # Always regenerate (remove stale files from previous runs)
    [ -f "$out" ] && rm "$out"

    # Determine color space: color map = sRGB, everything else = linear
    oetf_flag="--assign_oetf linear"
    if [ "$base" = "color" ]; then
      oetf_flag="--assign_oetf srgb"
    fi

    echo "  $base.jpg -> $base.ktx2"
    toktx --t2 --encode uastc --uastc_quality 4 --zcmp 5 \
      --genmipmap \
      $oetf_flag \
      "$out" "$file"
  done
done

echo ""
echo "Done. KTX2 files created alongside original JPEGs."
