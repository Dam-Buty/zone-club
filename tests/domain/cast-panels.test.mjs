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
  // Le volume est celui de la TV, jamais un `1` posé au montage : la valeur affichée est le doigt ou la TV, et la
  // TV vient de `cast.volume`.
  assert.ok(!src.includes('defaultValue'), 'le curseur de volume est contrôlé');
  assert.ok(src.includes('tvVolume={cast.volume}'), 'le curseur reçoit le volume de la TV');
  assert.ok(/value=\{volumeShown\(draft, tvVolume\)\}/.test(src), 'et affiche le doigt ou la TV, jamais autre chose');
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
  assert.ok((src.match(/aria-busy=\{/g) ?? []).length >= 5, 'aria-busy sur les trois boutons de transport, le curseur et « Réessayer »');
  // La garde des boutons de transport. Le curseur, lui, ne perd jamais un geste (voir le test du volume).
  assert.ok(/if \(busy\) return/.test(src), 'un appui pendant l\'attente est ignoré');
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
  // Depuis la tâche 6 ces classes n'existent plus qu'ici : le lecteur n'en garde aucune copie.
  const oldCss = read('src/components/player/VHSPlayer.module.css');
  for (const name of ['castingOverlay', 'awaitingCancelBtn', 'nowPlayingTransport']) assert.ok(!oldCss.includes(`.${name}`), `.${name} a quitté la feuille du lecteur`);
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
  // Tâche 7 : la borne a sa propre barre (src/components/kiosk/KioskCastBar.tsx) ; la puce n'est plus montée qu'au
  // vidéoclub, d'où le lecteur s'ouvre, et sa variante « kiosk » est partie.
  assert.ok(/from:\s*'store'/.test(src), 'le lecteur s\'ouvre depuis le vidéoclub');
  assert.ok(!src.includes('variant'), 'plus de prop variant');
  // Les mots de la puce sont écrits à un seul endroit, testé : cast-labels.ts.
  const labels = read('src/cast/cast-labels.ts');
  for (const word of ['TÉLÉCOMMANDE', 'LA TÉLÉ NE RÉPOND PLUS', 'FILM TERMINÉ']) assert.ok(labels.includes(word), word);
});

test('CAST PANNEAUX: cast-labels.ts reste pur, sans import de valeur', () => {
  const src = read('src/cast/cast-labels.ts');
  const imports = src.match(/^import .*$/gm) ?? [];
  for (const line of imports) assert.ok(/^import type /.test(line), `import de valeur : ${line}`);
});

