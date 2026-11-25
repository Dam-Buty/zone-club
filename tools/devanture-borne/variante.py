"""La variante de la devanture que la fabrique est en train de faire : « mobile » (par défaut) ou « bureau ».

Chaque script de la fabrique prend ici sa géométrie et son dossier d'intermédiaire, au lieu de chemins écrits en dur :
    DEVANTURE=bureau python3 fond_bureau.py     →  geometrie-bureau.json, travail-bureau/
    python3 fond.py                             →  geometrie.json, travail/            (mobile)

En ligne de commande (pour fabrique.sh) :
    python3 variante.py --dossier      le dossier d'intermédiaire de la variante
    python3 variante.py site.zoom      la valeur de cette clé de la géométrie ; code 1 si elle n'existe pas
"""
import json
import os
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
VARIANTE = os.environ.get('DEVANTURE', 'mobile')
GEOMETRIE = ICI / ('geometrie.json' if VARIANTE == 'mobile' else f'geometrie-{VARIANTE}.json')
if not GEOMETRIE.exists():
    raise SystemExit(f'variante « {VARIANTE} » inconnue : {GEOMETRIE.name} est introuvable')
G = json.loads(GEOMETRIE.read_text())
D = ICI / ('travail' if VARIANTE == 'mobile' else f'travail-{VARIANTE}')      # tout l'intermédiaire (ignoré par git)
D.mkdir(exist_ok=True)
CACHE = ICI / 'travail' / 'tmdb-cache'      # affiches et logos téléchargés : les mêmes pour toutes les variantes
SOURCES = ICI / 'sources'

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == '--dossier':
        print(D)
    else:
        v = G
        for cle in sys.argv[1].split('.'):
            if not isinstance(v, dict) or cle not in v:
                sys.exit(1)
            v = v[cle]
        print(v if isinstance(v, str) else json.dumps(v))
