import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

// Le lecteur (src/components/player/VHSPlayer.tsx) ne décide plus rien du Cast : il lit la tranche `cast` du magasin et
// demande par ses actions (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.4). Avant, cinq effets et deux
// gestionnaires y écrivaient le même état et se contredisaient (D1 à D4). Gardes statiques : ce texte ne doit pas revenir.

const ROOT = process.cwd();
const read = (rel) => readText(path.join(ROOT, rel));
const PLAYER = 'src/components/player/VHSPlayer.tsx';
const NOTICES = 'src/components/player/CastNotices.tsx';
/** Longueur du lecteur au commit cd61350, avant la refonte : il doit maigrir, pas se compliquer autrement. */
const PLAYER_LINES_BEFORE = 2125;

/** Le texte d'un `useCallback` du lecteur, de sa déclaration à la suivante. */
function callback(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const next = src.indexOf('\n  const ', start + 1);
  return src.slice(start, next > 0 ? next : undefined);
}

test('CAST LECTEUR: plus rien de l\'ancien Cast du lecteur', () => {
  const src = read(PLAYER);
  for (const gone of ['useGoogleCast', 'awaitingCast', 'wasCastConnectedRef', 'lastKnownCastTimeRef', 'remoteStop', '6000']) {
    assert.ok(!src.includes(gone), `VHSPlayer.tsx contient encore ${gone}`);
  }
  for (const gone of ['setActiveCastFilmId', 'endCast', 'castOnOpen', 'shouldStartCastOnOpen', 'preloadCastSdk']) {
    assert.ok(!src.includes(gone), `VHSPlayer.tsx contient encore ${gone}`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/hooks/useGoogleCast.ts')), 'le crochet useGoogleCast est supprimé');
});

test('CAST LECTEUR: il lit la machine, monte les panneaux, et dit d\'où l\'on vient', () => {
  const src = read(PLAYER);
  for (const needle of ['castView(', 'takeCastResume', '<CastPanels', 'RETOUR À LA BORNE', 'RETOUR VIDÉOCLUB']) {
    assert.ok(src.includes(needle), `VHSPlayer.tsx doit contenir ${needle}`);
  }
  // « Retour » de la télécommande, « Fermer » de la liaison perdue : le lecteur se ferme, la TV continue.
  assert.ok(src.includes('onBack={closePlayer}'), 'le retour de la télécommande ferme le lecteur');
  assert.ok(src.includes("playerFrom === 'kiosk'"), 'le libellé du retour suit l\'origine du lecteur');
});

test('CAST LECTEUR: il maigrit', () => {
  const lines = (read(PLAYER).match(/\n/g) ?? []).length;
  assert.ok(lines < PLAYER_LINES_BEFORE, `VHSPlayer.tsx compte ${lines} lignes, il en comptait ${PLAYER_LINES_BEFORE}`);
});

test('CAST LECTEUR: l\'état du lecteur ne connaît plus le Cast', () => {
  const line = read('src/types/index.ts').split('\n').find((l) => l.includes('export type PlayerState'));
  assert.ok(line, 'PlayerState introuvable');
  assert.ok(!line.includes("'casting'") && !line.includes("'awaitingCast'"), `PlayerState : ${line}`);
});

test('CAST LECTEUR: le service démarre au montage, la demande part dans la pile de l\'appui', () => {
  const src = read(PLAYER);
  // Filet de sécurité de /admin, où le lecteur est monté hors de l'application : une seule initialisation réelle.
  assert.match(src, /useEffect\(\(\) => \{\s*startCast\(\);\s*\}, \[startCast\]\);/, 'startCast() au montage');
  // Le sélecteur d'appareils exige l'activation de l'appui : aucune attente avant castFilm.
  const send = callback(src, 'sendToTv');
  assert.ok(send.includes('castFilm('), 'sendToTv demande castFilm');
  assert.ok(!/\bawait\b|\basync\b|\.then\(/.test(send), 'sendToTv n\'attend rien avant castFilm');
  assert.ok(/audio: audioTrack/.test(send) && /subtitle: subtitleTrack/.test(send), 'avec la piste et les sous-titres d\'ici');
  assert.match(send, /startAt: Math\.max\(/, 'et la position d\'ici ou de la location');
  // Apple garde AirPlay, un autre film sur la TV demande confirmation.
  const watch = callback(src, 'handleWatchOnTV');
  assert.ok(watch.includes('appleAirPlay(navigator.userAgent, videoRef.current') && watch.includes('handleAirPlayPicker()'), 'Apple → AirPlay');
  assert.ok(watch.includes("view === 'other-on-tv'") && watch.includes('setConfirmReplace(true)'), 'autre film sur la TV → confirmation');
});

test('CAST LECTEUR: jamais de lecture locale lancée d\'office, jamais sur les deux écrans', () => {
  const src = read(PLAYER);
  assert.match(src, /autoPlay=\{view === 'local' && !showMobileRemotePrompt && rewindPhase === 'none'\}/, 'autoPlay seulement en local, invite répondue');
  // L'invite est calculée dès le premier rendu : la vidéo ne doit pas partir avant elle.
  assert.match(src, /useState\(\(\) => isMobile && playerAsk && view === 'local'\)/, 'invite à l\'ouverture');
  assert.ok(callback(src, 'handleWatchHere').includes('.play()'), '« Continuer sur smartphone » lance la lecture');
  // La TV prend le film : la vidéo locale se tait.
  const takeover = src.slice(src.indexOf('if (!remoteActive) return;'), src.indexOf('if (!remoteActive) return;') + 400);
  assert.ok(takeover.includes('.pause()'), 'la vidéo locale se met en pause quand la TV prend le film');
});

test('CAST LECTEUR: la reprise, la fin, le clavier', () => {
  const src = read(PLAYER);
  assert.ok(/takeCastResume\(currentPlayingFilm\)/.test(src), 'la reprise locale est prise une fois');
  assert.ok(/position \?\? rental\?\.watchPosition/.test(src), 'position inconnue → celle de la location');
  // Fin du film sur la TV : la proposition de rembobinage, puis la machine oublie le film terminé.
  assert.ok(/view !== 'ended'/.test(src) && src.includes("setRewindPhase('prompt')"), 'BE KIND REWIND à la fin vue par la TV');
  assert.ok(callback(src, 'ejectAfterPrompt').includes('castDismiss()'), 'proposition fermée → castDismiss');
  // Pendant un Cast, Échap et E ferment le lecteur, la TV continue.
  const keys = src.slice(src.indexOf('if (remoteActive) {', src.indexOf('handleKeyDown')), src.indexOf('if (rewindingToStart)', src.indexOf('handleKeyDown')));
  assert.ok(keys.includes("e.key === 'Escape'") && keys.includes("e.key === 'e'") && keys.includes('closePlayer()'), 'Échap / E → closePlayer');
  assert.ok(!keys.includes('handleEject') && !keys.includes('handleStop'), 'jamais l\'éjection locale pendant un Cast');
});

test('CAST LECTEUR: les messages et le bandeau d\'un autre film viennent des libellés purs', () => {
  const notices = read(NOTICES);
  assert.ok(notices.includes('castNoticeView(') && notices.includes('castOtherFilmText('), 'les textes viennent de cast-labels');
  assert.ok(notices.includes('castDismiss'), 'chaque message se ferme');
  assert.ok(!/disabled/i.test(notices), 'aucun bouton grisé');
  const src = read(PLAYER);
  assert.ok(src.includes('<CastNoticeLine') && src.includes('<OtherFilmBanner'), 'le lecteur pose la ligne et le bandeau');
  assert.ok(src.includes('onRetry={sendToTv}'), '« Réessayer » relance castFilm dans l\'appui');
  assert.ok(src.includes('CAST_UNAVAILABLE_TEXT'), 'le panneau « recopie d\'écran » dit que le Cast manque');
});

test('CAST LECTEUR: les styles du Cast ont quitté la feuille du lecteur, aucune classe employée ne manque', () => {
  const css = read('src/components/player/VHSPlayer.module.css');
  for (const prefix of ['castingOverlay', 'casting', 'awaiting', 'nowPlaying']) {
    assert.ok(!new RegExp(`\\.${prefix}\\w*\\s*[{,:]`).test(css), `VHSPlayer.module.css garde une règle .${prefix}…`);
  }
  for (const name of new Set([...read(PLAYER).matchAll(/\bstyles\.(\w+)/g)].map((m) => m[1]))) {
    assert.ok(new RegExp(`\\.${name}\\b`).test(css), `.${name} manque dans VHSPlayer.module.css`);
  }
  const castCss = read('src/components/player/CastPanels.module.css');
  for (const name of new Set([...read(PLAYER).matchAll(/\bcastStyles\.(\w+)/g)].map((m) => m[1]))) {
    assert.ok(new RegExp(`\\.${name}\\b`).test(castCss), `.${name} manque dans CastPanels.module.css`);
  }
});
