# Minitel — Recherche & Localisation des Films

**Date** : 2026-05-11
**Branche** : `minitel`
**Auteur** : Rusmir Sadikovic + Claude (Opus 4.7)

## 1. Contexte et motivation

Le videoclub Zone Club expose ~145 films dispersés dans 13 rayons (action, horreur, sf, comedie, classiques, etc.) plus une section nouveautés. Sans outil dédié, retrouver un film précis nécessite de parcourir physiquement les étagères en 3D — coûteux pour l'utilisateur en temps et en navigation.

Le modèle 3D `minitel_1982-france.glb` est déjà placé sur le comptoir d'accueil (`Aisle.tsx:1150`) mais n'a aucune interaction. On l'active comme **borne de recherche** style Vidéotex 1982, fidèle visuellement à un vrai terminal Minitel.

**Objectifs utilisateur** :
1. Trouver rapidement un film par titre, par rayon, ou via la liste alphabétique.
2. Visualiser sa position physique dans la scène (rayon + emplacement).
3. Illuminer la K7 dans la scène 3D pour la repérer visuellement à distance.
4. Commander un film qui n'existe pas encore au videoclub (réutilise la fonctionnalité existante de la TV / SearchModal).

## 2. Esthétique validée

**Style B — Néon-noir hybride** (validé par mockup visuel) :
- Fond noir profond (`#000` à `#050816`)
- Texte blanc cassé (`#f0f4ff`) avec subtle text-shadow cyan (`rgba(0, 255, 247, 0.25)`)
- Headers en cyan néon (`#00fff7`) avec underline et text-shadow plus intense
- Police monospace (`Courier New, monospace`)
- Scanlines subtiles via `repeating-linear-gradient` (lignes 1px tous les 3px, opacity 0.04)
- Vignette CRT via `radial-gradient` aux bords
- Touches de couleur : input cyan, sélection avec text-shadow cyan, boutons "ENVOI" cyan

Cohérent avec la palette néon du videoclub (déjà utilisée pour les cassettes, les étagères, les overlays).

## 3. UI Minitel — 4 modes

### 3.1 Sommaire (entrée principale)

```
▸ ZONE CLUB - VIDEOTHEQUE

   [1] RECHERCHER UN FILM
   [2] PARCOURIR LES RAYONS
   [3] LISTE ALPHABETIQUE
   [4] COMMANDER UN FILM SI NON DISPO

   Tapez le numero + ENVOI
```

Touches : `1` `2` `3` `4` puis Enter (`ENVOI`). Esc retourne au sommaire depuis n'importe quel sous-écran.

### 3.2 Mode 1 — Rechercher un film (fuzzy match titre)

Champ de saisie + résultats live (debounce 200ms). Match :
- Insensible à la casse, aux accents (normalisation NFD + strip diacritics).
- Substring sur le titre normalisé.
- Trie : exact match en premier, puis startsWith, puis includes.
- Top 10 résultats max.

Click sur un résultat → écran détail (3.6).

Si 0 résultat : "AUCUN RESULTAT — essayez le mode 4 pour commander".

### 3.3 Mode 2 — Parcourir les rayons

Liste des 13 rayons + nombre de films par rayon :

```
▸ RAYONS

   [1] ACTION         (23 films)
   [2] AVENTURE       (11)
   [3] BIZARRE        (2)
   [4] CLASSIQUES     (13)
   [5] COMEDIE        (20)
   [6] DRAME          (33)
   [7] HORREUR        (7)
   [8] POLICIER       (17)
   [9] ROMANCE        (1)
   [0] AUTRES...        (suivants en SUITE)
```

Touche numéro → liste paginée des films du rayon (10 par page, SUITE pour page suivante). Click film → détail (3.6).

### 3.4 Mode 3 — Liste alphabétique

Tous les films triés A→Z, paginés 10 par page :

```
▸ FILMS - PAGE 1/15

   [1] ALIEN
   [2] AMERICAN BEAUTY
   [3] BLADE RUNNER
   ...

   [SUITE] page suivante | [SOMMAIRE] retour
```