/** Le texte d'une fonction de premier niveau du composant, jusqu'à la suivante. */
function panel(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const next = src.indexOf('\nfunction ', start + 1);
  const exported = src.indexOf('\nexport function ', start + 1);
  const ends = [next, exported].filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('CAST PANNEAUX: le volume suit le doigt, part une seule fois au relâchement, et rend la main à la TV', () => {
  const row = panel(read(PANELS), 'VolumeRow');
  // Le doigt, le clavier et la perte de focus lèvent le geste ; la décision est celle, testée, de cast-labels.
  for (const event of ['onPointerUp', 'onPointerCancel', 'onTouchEnd', 'onKeyUp', 'onBlur']) assert.ok(row.includes(`${event}=`), event);
  assert.ok(row.includes('volumeSettle(') && row.includes('volumeDragged('), 'la décision vient de cast-labels');
  // Le geste n'envoie rien : onChange ne touche pas à la TV.
  const onChange = row.slice(row.indexOf('onChange='), row.indexOf('onPointerUp='));
  assert.ok(!onChange.includes('castVolume('), 'onChange ne commande pas la TV');
  // À défaut de réponse, le curseur revient à la TV après l'accusé, et le minuteur est nettoyé.
  assert.ok(row.includes('CAST_ACK_TIMEOUT_MS'), 'le curseur ne reste jamais sur une valeur que la TV n\'a pas');
  assert.ok(row.includes('clearTimeout('), 'le minuteur est levé au démontage');
  // Une commande en vol qui retombe envoie la valeur gardée.
  assert.ok(/if \(!busy\) run\(false\)/.test(row), 'busy qui retombe → la valeur relâchée part');
});

test('CAST PANNEAUX: « Réessayer » dit qu\'il a entendu, « Continuer » et « Fermer » restent libres', () => {
  const lost = panel(read(PANELS), 'LostPanel');
  assert.ok(lost.includes('retrying'), 'un drapeau local');
  assert.ok(lost.includes('CAST_STATUS_TIMEOUT_MS'), 'il retombe quand la TV a eu le temps de répondre');
  assert.ok(lost.includes('clearTimeout('), 'le minuteur est levé au démontage');
  assert.ok(/aria-busy=\{retrying\}/.test(lost), 'le bouton dit qu\'il attend');
  assert.ok(/if \(retrying\) return/.test(lost), 'un second appui est ignoré');
  assert.ok(lost.includes('nowPlayingBusy'), 'et il s\'estompe');
  // Les deux autres issues ne passent pas par la garde.
  assert.ok(lost.includes('onClick={castToPhone}') && lost.includes('onClick={onBack}'), 'continuer et fermer restent actifs pendant l\'essai');
  assert.ok(lost.includes('Réessayer'), 'le libellé reste « Réessayer »');
});

test('CAST PANNEAUX: une affiche invalide ne fait pas tomber la télécommande', () => {
  const src = read(PANELS);
  const at = src.indexOf('new MediaMetadata(');
  assert.ok(at > 0);
  const before = src.slice(0, at);
  assert.ok(before.lastIndexOf('try {') > before.lastIndexOf('catch'), 'MediaMetadata est construit dans un try');
  // Et les commandes de l'écran verrouillé se posent même si l'affiche est refusée : un try chacun.
  assert.ok((src.match(/\btry \{/g) ?? []).length >= 3, 'métadonnées, pose des commandes, retrait des commandes');
});

test('CAST PANNEAUX: chaque zone de toucher fait au moins 44 px de haut', () => {
  const css = read(CSS);
  /** La plus grande hauteur, en px, que la règle `.name { … }` pose (height ou min-height). */
  const heightOf = (name) => {
    const body = css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(body, `.${name} manque dans la feuille`);
    const px = [...body.matchAll(/(?:^|[\s;])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    return px.length ? Math.max(...px) : 0;
  };
  for (const name of ['nowPlayingBtn', 'nowPlayingSecondaryBtn', 'awaitingCancelBtn', 'lostBtn', 'nowPlayingVolumeSlider']) {
    assert.ok(heightOf(name) >= 44, `.${name} : ${heightOf(name)} px, il en faut 44`);
  }
  // Tout bouton du composant a pour classe de base l'une de celles-là : aucune n'échappe au minimum.
  const covered = new Set(['nowPlayingBtn', 'nowPlayingSecondaryBtn', 'awaitingCancelBtn']);
  const buttons = [...read(PANELS).matchAll(/<button\b[^>]*?className=\{`?\$?\{?styles\.(\w+)/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 8, `les boutons du composant sont comptés (${buttons.length})`);
  for (const base of buttons) assert.ok(covered.has(base), `le bouton de classe ${base} n'a pas de minimum de 44 px`);
  // La piste dessinée reste mince : c'est l'input qui porte la zone de prise.
  assert.ok(/\.nowPlayingVolumeSlider::-webkit-slider-runnable-track/.test(css) && /\.nowPlayingVolumeSlider::-moz-range-track/.test(css), 'piste dessinée au centre de la zone de prise');
});

test('CAST PANNEAUX: la puce dessine son point et sa respiration d\'après castChipLook', () => {
  const src = read(CHIP);
  assert.ok(src.includes('castChipLook('), 'le choix par phase vient de cast-labels');
  assert.ok(/look\.pulse \? 'activeCastChipPulse/.test(src), 'la respiration ne tourne que si la phase le veut');
  assert.ok(/look\.dot !== null/.test(src), 'sans point quand il n\'y a rien à dire');
});
