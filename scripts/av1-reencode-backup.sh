#!/usr/bin/env bash
#
# av1-reencode-backup.sh — Réencodage AV1 in situ de /mnt/backup/zone-club.
#
# Dérivé de reencode-spark.sh, mais la mécanique est simplifiée sur deux points :
#
#   1. Cette machine (poweredge) a ffmpeg/ffprobe en local, donc la sonde se fait
#      localement — plus besoin du déversement sur le Spark pour analyser.
#   2. La destination est la SOURCE : on transcode « en place ». Le MKV est lu
#      depuis /mnt/backup (montage sshfs vers la Storage Box Hetzner), envoyé au
#      Spark par un tube SSH, renvoyé ici, écrit dans le même dossier, puis
#      l'original est supprimé.
#
#   cat original.mkv                                      (lecture sshfs)
#     │ tube
#     ▼
#   ssh spark → ffmpeg (nvdec → av1_nvenc → fichier temporaire sur son NVMe)
#     │ puis cat du résultat
#     ▼
#   <dossier>/original.mkv.av1part → vérification → remplace l'original
#
# Profil de sortie : même résolution, vidéo AV1 (av1_nvenc, SDR BT.709), audio
# AAC stéréo 160k (TOUTES les pistes, chacune downmixée en 2 canaux), sous-titres
# copiés à l'identique, conteneur matroska.
#
# Le Spark écrit d'abord sur son disque au lieu de streamer dans le tube : un
# matroska écrit vers un tube ne porte pas de durée dans son en-tête, et les
# lecteurs cassent la barre de seek. Le passage par un fichier temporaire donne
# une durée juste.
#
# Usage: ./av1-reencode-backup.sh [options]
#
#   --root DIR     Racine de la collection (défaut /mnt/backup/zone-club)
#   --jobs N       Encodages parallèles (défaut 2 — le goulot est le réseau, pas le GPU)
#   --cq N         Qualité AV1, 0-51, plus bas = meilleur (défaut 34)
#   --preset P     Preset av1_nvenc, p1-p7 (défaut p5)
#   --limit N      Traiter au plus N fichiers (test), 0 = tous
#   --dry-run      Inventaire + estimation, sans rien encoder ni supprimer
#
# Variables d'environnement : SPARK_HOST, AV1_CQ, AV1_PRESET, PARALLEL,
#                             AUDIO_BITRATE, LOG_FILE.
#
# Journal : une ligne par film — <date> <statut> <titre> <taille_initiale>
#           <taille_finale> <delta%>. Les tailles sont en octets.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SPARK_HOST="${SPARK_HOST:-spark}"

# Le PowerEdge a l'accélération AES matérielle : on garde le chiffrement par
# défaut de ~/.ssh/config (aes128-gcm). Compression coupée : de la vidéo déjà
# compressée ne se compresse pas.
SSH_OPTS_STR="-T -o BatchMode=yes -o Compression=no -o ServerAliveInterval=30 -o ServerAliveCountMax=6"

# La sortie est TOUJOURS du SDR BT.709 et doit le déclarer. Sans ça ffmpeg recopie
# les tags de la source : un HEVC HDR se retrouverait annoncé HDR10 alors qu'il
# n'en est plus, et une TV HDR basculerait à tort.
SDR_TAGS="-colorspace bt709 -color_primaries bt709 -color_trc bt709"

# Seul le chemin de tonemapping HDR est plafonné : une source 4K téléversée
# entière dans libplacebo épuise la mémoire unifiée du GB10 (partagée avec vLLM)
# et meurt sur « VK_ERROR_DEVICE_LOST ». La résolution n'est donc réduite QUE pour
# les fichiers HDR > 1080p ; tout le reste garde sa résolution d'origine.
MAX_H="${MAX_H:-1080}"
MAX_W="${MAX_W:-1920}"

CQ="${AV1_CQ:-34}"
PRESET="${AV1_PRESET:-p5}"
AUDIO_BITRATE="${AUDIO_BITRATE:-160k}"

# --- Options ---

ROOT="/mnt/backup/zone-club"
PARALLEL="${PARALLEL:-2}"
LIMIT=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --root)   ROOT="$2"; shift 2 ;;
        --jobs)   PARALLEL="$2"; shift 2 ;;
        --cq)     CQ="$2"; shift 2 ;;
        --preset) PRESET="$2"; shift 2 ;;
        --limit)  LIMIT="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        *) echo "Option inconnue: $1" >&2; exit 2 ;;
    esac
done

[[ -d "$ROOT" ]] || { echo "Erreur: racine inexistante: $ROOT" >&2; exit 1; }
ROOT="$(cd "$ROOT" && pwd)"
LOG_FILE="${LOG_FILE:-$ROOT/av1-reencode.log}"

