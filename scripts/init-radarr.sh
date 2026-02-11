#!/run/current-system/sw/bin/bash
# Configure both Radarr instances via API after first launch
# Usage: ./scripts/init-radarr.sh

set -euo pipefail

RADARR_VO_URL="${RADARR_VO_URL:-http://localhost:7878}"
RADARR_VO_API_KEY="${RADARR_VO_API_KEY:-3a6d42a139df462eaf2c458e3341d894}"
RADARR_VF_URL="${RADARR_VF_URL:-http://localhost:7879}"
RADARR_VF_API_KEY="${RADARR_VF_API_KEY:-901b0a1c01054fb8aae91760b0e12b26}"
SABNZBD_API_KEY="${SABNZBD_API_KEY:-1b34a641693e4f3dbcde54a4df298d42}"

wait_for_radarr() {
    local url="$1"
    local key="$2"
    local name="$3"
    echo "En attente de $name..."
    for i in $(seq 1 30); do
        if curl -sf -H "X-Api-Key: $key" "$url/api/v3/system/status" > /dev/null 2>&1; then
            echo "$name est prêt."
            return 0
        fi
        sleep 2
    done
    echo "ERREUR: $name n'a pas démarré à temps."
    return 1
}

configure_instance() {
    local url="$1"
    local key="$2"
    local name="$3"

    echo "=== Configuration de $name ==="

    # Add root folder /movies
    existing_roots=$(curl -sf -H "X-Api-Key: $key" "$url/api/v3/rootfolder")
    if echo "$existing_roots" | grep -q '"/movies"'; then
        echo "Root folder /movies déjà configuré."
    else
        echo "Ajout du root folder /movies..."
        curl -sf -X POST -H "X-Api-Key: $key" -H "Content-Type: application/json" \
            -d '{"path":"/movies"}' \
            "$url/api/v3/rootfolder"
        echo ""
    fi

    # Add SABnzbd as download client
    existing_clients=$(curl -sf -H "X-Api-Key: $key" "$url/api/v3/downloadclient")
    if echo "$existing_clients" | grep -q 'SABnzbd'; then
        echo "SABnzbd déjà configuré."
    else
        echo "Ajout de SABnzbd comme client de téléchargement..."
        curl -sf -X POST -H "X-Api-Key: $key" -H "Content-Type: application/json" \
            -d '{
                "enable": true,
                "protocol": "usenet",
                "name": "SABnzbd",
                "implementation": "Sabnzbd",
                "configContract": "SabnzbdSettings",
                "fields": [
                    {"name": "host", "value": "192.168.1.24"},
                    {"name": "port", "value": 8666},
                    {"name": "apiKey", "value": "'"$SABNZBD_API_KEY"'"},
                    {"name": "movieCategory", "value": "movies"},
                    {"name": "useSsl", "value": false}
                ]
            }' \
            "$url/api/v3/downloadclient"
        echo ""
    fi

    echo "$name configuré."
}

# Wait for both instances
wait_for_radarr "$RADARR_VO_URL" "$RADARR_VO_API_KEY" "Radarr-VO"
wait_for_radarr "$RADARR_VF_URL" "$RADARR_VF_API_KEY" "Radarr-VF"

# Configure both
configure_instance "$RADARR_VO_URL" "$RADARR_VO_API_KEY" "Radarr-VO"
configure_instance "$RADARR_VF_URL" "$RADARR_VF_API_KEY" "Radarr-VF"

echo "=== Initialisation terminée ==="