Click film → détail (3.6).

### 3.5 Mode 4 — Commander un film si non dispo (recherche TMDB)

Réutilise la logique existante de `src/components/search/SearchModal.tsx` :
- Debounced input (500ms) → `tmdb.search(query)` → top 10 résultats.
- Pour chaque résultat : titre, année, bouton `[ENVOI] DEMANDER`.
- Click DEMANDER → `api.filmRequests.create({ tmdb_id, title, poster_url })`.
- Confirmation : "FILM DEMANDE" pendant 3s.
- Si déjà demandé (présent dans `requestedIds` chargé via `api.filmRequests.getAll()`) : afficher "DEJA DEMANDE" inactif.
- Si pas authentifié : afficher "CONNECTEZ-VOUS POUR COMMANDER" + bouton `CONNEXION` qui ouvre `AuthModal` (sans casser le flow minitel).

### 3.6 Écran détail film (commun aux modes 1/2/3)

```
▸ DETAIL FILM

   PULP FICTION (1994)

   RAYON       : CLASSIQUES
   EMPLACEMENT : 4-7

   [ENVOI] ILLUMINER LA K7
   [SOMMAIRE] retour
```

Click ILLUMINER → met à jour `highlightedCassetteKey` dans le store → halo 3D bleu pulsant apparait sur la K7 (voir 4.4). Reste affiché jusqu'au prochain highlight ou click ailleurs.

## 4. Architecture technique

### 4.1 Nouveaux fichiers

| Fichier | Rôle |
|---|---|
| `src/components/interior/MinitelDisplay.tsx` | Wrapper 3D du modèle minitel + raycast layer interactif. Gère l'attachement de la CanvasTexture sur le mesh "screen" du GLB. |
| `src/components/interior/MinitelScreen.tsx` | Composant qui rend la CanvasTexture (texte minitel) basée sur `minitelMode` du store. Re-render au changement state, pas chaque frame. |
| `src/components/minitel/MinitelOverlay.tsx` | Overlay HTML transparent fullscreen quand `isInteractingWithMinitel === true`. Input invisible focus auto pour capter clavier desktop. Boutons tactiles sur mobile (1-9, ENVOI, SOMMAIRE, SUITE, RETOUR). |
| `src/components/interior/CassetteHighlight.tsx` | Halo bleu pulsant 3D + emissive boost sur la cassette `highlightedCassetteKey`. |
| `src/utils/minitelSearch.ts` | Fuzzy match titre — normalisation Unicode (NFD + strip diacritics) + substring matching + ranking exact/startsWith/includes. |
| `src/utils/cassetteLocation.ts` | Helper `cassetteKeyToHumanLocation(key, aisle)` qui parse la `cassetteKey` et formate "RAYON, ETAGERE X - POSITION Y" pour l'écran détail. |

### 4.2 Modifications fichiers existants

| Fichier | Modification |
|---|---|
| `src/components/interior/Aisle.tsx` | Remplacer `<AsyncModel url="/models/minitel_1982-france.glb" .../>` ligne 1150 par `<MinitelDisplay .../>`. |
| `src/components/interior/Controls.tsx` | Ajouter `MINITEL_ZOOM_POSITION` + `MINITEL_ZOOM_LOOKAT` (calculés selon position du minitel). Branche dans `useFrame` similaire au TV zoom : si `isInteractingWithMinitel`, lerp camera vers ces positions. Sur mobile portrait, calculer dynamiquement (formule `(screenWidth/2) / tan(fovH/2) * 1.10` réutilisée). Click raycast sur mesh minitel → `setInteractingWithMinitel(true) + setMinitelMode('sommaire')`. |
| `src/components/interior/CassetteInstances.tsx` | Ajouter un attribute per-instance `highlightFlag` (0 ou 1) + storage buffer. Dans le TSL fragment shader, si flag === 1 → boost emissive bleu cyan (`vec3(0.0, 0.5, 1.0) * 1.5`) pour faire ressortir le poster. Listen au store `highlightedCassetteKey` → trouve l'index et met à jour le buffer. |
| `src/store/index.ts` | Voir 4.3. |
| `src/App.tsx` | Mount `<MinitelOverlay />` au top-level (sibling de VHSPlayer). |