human() {  # octets → « 3.1G »
    local b="$1"
    [[ "$b" =~ ^[0-9]+$ ]] || { echo "-"; return; }
    awk -v b="$b" 'BEGIN {
        if (b >= 1099511627776) printf "%.1fT", b/1099511627776;
        else if (b >= 1073741824) printf "%.1fG", b/1073741824;
        else if (b >= 1048576) printf "%.1fM", b/1048576;
        else printf "%dK", b/1024;
    }'
}

# --- Sonde locale ---

# Renvoie un JSON compact via ffprobe local (présent sur cette machine).
probe_local() {
    ffprobe -v error -print_format json \
        -show_entries format=duration,size \
        -show_entries stream=index,codec_type,codec_name,width,height,pix_fmt,color_transfer \
        "$1" 2>/dev/null
}

# NVDEC ne décode le H.264 QU'EN 8 BITS : le profil High 10 n'est pas géré. Le
# décodeur refuse la trame et toute la chaîne tombe sur AVERROR(ENOSYS). Pour ces
# sources (une seule dans le catalogue : Saving Private Ryan) on décode sur le CPU
# du Spark et on garde NVENC pour l'encodage.
needs_software_decode() {  # $1 codec, $2 pix_fmt
    [[ "$1" == "h264" && -n "$2" && "$2" != "yuv420p" ]]
}

# --- Construction de la partie vidéo de la commande ffmpeg distante ---
#
# Renvoie le fragment à insérer avant `-i pipe:0` : accélération matérielle,
# éventuellement la chaîne de filtres. L'encodeur (av1_nvenc) est ajouté ensuite
# par l'appelant, comme dans reencode-spark.sh.

build_video_args() {
    # $1 codec  $2 pix_fmt  $3 width  $4 height  $5 color_transfer
    local codec="$1" pixfmt="$2" width="$3" height="$4" transfer="$5"

    local hdr=0
    [[ "$transfer" == "smpte2084" || "$transfer" == "arib-std-b67" ]] && hdr=1

    local swdec=0
    needs_software_decode "$codec" "$pixfmt" && swdec=1

    # Downscale uniquement pour le tonemapping HDR hors cadre 1080p.
    local downscale=0
    if [[ $hdr -eq 1 ]]; then
        [[ "$height" =~ ^[0-9]+$ && "$height" -gt "$MAX_H" ]] && downscale=1
        [[ "$width"  =~ ^[0-9]+$ && "$width"  -gt "$MAX_W" ]] && downscale=1
    fi
    local box="w=${MAX_W}:h=${MAX_H}:force_original_aspect_ratio=decrease:force_divisible_by=2"

    if [[ $hdr -eq 1 ]]; then
        # Chaîne HDR → SDR. `tonemap_cuda` n'existe pas dans le ffmpeg du Spark et
        # l'interop CUDA→Vulkan y répond « Function not implemented » : les trames
        # passent par la mémoire système entre décodeur et libplacebo.
        # `format=p010le` est obligatoire pour préserver les 10 bits jusqu'au
        # tonemapper. Le redimensionnement se fait AVANT le téléversement Vulkan
        # (voir MAX_H/MAX_W plus haut).
        local chain=""
        if [[ $downscale -eq 1 ]]; then
            if [[ $swdec -eq 1 ]]; then chain="scale=${box},"; else chain="scale_cuda=${box},"; fi
        fi
        if [[ $swdec -eq 1 ]]; then
            chain="${chain}format=p010le,"
        else
            chain="${chain}hwdownload,format=p010le,"
        fi
        chain="${chain}hwupload,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwdownload,format=yuv420p"
        local vf="-init_hw_device vulkan=vk -filter_hw_device vk"
        if [[ $swdec -eq 1 ]]; then
            echo "${vf} @INPUT@ -vf ${chain}"
        else
            echo "${vf} -hwaccel cuda -hwaccel_output_format cuda @INPUT@ -vf ${chain}"
        fi
        return
    fi

    if [[ $swdec -eq 1 ]]; then
        # Décodage CPU (H.264 10 bits), conversion 8 bits logicielle, encodage NVENC.
        echo "@INPUT@ -vf format=yuv420p"
        return
    fi

    # `format=yuv420p` est OBLIGATOIRE : av1_nvenc n'encode qu'en 8 bits ici, et une
    # source 10 bits (HEVC Main10, AV1 10 bits) sort du décodeur en p010, refusé par
    # l'encodeur. La conversion se fait sur le GPU. Même résolution : on ne touche
    # pas aux dimensions.
    echo "-hwaccel cuda -hwaccel_output_format cuda @INPUT@ -vf scale_cuda=format=yuv420p"
}

