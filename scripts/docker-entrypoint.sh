#!/bin/sh
set -e

# Accès SSH au Spark (encodage GPU distant).
#
# Le bind /ssh-host est monté en lecture seule avec les droits de l'hôte
# (600 damso:damso). Le container tourne en root : openssh refuse une clé dont
# le propriétaire n'est ni root ni l'utilisateur courant ("bad ownership or
# modes"), donc on recopie la clé dans /root/.ssh avec les bons droits plutôt
# que de l'utiliser en place.
if [ -f /ssh-host/id_ed25519 ]; then
    echo "[zone-club] Configuring SSH access to ${SPARK_SSH_HOST:-spark}..."
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    cp /ssh-host/id_ed25519 /root/.ssh/id_ed25519
    chmod 600 /root/.ssh/id_ed25519
    if [ -f /ssh-host/known_hosts ]; then
        cp /ssh-host/known_hosts /root/.ssh/known_hosts
        chmod 600 /root/.ssh/known_hosts
    fi
    # Config générée depuis l'env : le container ne dépend pas du ~/.ssh/config
    # de l'hôte. `Ciphers aes128-gcm` exploite l'AES matériel du Grace (sinon le
    # chiffrement plafonne bien avant le réseau), `Compression no` car la vidéo
    # est déjà compressée. BatchMode: jamais de prompt interactif dans un daemon.
    cat > /root/.ssh/config <<EOF
Host ${SPARK_SSH_HOST:-spark}
    HostName ${SPARK_SSH_HOSTNAME:-82.65.17.134}
    Port ${SPARK_SSH_PORT:-2222}
    User ${SPARK_SSH_USER:-damso}
    IdentityFile /root/.ssh/id_ed25519
    IdentitiesOnly yes
    Compression no
    Ciphers aes128-gcm@openssh.com
    ServerAliveInterval 30
    ServerAliveCountMax 3
    StrictHostKeyChecking yes
    BatchMode yes
EOF
    chmod 600 /root/.ssh/config
else
    echo "[zone-club] WARNING: /ssh-host/id_ed25519 absent — l'encodage GPU distant échouera"
fi

# Standalone needs static assets and public folder
echo "[zone-club] Linking static assets..."
ln -sfn /app/public /app/.next/standalone/public
ln -sfn /app/.next/static /app/.next/standalone/.next/static

echo "[zone-club] Starting server..."
cd /app/.next/standalone
exec node server.js
