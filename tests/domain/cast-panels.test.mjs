import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

// Les panneaux du Cast (src/components/player/CastPanels.tsx) et la puce flottante (ActiveCastIndicator.tsx) lisent
// le magasin au lieu d'un état local. Gardes statiques, pour ce que seul le texte des composants peut montrer ;
// les décisions sans React (libellés, formats) sont testées pour de bon dans cast-labels.test.mjs.

const ROOT = process.cwd();
const read = (rel) => readText(path.join(ROOT, rel));
const PANELS = 'src/components/player/CastPanels.tsx';
const CSS = 'src/components/player/CastPanels.module.css';
const CHIP = 'src/components/player/ActiveCastIndicator.tsx';

test('CAST PANNEAUX: ni curseur sans état, ni bouton grisé, ni l\'ancien crochet', () => {
  const src = read(PANELS);
  // Le volume est celui de la TV (`value`), jamais un `1` posé au montage.
  assert.ok(!src.includes('defaultValue'), 'le curseur de volume est contrôlé par cast.volume');
  assert.ok(src.includes('value={cast.volume}'), 'le curseur lit le volume de la TV');
  // Un bouton grisé avale l'appui sur mobile sans rien dire : un bouton en attente porte aria-busy.
  assert.ok(!/disabled/i.test(src), 'aucun bouton grisé par l\'attribut du navigateur');
  assert.ok(!src.includes('useGoogleCast'), 'le crochet du SDK n\'est plus lu par les panneaux');
  assert.ok(!src.includes('preloadCastSdk'), 'le SDK est chargé par le service, pas par les panneaux');
});