# --- État partagé entre workers et dashboard ---
#
# STATE_DIR est initialisé dans le flux principal (avant le lancement) ; ces deux
# fonctions ne font que lire/écrire dedans, depuis n'importe quel worker.

increment() {
    local counter_file="$STATE_DIR/$1"
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do :; done
    local val
    val=$(cat "$counter_file")
    echo $((val + 1)) > "$counter_file"
    rmdir "$LOCK_DIR"
}

log_activity() {
    echo "$1" > "$STATE_DIR/log/$(date +%s%N)"
}

# --- Worker : un fichier, de bout en bout ---

encode_one() {
    local file="$1"
    local dir; dir=$(dirname "$file")
    # Identifiant de journal : le titre du film (nom du dossier), pas « original.mkv »
    # qui est identique pour tous les films.
    local title; title=$(basename "$dir")

    echo "${title}|||||" > "$STATE_DIR/active/$$"

    local probe
    probe=$(probe_local "$file")

    if [[ -z "$probe" ]] || ! echo "$probe" | jq -e '.streams' >/dev/null 2>&1; then
        increment failed
        log_activity "FAIL $title (analyse impossible)"
        printf '%s\tFAIL\t%s\t-\t-\tanalyse impossible\n' "$(date '+%F %T')" "$title" >> "$LOG_FILE"
        rm -f "$STATE_DIR/active/$$"
        return
    fi

    local codec pixfmt width height transfer duration src_size
    codec=$(echo "$probe"    | jq -r '[.streams[]|select(.codec_type=="video")][0].codec_name // ""')
    pixfmt=$(echo "$probe"   | jq -r '[.streams[]|select(.codec_type=="video")][0].pix_fmt // ""')
    width=$(echo "$probe"    | jq -r '[.streams[]|select(.codec_type=="video")][0].width // ""')
    height=$(echo "$probe"   | jq -r '[.streams[]|select(.codec_type=="video")][0].height // ""')
    transfer=$(echo "$probe" | jq -r '[.streams[]|select(.codec_type=="video")][0].color_transfer // ""')
    duration=$(echo "$probe" | jq -r '.format.duration // "0"')
    src_size=$(echo "$probe" | jq -r '.format.size // "0"')
    duration="${duration%.*}"
    [[ "$duration" =~ ^[0-9]+$ ]] || duration=0
    [[ "$src_size" =~ ^[0-9]+$ ]] || src_size=0

    echo "${title}|${codec}|${height}|${duration}|" > "$STATE_DIR/active/$$"

    # Déjà en AV1 : rien à gagner, et on perdrait une génération de qualité.
    if [[ "$codec" == "av1" ]]; then
        increment skipped
        log_activity "SKIP $title (déjà en AV1)"
        printf '%s\tSKIP\t%s\t%s\t%s\tdéjà en AV1\n' \
            "$(date '+%F %T')" "$title" "$src_size" "$src_size" >> "$LOG_FILE"
        rm -f "$STATE_DIR/active/$$"
        return
    fi

    # Débit global de la source, pour plafonner la sortie (jamais plus grosse que
    # l'original).
    local bitrate=0
    if [[ "$duration" -gt 0 && "$src_size" -gt 0 ]]; then
        bitrate=$(( src_size * 8 / duration ))
    fi

    local ff_args
    ff_args=$(build_video_args "$codec" "$pixfmt" "$width" "$height" "$transfer")
    ff_args="${ff_args/@INPUT@/-i pipe:0 -map 0:v:0 -map 0:a? -map 0:s?}"

    local rate_cap=""
    [[ "$bitrate" -gt 0 ]] && rate_cap="-maxrate $bitrate -bufsize $(( bitrate * 2 ))"

    # -map 0:a? : TOUTES les pistes audio, chacune réencodée en AAC stéréo.
    # -map 0:s? : sous-titres copiés à l'identique (matroska accepte tous formats).
    local remote_cmd="t=\$(mktemp /tmp/av1enc.XXXXXX); \
ffmpeg -hide_banner -nostdin -nostats -loglevel error -progress pipe:2 \
${ff_args} \
-c:v av1_nvenc -preset ${PRESET} -cq ${CQ} ${rate_cap} ${SDR_TAGS} \
-c:a aac -b:a ${AUDIO_BITRATE} -ac 2 \
-c:s copy -f matroska -y \"\$t\"; \
rc=\$?; if [ \$rc -eq 0 ]; then cat \"\$t\"; rc=\$?; fi; rm -f \"\$t\"; exit \$rc"

    local progress_file="$STATE_DIR/progress/$$"
    : > "$progress_file"
    local tmp_out="$file.av1part"
    rm -f "$tmp_out"

    local rc
    cat "$file" 2>/dev/null \
        | ssh $SSH_OPTS_STR "$SPARK_HOST" "$remote_cmd" \
            > "$tmp_out" 2>"$progress_file"
    rc=$?

    # Durée réellement encodée, lue sur le dernier événement de progression.
    local encoded_us encoded=0
    encoded_us=$(grep '^out_time_us=' "$progress_file" 2>/dev/null | tail -1 | cut -d= -f2)
    [[ "$encoded_us" =~ ^[0-9]+$ ]] && encoded=$(( encoded_us / 1000000 ))

    local too_short=0
    if [[ "$duration" -gt 0 && $(( encoded * 100 / duration )) -lt 90 ]]; then
        too_short=1
    fi

    # Vérification finale sur le fichier renvoyé : la vidéo doit être de l'AV1, et
    # la durée ne doit pas s'écrouler. On ne supprime l'original qu'une fois ces
    # garde-fous passés.
    local out_ok=0 out_codec="" out_dur=0
    if [[ $rc -eq 0 && -s "$tmp_out" && $too_short -eq 0 ]]; then
        local final_probe
        final_probe=$(ffprobe -v error -print_format json \
            -show_entries format=duration \
            -show_entries stream=codec_name -select_streams v:0 "$tmp_out" 2>/dev/null)
        out_codec=$(echo "$final_probe" | jq -r '.streams[0].codec_name // ""' 2>/dev/null)
        out_dur=$(echo "$final_probe" | jq -r '.format.duration // "0"' 2>/dev/null)
        out_dur="${out_dur%.*}"; [[ "$out_dur" =~ ^[0-9]+$ ]] || out_dur=0
        if [[ "$out_codec" == "av1" ]]; then
            if [[ "$duration" -eq 0 || "$out_dur" -eq 0 || $(( out_dur * 100 / duration )) -ge 90 ]]; then
                out_ok=1
            fi
        fi
    fi

    if [[ $out_ok -eq 1 ]]; then
        local out_size
        out_size=$(stat -c %s "$tmp_out" 2>/dev/null || echo 0)

        # Remplacement en place, sans jamais laisser le dossier sans fichier :
        #   1. l'original est écarté sous un nom de secours,
        #   2. le nouveau fichier prend sa place,
        #   3. l'original est supprimé.
        if mv -f "$file" "$file.bak" 2>/dev/null; then
            if mv -f "$tmp_out" "$file" 2>/dev/null; then
                rm -f "$file.bak"
                local delta=""
                if [[ "$src_size" -gt 0 && "$out_size" -gt 0 ]]; then
                    local pct=$(( (out_size - src_size) * 100 / src_size ))
                    [[ $pct -ge 0 ]] && delta="+${pct}%" || delta="${pct}%"
                fi
                increment processed
                log_activity "OK $title ($(human "$src_size")→$(human "$out_size")${delta:+ $delta})"
                printf '%s\tOK\t%s\t%s\t%s\t%s\n' \
                    "$(date '+%F %T')" "$title" "$src_size" "$out_size" "$delta" >> "$LOG_FILE"
            else
                mv -f "$file.bak" "$file" 2>/dev/null
                increment failed
                log_activity "FAIL $title (remplacement impossible)"
                printf '%s\tFAIL\t%s\t%s\t-\tremplacement impossible\n' \
                    "$(date '+%F %T')" "$title" "$src_size" >> "$LOG_FILE"
            fi
        else
            increment failed
            log_activity "FAIL $title (écartement impossible)"
            printf '%s\tFAIL\t%s\t%s\t-\técartement original impossible\n' \
                "$(date '+%F %T')" "$title" "$src_size" >> "$LOG_FILE"
        fi
    else
        {
            echo "=== $(date) ==="
            echo "Fichier: $file"
            echo "Code de sortie: $rc  codec sorti: ${out_codec:-inconnu}  durée sortie: ${out_dur}s"
            [[ $too_short -eq 1 ]] && echo "Encodage tronqué: ${encoded}s encodées pour ${duration}s annoncées"
            echo "Erreur ffmpeg (lignes hors flux -progress):"
            grep -vE '^[A-Za-z0-9_]+=' "$progress_file" 2>/dev/null | tail -8
            echo ""
        } >> "$LOG_FILE"
        increment failed
        log_activity "FAIL $title (code:$rc)"
        printf '%s\tFAIL\t%s\t%s\t-\tcode:%s\n' \
            "$(date '+%F %T')" "$title" "$src_size" "$rc" >> "$LOG_FILE"
        rm -f "$tmp_out"
    fi

    rm -f "$STATE_DIR/active/$$" "$progress_file"
}