### 4.3 Store state ajouté

```typescript
// Minitel UI state
isInteractingWithMinitel: boolean
setInteractingWithMinitel: (v: boolean) => void

minitelMode: 'idle' | 'sommaire' | 'recherche' | 'rayons' | 'alpha' | 'commander' | 'detail'
setMinitelMode: (m: MinitelMode) => void

minitelQuery: string                       // texte saisi (modes 1 et 4)
setMinitelQuery: (q: string) => void

minitelSelectedAisle: AisleType | null     // mode 2 → liste films d'un rayon
setMinitelSelectedAisle: (a: AisleType | null) => void

minitelSelectedFilm: number | null         // filmId pour modes 1/2/3, tmdb_id pour mode 4
setMinitelSelectedFilm: (id: number | null) => void

minitelPageIndex: number                   // pagination modes 2/3
setMinitelPageIndex: (n: number) => void

// Highlight K7 (consommé par CassetteHighlight + CassetteInstances)
highlightedCassetteKey: string | null
setHighlightedCassetteKey: (k: string | null) => void
```

Aucun de ces champs n'est persisté dans `partialize` (état éphémère).

### 4.4 Illumination K7 (CassetteHighlight + CassetteInstances)

Deux mécanismes combinés pour visibilité maximale :

1. **Per-instance emissive boost** (dans `CassetteInstances` TSL) :
   - Nouveau `instancedArray<float>` avec flag 0/1 par cassette.
   - Au update de `highlightedCassetteKey` dans le store, retrouver l'instance index correspondant et set le flag à 1 (et tous les autres à 0).
   - Dans le shader : `if (highlightFlag > 0.5) { emissive += vec3(0.0, 0.5, 1.0) * 1.5; }`.

2. **Halo 3D** (composant `CassetteHighlight`) :
   - Sphère translucide bleue (`color: '#00aaff'`, `opacity: 0.4`, `blending: AdditiveBlending`).
   - Radius : 0.15m, positionnée à la worldPosition de la cassette.
   - Pulsation via `useFrame` : `scale = 1 + 0.15 * sin(t * 3)`.
   - Lookup la worldPosition via `userData.cassetteKey` exposé par `CassetteInstances` (déjà fait).
   - Mount conditionnel : seulement si `highlightedCassetteKey !== null`.

