# Handoff — chantiers ouverts (ouvert le 2026-06-09, rafraîchi au rebase)

> Document de reprise. Il ne garde que ce qui n'est **pas** déjà dans `AGENTS.md` : l'état des
> chantiers en cours et les pièges d'environnement qui coûtent une session quand on les redécouvre.
> Les leçons durables sur le code migrent dans `AGENTS.md` au fur et à mesure des merges — quand un
> chantier est mergé, sa section disparaît d'ici.

---

## 1. État des chantiers

| Chantier | Branche | État |
|---|---|---|
| **A. VF/VO + historique** | `fix/vfvo-visibility-history` | code terminé, **rebasé sur `main` courant** ; reste la validation visuelle (§2) puis PR |
| **B. Light-baking néon-noir** | `lighti-cook` (`00ab7b7`) | checkpoint WIP, **parqué** ; 100 % baké derrière `?baked=1`, off par défaut |

Convention projet : valider → squash → PR. Ne jamais laisser une branche diverger de `main`
(voir « Règles Git » dans `AGENTS.md`).

---

## 2. Chantier A — ce qu'il reste à valider

Le code est décrit par ses commits ; les décisions durables sont passées dans `AGENTS.md`
(« Leçons apprises » + section Store Zustand). Ce qui reste :

1. **VF/VO — validation en prod obligatoire.** La DB de dev n'a aucun média transcodé et
   `FORCED_RENTAL_VIDEO_URL` force les deux versions : les pastilles restent invisibles en dev et le
   cas VO-only est irreproductible. Sur `club.lazone.at`, prendre un film VF-only → la fiche doit
   afficher la pastille VO grisée avec ✕, le player le bouton VO grisé + « VO indisponible », et
   servir la VF. Alternative sans prod : mocker la réponse de `/api/films/[tmdbId]` avec
   `has_vf:true, has_vo:false`.
2. **Historique — testable en dev** avec un compte ayant des locations passées : terminal CRT →
   section HISTORIQUE → titre + date + état (« en cours » / « terminé »), le plus récent en premier.
3. **Décision produit ouverte** : l'historique affiche aujourd'hui les locations **actives** aussi
   (badge « en cours »). À confirmer ou restreindre aux locations terminées.
4. **Sous-titres EN** : branchés dans le sélecteur (boutons STFR / STEN, touche T qui cycle). À
   vérifier en prod sur un film qui a les deux langues — la bascule d'une langue à l'autre est le
   chemin le moins sûr côté navigateur (voir la note textTracks dans `AGENTS.md`).

---

## 3. Chantier B — light-baking (parqué)

État à `00ab7b7` : baking complet derrière `?baked=1`, désactivé par défaut. Corrections de la
dernière session dessus :

- `sign` (knob live) : multiplie l'émissif temps-réel des enseignes, défaut **0.4** → enseignes
  colorées lisibles au lieu de cramées blanc.
- Boîtiers d'enseigne tagués `neonEnclosure` et exclus du catch-all `BakeStrayProps` → métal sombre
  (c'était la cause des « panneaux blancs »).
- Roll-off Reinhard `tone` sur le diffus du catch-all → posters et props plafonnent, plus d'effet
  caisson lumineux.
- `bakeDebugStore` : `merge` du persist qui **préfère la valeur d'URL** au localStorage.

### Pièges qui ont coûté le plus cher

1. **`toneMapped={false}` + baisser l'émissif « un peu » ne change rien au cœur.** Tone mapping
   court-circuité : tant que le canal dominant reste > 1.0, ça clippe pareil (2.4 et 1.32 donnent le
   même cœur saturé) ; seul le halo bloom bouge. Pour calmer réellement une enseigne il faut passer
   **sous ~1.0**, ou agir sur le bloom. Un multiplicateur doux au-dessus du point de clip est invisible.
2. **Captures avant/après invalidées par la persistance.** Comparaison `sign=1.0 / 0.55 / 0` : les
   trois étaient en réalité à 1.0, le `persist` zustand ayant écrasé le `?sign=` de l'URL. Conclusion
   « le knob ne fait rien » évitée de justesse. C'est le même piège que `videoclub-storage`, noté dans
   `AGENTS.md` ; le `merge` a été ajouté à `zone-bake-tuning` depuis.
3. **Mauvaise attribution du « panneau blanc » au bloom.** C'était le catch-all GI éclairant des
   boîtiers gris neutres avec l'irradiance SH du plafond (blanche, dominée par le fluo). Mesurer le
   pixel réel (~RGB 150 gris, pas 240 cramé) et introspecter le matériau avant d'incriminer le bloom.
   Test décisif : couper l'`emissiveNode` en live — si ça noircit, c'est la GI.

---

## 4. Pièges d'environnement (transverses, à relire avant toute vérification)

- **Dev server : `PORT=3001 npm run dev`.** Pas 3000.
- **DB de dev = métadonnées seules**, aucun média transcodé. Inspection en lecture seule :
  `node -e 'const d=require("better-sqlite3")("./zone.db",{readonly:true}); …'`.
- **Playwright / scène 3D** :
  - L'app démarre à l'**extérieur** (un warmup force `currentScene='exterior'` au boot, voir
    `App.tsx`). Pour entrer sans cliquer : `window.__store.getState().setScene('interior')`.
  - Globals exposés hors prod : `window.__camera`, `__store`, `__minitelScreenMesh`,
    `__postProcessing`, `__MR/__MD/__MSPEC/__RICK/__OSPEC/__MDESK`. La caméra **n'est pas parentée à
    la scène** → pour atteindre le scene-root, remonter `.parent` depuis `__minitelScreenMesh`.
  - Poser la caméra : `cam.position.set(...); cam.lookAt(...); cam.updateMatrixWorld()` — ça tient
    tant qu'il n'y a ni pointer-lock ni input.
  - **Readback du canvas WebGPU = noir.** Mesurer sur le PNG sauvé, pas via le canvas.
  - Sessions Playwright longues → le compositeur GPU se dégrade → fermer et rouvrir le navigateur.
- **Build gate** : `next build` échoue sur les erreurs ESLint, pas sur les warnings. Vérifier
  `npx tsc --noEmit` et `npx eslint <fichiers>`. Des warnings `exhaustive-deps` et `any`
  pré-existants sont attendus.