export -f encode_one probe_local needs_software_decode build_video_args increment log_activity human
export SSH_OPTS_STR SPARK_HOST CQ PRESET AUDIO_BITRATE SDR_TAGS MAX_H MAX_W LOG_FILE STATE_DIR LOCK_DIR

# --- Vérifications initiales ---

command -v jq >/dev/null 2>&1 || { echo "Erreur: jq est requis." >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "Erreur: ffprobe est requis." >&2; exit 1; }

if ! ssh $SSH_OPTS_STR -o ConnectTimeout=10 "$SPARK_HOST" 'command -v ffmpeg >/dev/null' </dev/null 2>/dev/null; then
    echo "Erreur: pas de ffmpeg joignable sur '$SPARK_HOST' (ssh $SPARK_HOST)." >&2
    exit 1
fi

# Test d'écriture sur la destination (sshfs : un dossier existant peut être lisible
# mais pas inscriptible selon le propriétaire distant).
_wtest="$ROOT/.av1-reencode-wtest.$$"
if ! (echo x > "$_wtest") 2>/dev/null; then
    echo "Erreur: $ROOT n'est pas inscriptible." >&2
    exit 1
fi
rm -f "$_wtest"

# --- Collecte des fichiers ---

declare -a video_files
mapfile -d '' video_files < <(find "$ROOT" -mindepth 2 -maxdepth 2 -type f -iname '*.mkv' -print0 2>/dev/null | sort -z)