Persistence : tant que `highlightedCassetteKey !== null`. Reset à `null` :
- Nouvelle illumination (set la nouvelle key).
- Bouton SOMMAIRE / sortie du minitel (optionnel — préférence : laisser persister pour que l'user trouve la K7).
- Click sur une K7 ou ailleurs dans la scène (optionnel).

Pour la V1 : reset uniquement quand l'user clique ILLUMINER pour un autre film. Le halo persiste sinon — l'utilisateur peut sortir du minitel et aller voir.

### 4.5 Camera zoom minitel

Position et lookAt calculés relativement au minitel (`position={[-0.571, 1.047, -0.01]}` dans `Aisle.tsx`, scale 0.025, rotation Y=π) :
- Le screen du minitel est légèrement incliné vers le haut (~30° tilt typique d'un Minitel 1).
- Centre approximatif du screen world : à ajuster empiriquement après mount.
- Distance camera→screen : ~0.4m desktop (FOV 70°), dynamique mobile.

Code parallèle au TV zoom dans `Controls.tsx`, branche conditionnelle `if (isInteractingWithMinitel)` avec early return après lerp.

Sortie : ESC ou bouton SOMMAIRE → `setInteractingWithMinitel(false)` → camera retourne à pré-interaction position (sauvegardée dans un ref comme pour `preSitPosRef`).

### 4.6 Overlay HTML (saisie + boutons)

Composant `MinitelOverlay.tsx` :
- Render conditionnel : `if (!isInteractingWithMinitel) return null`.
- Position fixed pleine page, zIndex au-dessus du Canvas mais en-dessous des modales système.
- Pour la saisie clavier (modes 1 et 4) : `<input>` invisible (opacity 0) auto-focused. onChange → `setMinitelQuery`. Capture aussi Enter (ENVOI), Esc (SOMMAIRE), PageDown (SUITE), flèches (navigation liste).
- Pour mobile : barre de boutons en bas (ou côté droit) — chiffres 0-9, ENVOI, SOMMAIRE, SUITE, RETOUR, BACKSPACE. Visible quand un mode demande input (1, 4) ou navigation (2, 3).
- Sortie auto si `isInteractingWithMinitel` devient false.

Le rendu visuel des résultats / du sommaire / etc. **N'EST PAS** dans cet overlay HTML — il est dans la CanvasTexture du screen 3D (composant `MinitelScreen`). L'overlay HTML capture seulement les inputs.

### 4.7 Recherche fuzzy (`minitelSearch.ts`)

```typescript
function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .trim();
}

export function searchFilms(films: Film[], query: string): Film[] {
  const q = normalize(query);
  if (!q) return [];
  const exact: Film[] = [];
  const startsWith: Film[] = [];
  const includes: Film[] = [];
  for (const f of films) {
    const t = normalize(f.title);
    if (t === q) exact.push(f);
    else if (t.startsWith(q)) startsWith.push(f);
    else if (t.includes(q)) includes.push(f);
  }
  return [...exact, ...startsWith, ...includes].slice(0, 10);
}
```

Pas de Levenshtein pour V1 (substring + ordering suffit pour 145 films).

### 4.8 Position cassette → texte humain

Pour afficher "RAYON: CLASSIQUES, EMPLACEMENT: 4-7" :

`cassetteKey` est de la forme `wall-{x}-{z}-{row}-{col}` ou `island-...-{side}-{row}-{col}` (voir `Aisle.tsx:354, 471`).

Helper `cassetteKeyToHumanLocation(key, aisle)` :
- Parse rayon depuis le `aisle` du film (déjà connu via `films[aisle].find(...)`).
- Parse `row-col` depuis la `cassetteKey` → "row-col" ou "côté gauche row-col" pour les îlots.
- Format : `"CLASSIQUES, ETAGERE 4 - POSITION 7"`.

À placer dans nouveau fichier `src/utils/cassetteLocation.ts`.

## 5. Performance

- CanvasTexture re-rendue uniquement au changement de `minitelMode` / `minitelQuery` / `minitelPageIndex` (pas chaque frame).
- Halo K7 : 1 seul mesh additionnel quand actif, useFrame léger (juste sin pulsation).
- Per-instance highlight : 1 buffer storage update par highlight (pas chaque frame).
- Pas d'allocation par frame dans le hot path.
- Recherche fuzzy : 145 films, instant en JS pur (~0.1ms).
- TMDB search : déjà cached côté client (`withCache` 24h via `tmdb.search`).

## 6. Edge cases

| Cas | Comportement |
|---|---|
| User pas connecté + clique COMMANDER UN FILM | Écran "CONNECTEZ-VOUS POUR COMMANDER" + bouton CONNEXION qui ouvre `AuthModal` |
| User pas connecté + autres modes (1/2/3) | Pas de blocage — recherche/parcours fonctionne sans auth |
| User déjà demandé un film TMDB | Afficher "DEJA DEMANDE" au lieu du bouton DEMANDER |
| Recherche fuzzy retourne 0 résultat | "AUCUN RESULTAT — essayez le mode 4 pour commander" |
| Film highlighted puis user fait nouvelle recherche/highlight | `setHighlightedCassetteKey(newKey)` remplace l'ancien (un seul halo à la fois) |
| Film highlighted + user sort du minitel | Halo persiste — l'user peut aller voir la K7 |
| Mobile portrait + minitel | Camera zoom dynamique fit-width (formule TV réutilisée) |
| User tourne le tel mid-interaction | Camera + overlay s'ajustent (resize listener) |
| Click sur une cassette indisponible (`is_available=false`) | N'apparait pas dans la recherche (filter sur `films` du store qui contient déjà les disponibles) |

## 7. Acceptance criteria

✓ Click sur le minitel 3D zoom la caméra dessus (desktop + mobile portrait + landscape)
✓ Sommaire affiche les 4 options
✓ Mode 1 : recherche fuzzy par titre, top 10 résultats, click → détail
✓ Mode 2 : 13 rayons listés avec count, click rayon → liste paginée des films
✓ Mode 3 : tous les films A→Z paginés 10/page
✓ Mode 4 : `tmdb.search` debounced + `api.filmRequests.create` au DEMANDER + état "déjà demandé"
✓ Écran détail affiche titre + rayon + emplacement + bouton ILLUMINER
✓ ILLUMINER : halo bleu pulsant + emissive boost sur la bonne K7 dans la scène 3D
✓ Halo persiste jusqu'au prochain highlight
✓ ESC ou bouton SOMMAIRE depuis n'importe quel écran retourne au sommaire (sauf depuis sommaire qui sort du minitel)
✓ Sortie du minitel : caméra retourne à la position pré-interaction
✓ Pas de régression visuelle ou perf sur le rendu CassetteInstances existant
✓ Esthétique fidèle au mockup style B validé

## 8. Hors scope (YAGNI)

- Pas de favoris / historique de recherche
- Pas de tri par note / année / acteur (KISS — juste titre)
- Pas de prévisualisation poster sur l'écran minitel (texte only, fidèle au minitel 1982)
- Pas de chemin guidé au sol (pointillés, flèche) vers la K7 — juste le halo
- Pas de Levenshtein pour la recherche fuzzy (substring + accent-insensible suffit)
- Pas de panel admin pour gérer les filmRequests depuis le minitel (déjà géré ailleurs)
- Pas de retour vidéo / animation de transition d'écran à écran (instant cut, fidèle minitel)

## 9. Risques et plan de rollback

### 9.1 Risques

- **Identifier le mesh "screen" du GLB minitel** : nom potentiellement inconnu. Mitigation : `traverse` au mount + fallback "premier mesh trouvé" + log warning si pas trouvé.
- **Camera zoom trop proche / écran trop incliné** : ajustement empirique post-implémentation. Plan B : ajouter un offset paramétrable.
- **Per-instance emissive boost** : modification du shader TSL de `CassetteInstances` non triviale. Si bloqué techniquement, V1 livre le halo 3D seul (toujours fonctionnel et visible) et l'emissive est reporté. L'acceptance criteria reste "halo + emissive" comme objectif final mais le halo seul est acceptable si l'emissive prend trop de temps.
- **Conflit input clavier** : si user tape pendant que d'autres listeners sont actifs (Controls FPS). Mitigation : désactiver les listeners FPS de Controls quand `isInteractingWithMinitel` (déjà le pattern pour la TV).

### 9.2 Rollback

Branche dédiée `minitel`. PR séparée. Si problème, simple revert du merge. Aucun changement de schéma DB ou d'API serveur (réutilise routes `api.filmRequests.create/getAll` existantes).

## 10. Workflow

- Branche : `minitel` (créée depuis `optimizations-avril`)
- Commits atomiques par sous-partie (store, MinitelDisplay, MinitelScreen, MinitelOverlay, CassetteHighlight, Controls zoom, integration Aisle).
- PR vers `optimizations-avril` ou `main` selon décision finale du sprint en cours.

## 11. Prochaines étapes

1. Validation utilisateur de ce spec.
2. Invocation de la skill `superpowers:writing-plans` pour produire le plan d'implémentation détaillé.
3. Exécution étape par étape, validation visuelle à chaque sous-partie.
