#!/bin/sh
# Fabrique les tranches de K7 des films du vidéoclub qui n'en ont pas encore (public/kiosk-tranches/<tmdb>.webp et
# <tmdb>-c.webp) — à lancer après chaque ajout de film en production (Rusmir, 23/11/2026), puis commiter et déployer.
#
#   sh tools/devanture-borne/tranches_manquantes.sh [<adresse du site>]      (défaut : https://club.lazone.at)
#
# La liste vient de la route publique GET /api/films du site. Les tranches sont dessinées par l'application elle-même
# (src/utils/VHSCoverGenerator.ts), capturées dans le site en développement (capture_jaquettes.cjs), puis usées selon
# l'année du film (distribution_tranches_site.py). Le temps de la capture, les films concernés sont rendus disponibles
# dans la base LOCALE (zone.db), et ceux qu'elle n'a pas y sont ajoutés ; tout est remis en l'état à la fin, même en
# cas d'échec. Le port 3003 doit être libre.
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$ICI/../.." && pwd)
SITE="${1:-https://club.lazone.at}"
T="$ICI/travail/tranches-manquantes"
mkdir -p "$T"
cd "$R"
[ -z "$(lsof -nP -tiTCP:3003 -sTCP:LISTEN)" ] || { echo "le port 3003 est occupé"; exit 1; }

curl -fsS -m 60 -o "$T/films.json" "$SITE/api/films"
python3 - "$T" <<'E'
import json, os, sqlite3, sys
t = sys.argv[1]
films = json.load(open(f'{t}/films.json'))
prets = {int(n[:-5]) for n in os.listdir('public/kiosk-tranches') if n[:-5].isdigit()}
manquants = [f for f in films if f['tmdb_id'] not in prets]
base = sqlite3.connect('zone.db')
connus = {r[0]: r[1] for r in base.execute('select tmdb_id, is_available from films')}
q = lambda v: 'null' if v is None else "'" + str(v).replace("'", "''") + "'"
ids = [f['tmdb_id'] for f in manquants]
ajoutes = [f for f in manquants if f['tmdb_id'] not in connus]
caches = [i for i in ids if i in connus and not connus[i]]
avant = [f"insert into films (tmdb_id, title, release_year, poster_url, aisle, is_available, is_nouveaute) values ({f['tmdb_id']}, {q(f['title'])}, {q(f.get('release_year'))}, {q(f.get('poster_url'))}, {q(f.get('aisle'))}, 1, 0);" for f in ajoutes]
apres = []
if caches:
    avant.append(f"update films set is_available = 1 where tmdb_id in ({', '.join(map(str, caches))});")
    apres.append(f"update films set is_available = 0 where tmdb_id in ({', '.join(map(str, caches))});")
if ajoutes:
    apres.append(f"delete from films where tmdb_id in ({', '.join(str(f['tmdb_id']) for f in ajoutes)});")
open(f'{t}/avant.sql', 'w').write('\n'.join(avant) + '\n')
open(f'{t}/apres.sql', 'w').write('\n'.join(apres) + '\n')
open(f'{t}/ids.txt', 'w').write(' '.join(map(str, ids)))
print(f"{len(films)} films sur le site, {len(prets)} tranches prêtes, {len(ids)} à fabriquer ({len(ajoutes)} absents de la base locale)")
for f in manquants:
    print('  ', f['tmdb_id'], f['title'], f.get('release_year'))
E
IDS=$(cat "$T/ids.txt")
[ -n "$IDS" ] || { echo "rien à fabriquer"; exit 0; }

remets() {
    lsof -nP -tiTCP:3003 -sTCP:LISTEN | xargs -r kill
    sqlite3 zone.db < "$T/apres.sql"
    git checkout -- AGENTS.md next-env.d.ts 2>/dev/null || true     # next dev les réécrit
}
trap remets EXIT
sqlite3 zone.db < "$T/avant.sql"
(npx next dev -p 3003 > "$T/dev.log" 2>&1 &)
until curl -s -o /dev/null http://localhost:3003/; do sleep 2; done
# shellcheck disable=SC2086
node "$ICI/capture_jaquettes.cjs" http://localhost:3003/ "$ICI/travail/tex/tranches-site-src" $IDS > "$T/capture.log" 2>&1
# shellcheck disable=SC2086
(cd "$ICI" && python3 distribution_tranches_site.py $IDS)
echo "à commiter : git add public/kiosk-tranches"