# Reprise après coupure : on retire les .av1part inutilisables et on restaure un
# original écarté dont le remplacement n'aurait pas abouti.
find "$ROOT" -type f -name '*.av1part' -delete 2>/dev/null
while IFS= read -r -d '' bak; do
    orig="${bak%.bak}"
    [[ -f "$orig" ]] || mv -f "$bak" "$orig" 2>/dev/null
done < <(find "$ROOT" -type f -name '*.mkv.bak' -print0 2>/dev/null)

if [[ ${#video_files[@]} -eq 0 ]]; then
    echo "Aucun fichier .mkv trouvé sous $ROOT (recherche à profondeur 2)."
    exit 0
fi

# Le plafond --limit est appliqué AVANT l'inventaire pour qu'un test partiel ne
# sonde pas tout le catalogue.
if [[ "$LIMIT" -gt 0 && "$LIMIT" -lt "${#video_files[@]}" ]]; then
    video_files=("${video_files[@]:0:$LIMIT}")
fi
TOTAL=${#video_files[@]}

# --- Bannière immédiate : le reste (codecs, HDR, taille) suit la sonde. ---

echo ""
echo "Collection : $ROOT"
echo "  Fichiers  : $TOTAL"
echo "  Encodage  : $SPARK_HOST — av1_nvenc preset $PRESET cq $CQ, AAC stéréo ${AUDIO_BITRATE}"
echo "  Jobs      : $PARALLEL"
echo "  Journal   : $LOG_FILE"
echo "  Inventaire : sonde des $TOTAL fichiers…"

# --- Inventaire : une seule sonde PARALLÈLE, mise en cache. ---
#
# L'ancienne boucle séquentielle restait muette plusieurs minutes sur les 340
# fichiers (ffprobe sur sshfs) avant le moindre écho. Ici la sonde est faite en
# parallèle et son résultat sert à la fois à l'inventaire et au --dry-run, sans
# re-sonder le catalogue.

inv_file=$(mktemp)
printf '%s\0' "${video_files[@]}" | xargs -0 -P 8 -I{} sh -c '
    p=$(ffprobe -v error -print_format json \
        -show_entries format=size \
        -show_entries stream=codec_type,codec_name,color_transfer \
        "$1" 2>/dev/null)
    c=$(printf "%s" "$p" | jq -r "[.streams[]|select(.codec_type==\"video\")][0].codec_name // \"?\"" 2>/dev/null)
    t=$(printf "%s" "$p" | jq -r "[.streams[]|select(.codec_type==\"video\")][0].color_transfer // \"\"" 2>/dev/null)
    s=$(printf "%s" "$p" | jq -r ".format.size // 0" 2>/dev/null)
    # Placeholder obligatoire : un champ vide (transfer absent sur la plupart des
    # SDR) ferait s'"'"'effondrer les tabulations consécutives à la lecture (`read`
    # avec IFS=tabule), et la taille glisserait dans la mauvaise colonne.
    [[ -n "$c" ]] || c="?"
    [[ -n "$t" ]] || t="-"
    [[ "$s" =~ ^[0-9]+$ ]] || s=0
    printf "%s\t%s\t%s\t%s\n" "$1" "$c" "$t" "$s"
' sh {} > "$inv_file" 2>/dev/null

# xargs -P écrit dans l'ordre de fin des jobs : on retrie pour un affichage
# déterministe (ordre alphabétique des chemins, comme le find initial).
sort -t $'\t' -k1,1 -o "$inv_file" "$inv_file"

total_bytes=0
h264_n=0 hevc_n=0 av1_n=0 mpeg4_n=0 hdr_n=0
while IFS=$'\t' read -r _f c t s; do
    [[ "$s" =~ ^[0-9]+$ ]] || s=0
    total_bytes=$(( total_bytes + s ))
    case "$c" in h264) h264_n=$((h264_n+1));; hevc) hevc_n=$((hevc_n+1));; av1) av1_n=$((av1_n+1));; mpeg4) mpeg4_n=$((mpeg4_n+1));; esac
    [[ "$t" == "smpte2084" || "$t" == "arib-std-b67" ]] && hdr_n=$((hdr_n+1))
