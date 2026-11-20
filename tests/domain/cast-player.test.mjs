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
  // La règle est localAutoPlay (cast-on-open, testée) : la vidéo a la main, invite répondue, sans lancement raté (B4, B5, B9).
  // Calculée une fois : la même valeur arme la lecture automatique et le délai « rien ne vient » (usePlaybackFailure).
  assert.match(src, /const playWanted = localAutoPlay\(\{ view, prompt: showMobileRemotePrompt, rewind: rewindPhase !== 'none', castHeld: castFailedHere, pending: castPendingHere \}\);/, 'autoPlay seulement quand la vidéo a la main, invite répondue, sans lancement raté');
  assert.ok(src.includes('autoPlay={playWanted}'), 'la vidéo part selon cette règle');
  assert.ok(src.includes('wanted: playWanted'), 'le délai « rien ne vient » ne court que sous la même règle');
  // L'invite est calculée dès le premier rendu : la vidéo ne doit pas partir avant elle.
  assert.match(src, /useState\(\(\) => isMobile && playsHere\(view\) && \(playerAsk \|\| castFailedHere\)\)/, 'invite à l\'ouverture');
  assert.ok(callback(src, 'handleWatchHere').includes('.play()'), '« Continuer sur ce téléphone » lance la lecture');
});

// Relecture de la tâche 6 (arbitrage H) : les trois gardes ci-dessous échouent sur le code d'avant le correctif 1.
test('CAST LECTEUR: la vidéo locale se tait dès que la TV a le film, le prend OU vient de le finir', () => {
  const src = read(PLAYER);
  // Fin vue par la TV : « BE KIND REWIND » ne doit pas couvrir une vidéo qui joue avec le son (page rechargée).
  // playsHere (cast-on-open, testée) : seules « local » et « other-on-tv » laissent la main à la vidéo d'ici — « ended » non.
  assert.match(src, /const tvOwnsFilm = !playsHere\(view\);/, 'tvOwnsFilm compte aussi la vue « ended »');
  const at = src.indexOf('if (!tvOwnsFilm) return;');
  assert.ok(at > 0, 'un effet se règle sur tvOwnsFilm');
  assert.ok(src.slice(at, at + 300).includes('.pause()'), 'et met la vidéo locale en pause');
  // Un lancement raté (même vu à l'ouverture, même au bureau) : pause explicite, la lecture automatique est désarmée.
  assert.match(src, /if \(castFailedHere\) videoRef\.current\?\.pause\(\);/, 'pause sur un lancement raté');
});

test('CAST LECTEUR: « Regarder sur TV » met d\'abord la vidéo d\'ici en pause, quelle que soit la suite', () => {
  // Sans pause(), sur `no_source`, `unavailable` ou AirPlay, un élément qui n'a rien joué gardait sa lecture automatique.
  const body = callback(read(PLAYER), 'handleWatchOnTV');
  assert.match(body, /^const handleWatchOnTV = useCallback\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*videoRef\.current\?\.pause\(\);/, 'pause() avant toute autre chose');
});

