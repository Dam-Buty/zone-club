# Devanture mobile avec la borne — fabrication des images

La devanture mobile du site (`public/storefront-mobile.{webp,jpeg}`) est une image fabriquée : la photo
d'origine de la porte, un mur reconstitué à sa gauche, et la borne de location rendue sous Blender puis
raccordée à la photo. Ce dossier contient tout ce qu'il faut pour la refaire d'une commande :

```bash
sh tools/devanture-borne/fabrique.sh            # 256 échantillons pour la borne, 384 pour le mur
sh tools/devanture-borne/fabrique.sh 128 256    # plus rapide, pour un essai
```

Conception, décisions et critère de réussite (le verdict visuel de Rusmir, photo et image côte à côte) :
`docs/superpowers/specs/2026-11-16-borne-location-design.md`, §§ 4, 5 et 9 et le journal en tête du document.
La vue a été validée le 18/11/2026.

## Ce qu'il faut

- **Blender 5.3** dans `/Applications/Blender 5.3.app` (autre chemin : variable `BLENDER`). Rendu Cycles sur
  GPU Metal ; le premier rendu d'une session compile les noyaux (~3 min), les suivants prennent ~10 s.
- **Python 3.11** avec PIL, numpy et scipy.
- **Les polices du Mac** : SignPainter (enseigne néon), DIN Condensed, Impact, Futura (étiquettes).
- **Une clé TMDB** dans le `.env` de la racine (`TMDB_API_KEY`), pour les affiches et les logos des tranches
  de K7. Elle n'est jamais affichée ; les téléchargements passent par `curl` et restent dans
  `travail/tmdb-cache/` (un second passage ne touche plus au réseau).

## Les scripts, dans l'ordre de la fabrique

| Script | Rôle |
|---|---|
| `geometrie.json` | L'échelle commune (549 px/m, caméra à 6 m), les cotes de la borne et de sa façade, les réglages du néon et du mur |
| `fond.py` | Le fond sans la borne : photo réduite et calée à droite, mur reconstitué, enseigne VIDEOCLUB recentrée, toit, ciel de pluie et lune → `travail/fond.png`, `travail/repere.json` |
| `textures.py` | Les textures de la borne : autocollants usés, tranches de K7 (films figés dans `sources/tranches.json`), bandeau, usure de la façade, afficheur → `travail/tex/` |
| `neon_graphe.py`, `neon.py` | Le parcours des tubes de l'enseigne « BORNE 24/7 », tracé comme un verrier les cintre → `travail/neon-borne.json` |
| `borne.py` | La scène Blender. Passe `borne` : la borne sur fond transparent, le mur en attrape-ombres. Passe `mur` : la lumière que le mur mouillé renvoie du néon et d'un réverbère |
| `compo.py` | La composition : lumière du mur ajoutée à la photo, borne posée, halo du néon, pluie → `travail/compo.png` |

Outils de réglage, hors fabrique : `gros_plan.py` (gros plan Cycles d'une zone de la façade),
`mesure_neon.py` (coupe d'un tube comparée à un vrai tube de la photo), `charge.py` (recharge la scène dans
un Blender ouvert, pour la régler à vue).

## Les sources (`sources/`)

- `storefront-mobile.jpeg` — la photo d'origine de la devanture mobile (1536 × 2752), celle que le site
  affichait avant la borne.
- `gyro-face.png` — une capture de l'interface de la borne, posée sur son écran.
- `autocollant-*.{jpg,webp}` — les quatre autocollants collés sur la borne.
- `tranches.json` — les 96 films dont les K7 garnissent les vitrines, dans l'ordre des tranches.