done < "$inv_file"

echo "  Codecs    : H.264 $h264_n | HEVC $hevc_n | AV1 $av1_n (sautés) | MPEG-4 $mpeg4_n"
echo "  HDR       : $hdr_n (tonemappés vers SDR BT.709)"
echo "  Taille    : $(human "$total_bytes") ($total_bytes octets)"
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    # Estimation grossière : vidéo H.264 ×0.50, HEVC ×0.68, MPEG-4 ×0.45 (l'audio
    # 5.1/lossless → AAC stéréo est déjà inclus dans ces facteurs). AV1 déjà en
    # place : inchangé.
    est_total=0
    while IFS=$'\t' read -r _f c t s; do
        [[ "$s" =~ ^[0-9]+$ ]] || s=0
        case "$c" in
            h264) est_total=$(( est_total + s * 50 / 100 )) ;;
            hevc) est_total=$(( est_total + s * 68 / 100 )) ;;
            av1)  est_total=$(( est_total + s )) ;;
            *)    est_total=$(( est_total + s * 45 / 100 )) ;;
        esac
    done < "$inv_file"
    saved=$(( total_bytes - est_total ))
    echo "Estimation (sans rien modifier) :"
    echo "  Taille initiale : $(human "$total_bytes")"
    echo "  Taille estimée  : $(human "$est_total")"
    echo "  Gain estimé     : $(human "$saved") ($(( saved * 100 / total_bytes ))%)"
    echo ""
    echo "Détail des fichiers :"
    while IFS=$'\t' read -r f c t s; do
        [[ "$s" =~ ^[0-9]+$ ]] || s=0
        if [[ "$c" == "av1" ]]; then st="SKIP"; else st="→ AV1"; fi
        printf '  %-6s %-10s %s\n' "$st" "$(human "$s")" "$(basename "$(dirname "$f")")"
    done < "$inv_file"
    rm -f "$inv_file"
    exit 0
fi

rm -f "$inv_file"

# --- Lancement ---

# État partagé entre les workers et le dashboard : compteurs, jobs actifs,
# progression ffmpeg, activité récente.
STATE_DIR=$(mktemp -d)
echo 0 > "$STATE_DIR/processed"
echo 0 > "$STATE_DIR/failed"
echo 0 > "$STATE_DIR/skipped"
mkdir "$STATE_DIR/active" "$STATE_DIR/log" "$STATE_DIR/progress"
LOCK_DIR="$STATE_DIR/lock"

# Le résumé final ne comptabilise que les entrées de CE passage, pas celles d'un
# éventuel run précédent sur le même journal.
START_LINES=0
if [[ -f "$LOG_FILE" ]]; then
    START_LINES=$(wc -l < "$LOG_FILE" | tr -d ' ')
    [[ "$START_LINES" =~ ^[0-9]+$ ]] || START_LINES=0
fi

# --- Dashboard ---

format_duration() {
    local secs=$1
    if [[ $secs -lt 60 ]]; then
        echo "${secs}s"
    elif [[ $secs -lt 3600 ]]; then
        printf "%dm%02ds" $((secs / 60)) $((secs % 60))
    else
        printf "%dh%02dm%02ds" $((secs / 3600)) $(((secs % 3600) / 60)) $((secs % 60))
    fi
}

# Tronque à N colonnes pour ne pas casser la bordure d'une fenêtre.
fit() {
    local t="$1" n="$2"
    [[ "${#t}" -le "$n" ]] && { echo "$t"; return; }
    echo "${t:0:$((n > 3 ? n - 3 : 1))}..."
}

term_cols() { tput cols 2>/dev/null || echo 80; }

job_progress() {  # $1 = pid, $2 = durée totale → % sur stdout
    local pid="$1" jduration="$2" out_us pct=0
    [[ -f "$STATE_DIR/progress/$pid" && "$jduration" =~ ^[0-9]+$ && "$jduration" -gt 0 ]] || { echo 0; return; }
    out_us=$(grep '^out_time_us=' "$STATE_DIR/progress/$pid" 2>/dev/null | tail -1 | cut -d= -f2)
    if [[ "$out_us" =~ ^[0-9]+$ ]]; then
        pct=$(( (out_us / 1000000) * 100 / jduration ))
        [[ $pct -gt 100 ]] && pct=100
        [[ $pct -lt 0 ]] && pct=0
    fi
    echo "$pct"
}