test('CAST PANNEAUX: la liaison perdue a ses trois issues, la télécommande son attente', () => {
  const src = read(PANELS);
  assert.ok(src.includes('La télé ne répond plus'), 'le titre de la liaison perdue');
  for (const label of ['Réessayer', 'Fermer', 'Annuler']) assert.ok(src.includes(label), `le bouton « ${label} »`);
  for (const action of ['castRetry', 'castToPhone', 'castCancel', 'castStop', 'castToggle', 'castSeekBy', 'castVolume']) {
    assert.ok(src.includes(action), `${action} est demandé au magasin`);
  }
  // Un seul appui à la fois : le bouton dit qu'il attend, et son gestionnaire ne fait rien.
  assert.ok((src.match(/aria-busy=\{/g) ?? []).length >= 4, 'aria-busy sur les trois boutons de transport et le curseur');
  // Deux gardes : celle des boutons de transport (`press`) et celle du curseur de volume.
  assert.ok((src.match(/if \(busy\) return/g) ?? []).length >= 2, 'un appui pendant l\'attente est ignoré, boutons et curseur');
  assert.ok(/onClick=\{press\(\(\) => castSeekBy\(-15\)\)\}/.test(src) && /onClick=\{press\(\(\) => castSeekBy\(15\)\)\}/.test(src) && /onClick=\{press\(castToggle\)\}/.test(src), 'les trois boutons de transport passent par la garde');
});

test('CAST PANNEAUX: le bouton central montre ce qu\'il fera, la télé dit si elle est en pause', () => {
  const src = read(PANELS);
  assert.ok(/cast\.paused \? 'Lecture' : 'Pause'/.test(src), '▶ « Lecture » quand la TV est en pause, ⏸ « Pause » sinon');
  assert.ok(/cast\.paused \? '▶' : '⏸'/.test(src));
});

test('CAST PANNEAUX: la rangée du bas — retour, ici, arrêter — suit l\'origine du lecteur', () => {
  const src = read(PANELS);
  assert.ok(src.includes('playerFrom'), 'l\'origine vient du magasin');
  assert.ok(src.includes('castBackLabel('), 'le libellé du retour suit l\'origine');
  assert.ok(src.includes('watchHereLabel('), 'le libellé « ici » suit l\'appareil, comme sur la borne');
  assert.ok(src.includes('continueHereLabel('), 'et la liaison perdue en tire son « Continuer sur … »');
  // L'ordre à l'écran : retour, ici, arrêter.
  const back = src.indexOf('onClick={onBack}');
  const here = src.indexOf('onClick={castToPhone}');
  const stop = src.indexOf('onClick={castStop}');
  assert.ok(back >= 0 && here > back && stop > here, 'retour, puis « ici », puis « Arrêter »');
});

test('CAST PANNEAUX: les panneaux se choisissent par castView, rien n\'est lu à la main', () => {
  const src = read(PANELS);
  assert.ok(/castView\(\s*cast\s*,\s*filmId\s*\)/.test(src), 'castView(cast, filmId) décide du panneau');
  assert.ok(!src.includes('activeCastFilmId'), 'le champ dérivé n\'est pas la source');
  // Une seule fois dans src/ : c'est le service qui le fait (cast-service-wiring).
  assert.ok(!src.includes('setOptions('));
});

test('CAST PANNEAUX: sélecteurs individuels, jamais le magasin entier', () => {
  for (const rel of [PANELS, CHIP]) {
    const src = read(rel);
    const calls = src.match(/useStore\(/g) ?? [];
    const single = src.match(/useStore\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.\w+\s*\)/g) ?? [];
    assert.ok(calls.length > 0, `${rel} lit le magasin`);
    assert.equal(single.length, calls.length, `${rel} : chaque useStore( lit un seul champ`);
  }
});

test('CAST PANNEAUX: les commandes de l\'écran verrouillé suivent la télécommande', () => {
  const src = read(PANELS);
  assert.ok(src.includes('navigator.mediaSession'));
  assert.ok(src.includes("setActionHandler('play'") && src.includes("setActionHandler('pause'") && src.includes("setActionHandler('stop'"));
  assert.ok(/view === 'remote'/.test(src), 'posées seulement pendant la télécommande');
  assert.ok(src.includes('metadata = null'), 'et retirées quand elle se ferme');
  assert.ok(src.includes("artist: 'Zone Club'"));
});

test('CAST PANNEAUX: la feuille de style porte toutes les classes que le composant emploie', () => {
  const css = read(CSS);
  const used = new Set([...read(PANELS).matchAll(/styles\.(\w+)/g)].map((m) => m[1]));
  assert.ok(used.size > 10, 'le composant emploie des classes de la feuille');
  for (const name of used) assert.ok(new RegExp(`\\.${name}\\b`).test(css), `.${name} manque dans CastPanels.module.css`);
  // Les anciennes classes restent dans VHSPlayer.module.css jusqu'à la tâche 6 : on COPIE, on ne déplace pas encore.
  const oldCss = read('src/components/player/VHSPlayer.module.css');
  for (const name of ['castingOverlay', 'awaitingCancelBtn', 'nowPlayingTransport']) assert.ok(oldCss.includes(`.${name}`), `.${name} reste dans l'ancien lecteur`);
  // Pas de bouton qui disparaisse sans le dire : l'attente s'estompe, elle ne bloque pas le toucher en silence.
  assert.ok(/\.nowPlayingBusy\b/.test(css), 'un état « en attente » estompé');
});

test('CAST PANNEAUX: la puce lit la machine, dit son état, et rouvre le lecteur sans invite', () => {
  const src = read(CHIP);
  assert.ok(!src.includes('activeCastFilmId'), 'le champ dérivé est nul à la fin du film : la puce lit la machine');
  assert.ok(src.includes('castOwnsFilm('), 'le film à signaler vient de la machine');
  assert.ok(src.includes('castChipLabel('), 'le mot de droite vient des libellés');
  assert.ok(/from '\.\.\/\.\.\/cast\/cast-labels'/.test(src));
  assert.ok(/ask:\s*false/.test(src), 'rouvrir la télécommande ne repose pas la question « Regarder sur TV ? »');
  assert.ok(/from:\s*variant === 'kiosk' \? 'kiosk' : 'store'/.test(src), 'l\'origine suit la variante');
  assert.ok(/variant\?: 'store' \| 'kiosk'/.test(src) && /variant = 'store'/.test(src), 'prop variant, « store » par défaut');
  // Les mots de la puce sont écrits à un seul endroit, testé : cast-labels.ts.
  const labels = read('src/cast/cast-labels.ts');
  for (const word of ['TÉLÉCOMMANDE', 'LA TÉLÉ NE RÉPOND PLUS', 'FILM TERMINÉ']) assert.ok(labels.includes(word), word);
});

test('CAST PANNEAUX: cast-labels.ts reste pur, sans import de valeur', () => {
  const src = read('src/cast/cast-labels.ts');
  const imports = src.match(/^import .*$/gm) ?? [];
  for (const line of imports) assert.ok(/^import type /.test(line), `import de valeur : ${line}`);
});