test('CAST LECTEUR: une seule décision pour « BE KIND REWIND », ÉJECTER à la fin vue par la TV', () => {
  const src = read(PLAYER);
  // Deux effets écrivaient pendingEject (la fin : vrai ; « l'ouverture » : faux, qui gagnait) : un seul décide.
  assert.equal(src.split('rewindPromptFor(').length - 1, 1, 'une seule décision');
  assert.match(src, /tv: view === 'ended' \? 'ended'/, 'la décision connaît la fin vue par la TV');
  assert.ok(src.includes("setPendingEject(decision === 'eject')"), 'ÉJECTER ou NON MERCI selon la décision');
  // Hors de la décision, seul STOP (lecture locale à 80 %) ouvre une proposition NON MERCI.
  const nonMerci = /setPendingEject\(false\);\s*setRewindPhase\('prompt'\)/g;
  assert.equal((src.match(nonMerci) ?? []).length, 1, 'une seule proposition NON MERCI hors décision');
  assert.match(callback(src, 'handleStop'), nonMerci, 'et c\'est celle de STOP');
  assert.ok(!/useEffect\(\(\) => \{\s*if \(view !== 'ended'/.test(src), 'plus d\'effet de fin séparé');
});

test('CAST LECTEUR: rien de périmé ne reparaît, les lignes du Cast restent à portée', () => {
  const src = read(PLAYER);
  assert.match(src, /if \(view !== 'remote'\) setRemoteError\(prev => \(prev === TV_SUBTITLE_ERROR \? null : prev\)\);/, 'erreur de sous-titres effacée hors télécommande');
  assert.match(src, /if \(view !== 'other-on-tv'\) setConfirmReplace\(false\);/, 'la question « Remplacer » tombe avec son bandeau');
  assert.match(src, /const castLineShown = view === 'other-on-tv' \|\| \(noticeHere !== null && !castMissing\);/, 'ligne du Cast affichée');
  assert.match(src, /if \(checkPortraitMobile\(\) \|\| remoteActive \|\| castLineShown\) disableAutoHide\(\);/, 'l\'en-tête ne se masque pas sous une ligne du Cast');
});

test('CAST LECTEUR: la reprise, la fin, le clavier', () => {
  const src = read(PLAYER);
  assert.ok(/takeCastResume\(currentPlayingFilm\)/.test(src), 'la reprise locale est prise une fois');
  assert.ok(/position \?\? rental\?\.watchPosition/.test(src), 'position inconnue → celle de la location');
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

// Relecture finale, A3 : sans location le lecteur ne dessine rien ; il se ferme de lui-même une fois les données
// relues (la décision est la fonction testée de cast-on-open), et prévient la machine — un Cast de ce film s'arrête,
// « Location terminée ». Échap le ferme même sans <video> monté.
test('CAST LECTEUR A3: ouvert sans location, il se ferme lui-même et Échap fonctionne sans vidéo', () => {
  const src = read(PLAYER);
  assert.match(src, /playerWithoutRental\(\{\s*open: isPlayerOpen,\s*hasRental,\s*fresh: rentalFreshFor === currentPlayingFilm\s*\}\)/, 'la décision est la fonction testée, après la relecture');
  // La présence de la location est un ABONNEMENT au magasin : getRental est une fonction stable, et un lecteur qui ne
  // lit la location qu'au rendu ne se redessine pas quand elle quitte `rentals` (vu à l'écran le 19/11 : il restait ouvert).
  assert.match(src, /const hasRental = useStore\(state => state\.currentPlayingFilm !== null && state\.getRental\(state\.currentPlayingFilm\) !== undefined\);/, 'présence de la location lue par abonnement');
  const at = src.indexOf('if (!withoutRental) return;');
  assert.ok(at > 0, 'un effet se règle sur elle');
  const effect = src.slice(at, at + 400);
  assert.ok(effect.includes('castRentalGone(') && effect.includes('closePlayer()'), 'la machine est prévenue, le lecteur se ferme');
  assert.ok(effect.indexOf('castRentalGone(') < effect.indexOf('closePlayer()'), 'la machine d\'abord');
  // Échap avant `if (!video) return;` : le lecteur sans location n'a pas de vidéo.
  const keys = src.slice(src.indexOf('const handleKeyDown'), src.indexOf("window.addEventListener('keydown', handleKeyDown)"));
  const escape = keys.indexOf("if (e.key === 'Escape') {", keys.indexOf('if (rewindPhase !== \'none\')'));
  const noVideo = keys.indexOf('if (!video) return;');
  assert.ok(escape > 0 && noVideo > escape, 'Échap est traité avant le garde « pas de vidéo »');
  assert.ok(keys.slice(escape, noVideo).includes('handleEject()'), 'Échap éjecte');
});

// Relecture finale, B4 / B5 / B9 / B13 : la lecture automatique suit une règle pure (cast-on-open) ; le Cast connu
// indisponible retient la vidéo comme un lancement raté ; le film mémorisé attendu aussi ; l'invite dit l'appareil.
test('CAST LECTEUR B4 / B5 / B9: lecture automatique par la règle testée, film mémorisé attendu compris', () => {
  const src = read(PLAYER);
  assert.match(src, /const playWanted = localAutoPlay\(\{ view, prompt: showMobileRemotePrompt, rewind: rewindPhase !== 'none', castHeld: castFailedHere, pending: castPendingHere \}\);/, 'autoPlay = localAutoPlay');
  assert.ok(src.includes('autoPlay={playWanted}'), 'autoPlay = playWanted');
  assert.match(src, /const castPendingHere = useStore\(state => castPending\(state\.cast, state\.currentPlayingFilm, state\.lastCastFilmId\)\);/, 'castPending lu dans la machine, avec le film mémorisé');
  assert.match(src, /const castFailedHere = noticeHere !== null && noticeHoldsPlayback\(noticeHere\.code\);/, 'Cast raté OU absent : même règle');
  assert.match(src, /useState\(\(\) => isMobile && playsHere\(view\) && \(playerAsk \|\| castFailedHere\)\)/, 'invite à l\'ouverture, même règle pour un autre film sur la TV');
  assert.match(src, /const tvOwnsFilm = !playsHere\(view\);/, 'la vidéo d\'ici se tait exactement quand elle ne joue pas ici');
});
test('CAST LECTEUR B13: l\'invite dit « Continuer sur ce téléphone / cette tablette / cet ordinateur »', () => {
  const src = read(PLAYER);
  assert.ok(!src.includes('Continuer sur smartphone'), 'plus de libellé en dur');
  assert.ok(src.includes('continueHereLabel(here)'), 'le libellé des panneaux');
  assert.ok(/const \[here\] = useState\(readHereLabel\)/.test(src), 'l\'appareil lu comme les panneaux le lisent');
  assert.ok(/export function readHereLabel\(/.test(read('src/components/player/CastPanels.tsx')), 'une seule lecture de l\'appareil');
});