job_speed() {  # $1 = pid → « 23.2x » ou vide
    local s
    s=$(grep '^speed=' "$STATE_DIR/progress/$1" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' ')
    [[ "$s" == "N/A" || -z "$s" ]] && echo "" || echo "$s"
}

print_summary() {  # $1 processed $2 skipped $3 failed $4 elapsed
    local run_tail init_total fin_total saved pct
    run_tail=$(tail -n +$((START_LINES + 1)) "$LOG_FILE" 2>/dev/null)
    init_total=$(printf '%s\n' "$run_tail" | awk -F'\t' '$2=="OK" && $4 ~ /^[0-9]+$/{s+=$4} END{print s+0}')
    fin_total=$(printf '%s\n' "$run_tail" | awk -F'\t' '$2=="OK" && $5 ~ /^[0-9]+$/{s+=$5} END{print s+0}')
    echo ""
    echo "------------------------------------------------"
    if [[ "$3" -eq 0 ]]; then
        echo "  Terminé — Encodés: $1  Ignorés: $2  Temps: $4"
    else
        echo "  Terminé avec erreurs — Encodés: $1  Ignorés: $2  Échecs: $3"
        echo "  Détail des échecs : $LOG_FILE"
    fi
    if [[ "$init_total" -gt 0 && "$fin_total" -gt 0 ]]; then
        saved=$(( init_total - fin_total ))
        pct=$(( saved * 100 / init_total ))
        if [[ "$saved" -ge 0 ]]; then
            echo "  Gain : $(human "$init_total") → $(human "$fin_total") (économie $(human "$saved"), ${pct}%)"
        else
            echo "  Bilan : $(human "$init_total") → $(human "$fin_total") (${pct}%)"
        fi
    fi
    echo "  Journal : $LOG_FILE"
    echo "------------------------------------------------"
}

HAS_CURSES=0
[[ -f "$SCRIPT_DIR/simple_curses.sh" ]] && [[ -t 1 ]] && HAS_CURSES=1

if [[ $HAS_CURSES -eq 1 ]]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/simple_curses.sh"
fi

main() {
    local processed failed skipped done_count
    processed=$(cat "$STATE_DIR/processed" 2>/dev/null)
    failed=$(cat "$STATE_DIR/failed" 2>/dev/null)
    skipped=$(cat "$STATE_DIR/skipped" 2>/dev/null)
    local done_count=$((processed + failed + skipped))

    local now elapsed_s elapsed
    now=$(date +%s)
    elapsed_s=$(( now - START_TIME ))
    elapsed=$(format_duration "$elapsed_s")

    window "Réencodage AV1 → $SPARK_HOST  (preset $PRESET, cq $CQ)" "blue" "100%"
        append "Jobs: ${PARALLEL}   Fichiers: ${TOTAL}   AAC ${AUDIO_BITRATE}" left "white"
    endwin

    window "Progression" "cyan" "55%"
        if [[ "$TOTAL" -gt 0 ]]; then
            progressbar "100%" "$done_count" "$TOTAL" "green"
            append "" left
            append "Enc: $processed  Skip: $skipped  Fail: $failed  ${done_count}/${TOTAL}" left "white"
            local eta=""
            if [[ "$done_count" -gt 0 && "$done_count" -lt "$TOTAL" ]]; then
                eta="  ETA: $(format_duration $(( (elapsed_s * (TOTAL - done_count)) / done_count )))"
            fi
            append "Temps: ${elapsed}${eta}" left "yellow"
        fi
    endwin

    col_right
    window "Jobs actifs" "yellow" "45%"
        local has_active=0 f
        for f in "$STATE_DIR/active/"*; do
            [[ -f "$f" ]] || continue
            has_active=1
            local info; info=$(cat "$f" 2>/dev/null)
            local fname vcodec vheight jduration pid
            fname=$(echo "$info" | cut -d'|' -f1)
            vcodec=$(echo "$info" | cut -d'|' -f2)
            vheight=$(echo "$info" | cut -d'|' -f3)
            jduration=$(echo "$info" | cut -d'|' -f4)
            pid=$(basename "$f")

            local panel=$(( $(term_cols) * 45 / 100 - 4 ))
            [[ $panel -lt 20 ]] && panel=20
            local display; display=$(fit "$fname" $(( panel - 8 )))

            if [[ -z "$vcodec" ]]; then
                append "$display" left "white"
                append "  analyse..." left "cyan"
            else
                local pct; pct=$(job_progress "$pid" "$jduration")
                local spd; spd=$(job_speed "$pid")
                append "${display} (${pct}%)" left "white"
                append "  ${vcodec}/${vheight}p${spd:+  ${spd}}" left "cyan"
                [[ "$jduration" -gt 0 ]] && progressbar "45%" "$pct" 100 "green"
            fi
        done
        if [[ $has_active -eq 0 ]]; then
            if [[ "$done_count" -ge "$TOTAL" ]]; then
                append "Terminé" left "green"
            else
                append "En attente..." left "yellow"
            fi
        fi
    endwin

    move_up
    window "Activité récente" "magenta" "100%"
        local entries=() lf
        for lf in $(ls -t "$STATE_DIR/log/" 2>/dev/null | head -8); do
            local entry; entry=$(cat "$STATE_DIR/log/$lf" 2>/dev/null)
            [[ -n "$entry" ]] && entries+=("$entry")
        done
        if [[ ${#entries[@]} -gt 0 ]]; then
            local e wide=$(( $(term_cols) - 6 ))
            for e in "${entries[@]}"; do
                e=$(fit "$e" "$wide")
                local color="white"
                case "$e" in
                    OK*)   color="green" ;;
                    FAIL*) color="red" ;;
                    SKIP*) color="yellow" ;;
                esac
                append "$e" left "$color"
            done
        else
            append "En attente du premier fichier..." left "yellow"
        fi
    endwin

    if [[ "$done_count" -ge "$TOTAL" ]]; then
        local finish_marker="$STATE_DIR/finish_time"
        if [[ ! -f "$finish_marker" ]]; then
            echo "$(date +%s)" > "$finish_marker"
        elif [[ $(( $(date +%s) - $(cat "$finish_marker") )) -ge 3 ]]; then
            # main() est appelée avec stdout redirigé vers le buffer de
            # simple_curses ; le résumé doit donc viser /dev/tty, sinon il serait
            # écrit dans un buffer supprimé par clean_env et jamais affiché.
            clean_env
            { printf '\033[2J\033[H'; print_summary "$processed" "$skipped" "$failed" "$elapsed"; } > /dev/tty 2>&1
            rm -rf "$STATE_DIR"
            exit 0
        fi
    fi
}

# Affichage de repli quand simple_curses.sh n'est pas à côté du script.
plain_loop() {
    while true; do
        local processed failed skipped done_count
        processed=$(cat "$STATE_DIR/processed" 2>/dev/null)
        failed=$(cat "$STATE_DIR/failed" 2>/dev/null)
        skipped=$(cat "$STATE_DIR/skipped" 2>/dev/null)
        done_count=$((processed + failed + skipped))

        local actives=() f
        for f in "$STATE_DIR/active/"*; do
            [[ -f "$f" ]] || continue
            local info; info=$(cat "$f" 2>/dev/null)
            local fname jduration pid pct
            fname=$(echo "$info" | cut -d'|' -f1)
            jduration=$(echo "$info" | cut -d'|' -f4)
            pid=$(basename "$f")
            pct=$(job_progress "$pid" "$jduration")
            actives+=("${fname:0:36} ${pct}%")
        done

        printf '\r\033[K[%d/%d] Enc:%d Skip:%d Fail:%d — %s' \
            "$done_count" "$TOTAL" "$processed" "$skipped" "$failed" \
            "$(IFS=' | '; echo "${actives[*]:-...}")"

        if [[ "$done_count" -ge "$TOTAL" ]]; then
            echo ""
            print_summary "$processed" "$skipped" "$failed" \
                "$(format_duration $(( $(date +%s) - START_TIME )))"
            rm -rf "$STATE_DIR"
            return 0
        fi
        sleep 1
    done
}

# --- Interruption ---

cleanup_tui() {
    trap - SIGINT SIGTERM
    [[ $HAS_CURSES -eq 1 ]] && clean_env
    echo ""
    echo "Arrêt des encodages..."
    if [[ -n "${XARGS_PID:-}" ]]; then
        kill -TERM -"$XARGS_PID" 2>/dev/null
        sleep 0.5
        kill -KILL -"$XARGS_PID" 2>/dev/null
    fi
    wait 2>/dev/null
    find "$ROOT" -name '*.av1part' -type f -delete 2>/dev/null
    rm -rf "$STATE_DIR"
    exit 130
}
trap cleanup_tui SIGINT SIGTERM

START_TIME=$(date +%s)
export START_TIME

printf '%s\0' "${video_files[@]}" \
    | setsid xargs -0 -P "$PARALLEL" -I{} bash -c 'encode_one "$@"' _ {} &
XARGS_PID=$!

if [[ $HAS_CURSES -eq 1 ]]; then
    clear
    main_loop -t 1
else
    plain_loop
fi
