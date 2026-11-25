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
/** Longueur du lecteur au commit d6cf82f, avant la tâche 8 des versions : la décision unique le fait maigrir. */
const PLAYER_LINES_BEFORE_VERSION = 1718;
/** Ce qui retient la vidéo d'ici hors de la question des sous-titres, puis la règle complète (localAutoPlay). */
const PLAY_HOLDS = /const playHolds = \{ view, prompt: showMobileRemotePrompt, rewind: rewindPhase !== 'none', castHeld: castFailedHere, pending: castPendingHere \};/;
const PLAY_WANTED = /const playWanted = localAutoPlay\(\{ \.\.\.playHolds, question: asking \}\);/;

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
  assert.match(send, /version: version \?\? undefined/, 'avec la version que joue le lecteur (la décision unique)');
  assert.match(send, /startAt: swapResumeTime\(/, 'et la position d\'ici ou de la location, à la règle de l\'appareil');
  // Apple garde AirPlay, un autre film sur la TV demande confirmation.
  const watch = callback(src, 'handleWatchOnTV');
  assert.ok(watch.includes('appleAirPlay(navigator.userAgent, videoRef.current') && watch.includes('handleAirPlayPicker()'), 'Apple → AirPlay');
  assert.ok(watch.includes("view === 'other-on-tv'") && watch.includes('setConfirmReplace(true)'), 'autre film sur la TV → confirmation');
});

test('CAST LECTEUR: jamais de lecture locale lancée d\'office, jamais sur les deux écrans', () => {
  const src = read(PLAYER);
  // La règle est localAutoPlay (cast-on-open, testée) : la vidéo a la main, invite répondue, sans lancement raté (B4, B5, B9),
  // question des sous-titres répondue (tâche 8). Calculée une fois : la même valeur arme la lecture automatique et le
  // délai « rien ne vient » (usePlaybackFailure).
  assert.match(src, PLAY_HOLDS, 'ce qui retient la vidéo d\'ici, hors de la question');
  assert.match(src, PLAY_WANTED, 'autoPlay seulement quand la vidéo a la main, invite et question répondues, sans lancement raté');
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
  // Un lancement raté (même vu à l'ouverture, même au bureau), ou la question des sous-titres : pause explicite, la
  // lecture automatique est désarmée.
  assert.match(src, /if \(castFailedHere \|\| asking\) videoRef\.current\?\.pause\(\);/, 'pause sur un lancement raté ou sous la question');
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
  // Ni sous une ligne du Cast, ni sans version lisible (relecture d'ensemble de la partie A, I4) : la note « Ce film n'a
  // aucune version lisible pour le moment. » disparaissait au bout de 4 s, et l'écran restait noir.
  assert.match(src, /if \(checkPortraitMobile\(\) \|\| remoteActive \|\| castLineShown \|\| version === null\) disableAutoHide\(\);/, 'l\'en-tête ne se masque pas sous une ligne du Cast ni sans version');
  const effect = src.slice(src.indexOf('|| version === null) disableAutoHide();'), src.indexOf(']);', src.indexOf('|| version === null) disableAutoHide();')));
  assert.match(effect, /\}, \[[^\]]*\bversion\b/, 'l\'effet suit la version');
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
  assert.match(src, PLAY_HOLDS, 'les retenues de localAutoPlay');
  assert.match(src, PLAY_WANTED, 'autoPlay = localAutoPlay');
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

// Tâche 8 des versions (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.1, 4.3 b et 4.4) : le lecteur ne tient plus
// ses propres pistes. Il part de la décision unique (usePlayerVersion), offre un seul bouton « Version », pose la question
// des sous-titres quand on l'ouvre hors de la borne, et la vie de l'élément <video> remonté vit dans useVideoLifecycle.
const CONTROLS = 'src/components/player/VHSControls.tsx';
const PLAYER_VERSION = 'src/components/player/usePlayerVersion.ts';
const VERSION_PANEL = 'src/components/player/PlayerVersionPanel.tsx';

test('VERSION LECTEUR: plus d\'états de piste, plus de recalage, une seule décision', () => {
  const src = read(PLAYER);
  for (const gone of ['useState<AudioTrack>', 'useState<SubtitleTrack>', 'getVideoUrl', 'handleAudioTrackChange', 'handleSubtitleTrackChange', 'cycleSubtitleTrack', 'availableSubtitles', 'setAudioTrack', 'setSubtitleTrack']) {
    assert.ok(!src.includes(gone), `VHSPlayer.tsx contient encore ${gone}`);
  }
  assert.ok(src.includes('usePlayerVersion(currentPlayingFilm, streamingUrls)'), 'la version vient de usePlayerVersion');
  assert.ok(src.includes('useVideoLifecycle({'), 'la fin et la reprise viennent de useVideoLifecycle');
  // Aucun autre code ne choisit « vf » d'office, et rien ici n'écrit la version préférée du compte.
  assert.ok(!/\?\? 'vf'|\?\? 'fr'/.test(src), 'plus de repli « vf » / « fr »');
  assert.ok(!src.includes('setVersionPref'), 'le lecteur n\'écrit jamais la version préférée');
  const lines = (src.match(/\n/g) ?? []).length;
  assert.ok(lines < PLAYER_LINES_BEFORE_VERSION, `VHSPlayer.tsx compte ${lines} lignes, il en comptait ${PLAYER_LINES_BEFORE_VERSION}`);
});

test('VERSION LECTEUR: la key suit la piste, V et T changent la version de ce film, « Essayer en … » aussi', () => {
  const src = read(PLAYER);
  assert.ok(src.includes('const videoKey = `${version?.audio}-${videoUrl}-${attempt}`;'), 'key = piste, adresse, essai');
  const keys = src.slice(src.indexOf('const handleKeyDown'), src.indexOf("window.addEventListener('keydown', handleKeyDown)"));
  assert.match(keys, /case 'V':\s*cycleAudio\(\);/, 'V → cycleAudio');
  assert.match(keys, /case 'T':\s*cycleSubtitle\(\);/, 'T → cycleSubtitle');
  // Le panneau d'échec passe par le choix de CE film (jamais la préférence) : rouvert, le film part dans cette version.
  assert.ok(src.includes('onTryOther={choose}'), '« Essayer en … » = choose');
  // La vidéo locale lit l'adresse de la version décidée, et rien d'autre.
  assert.ok(src.includes('const videoUrl = (version && streamingUrls?.[version.audio]) || \'\';'), 'adresse de la version décidée');
});

test('VERSION LECTEUR: la question des sous-titres, posée par le lecteur, retient la vidéo et passe avant l\'invite', () => {
  const src = read(PLAYER);
  assert.match(src, /const asking = question !== null && playsHere\(view\);/, 'la question, seulement quand la vidéo joue ici');
  assert.ok(src.includes("view={asking ? 'question' : 'list'}"), 'le même panneau porte la liste et la question');
  assert.ok(src.includes('showMobileRemotePrompt && !asking'), 'l\'invite « Regarder sur TV ? » attend la réponse');
  // La réponse est le choix de ce film ; même piste audio, même élément : la vidéo part si rien d'autre ne la retient.
  const answer = src.slice(src.indexOf('const answerQuestion'), src.indexOf('\n  };', src.indexOf('const answerQuestion')));
  assert.ok(answer.includes('choose(v)'), 'la réponse passe par choose');
  assert.ok(answer.includes('localAutoPlay({ ...playHolds, question: false })') && answer.includes('.play()'), 'la réponse lance la lecture si rien d\'autre ne la retient');
});

test('VERSION LECTEUR: VHSControls — un bouton « Version », ni STFR, ni bouton grisé', () => {
  const controls = read(CONTROLS);
  // Les boutons STFR / STEN (le mot seul : « VOSTFR » est un nom de version, il peut rester).
  for (const gone of [/\bSTFR\b/, /\bSTEN\b/, /\bhasVF\b/, /\bhasSubtitlesFr\b/, /\bonAudioTrackChange\b/, /\bonSubtitleTrackChange\b/]) {
    assert.ok(!gone.test(controls), `VHSControls.tsx contient encore ${gone}`);
  }
  assert.ok(!/disabled/i.test(controls), 'VHSControls.tsx contient disabled');
  assert.ok(controls.includes('Version') && controls.includes('versionLabel') && controls.includes('onOpenVersion'), 'le bouton « Version » et le nom courant');
  const src = read(PLAYER);
  assert.ok(src.includes('versionLabel={') && src.includes('onOpenVersion={'), 'le lecteur les passe');
});

test('VERSION LECTEUR: usePlayerVersion lit la décision hors de tout sélecteur, et n\'écrit que le choix du film', () => {
  const hook = read(PLAYER_VERSION);
  // versionDecisionFor rend un objet neuf à chaque appel : en sélecteur du magasin, ce serait une boucle de rendus.
  assert.ok(!/useStore\([^)]*versionDecisionFor/.test(hook), 'jamais versionDecisionFor en sélecteur');
  assert.match(hook, /useMemo\(\s*\(\) => \(filmId === null \? null : versionDecisionFor\(useStore\.getState\(\), filmId\)\)/, 'décision relue dans un useMemo');
  assert.ok(hook.includes('chooseFilmVersion(') && hook.includes('nextAudio(') && hook.includes('nextSubtitle('), 'choose et les deux cycles écrivent le choix du film');
  assert.ok(!hook.includes('setVersionPref'), 'jamais la version préférée');
  const panel = read(VERSION_PANEL);
  assert.ok(panel.includes('<VersionList') && panel.includes('question.keep.label') && panel.includes('question.other.label'), 'la liste partagée, et la question telle que la décision la pose');
  assert.ok(!/disabled/i.test(panel), 'PlayerVersionPanel.tsx contient disabled');
});

// Décision de Rusmir du 20/11/2026 : la question des sous-titres a une troisième ligne, plus discrète que les deux
// réponses, « Retour » — elle ne lance rien et ne retient rien. Dans le lecteur (ouvert par le vidéoclub), elle le ferme.
test('VERSION LECTEUR: « Retour » sous la question ferme le lecteur, sans rien choisir', () => {
  const panel = read(VERSION_PANEL);
  const q = panel.slice(panel.indexOf('question.other.label'));
  assert.match(q, /<button type="button" className=\{styles\.quit\} onClick=\{onQuit\}>\s*Retour\s*<\/button>/, '« Retour » après les deux réponses, sur onQuit');
  assert.ok(!/onQuit[^}]*onAnswer|onAnswer[^}]*onQuit/.test(q), '« Retour » ne répond pas à la question');
  const css = read('src/components/player/PlayerVersionPanel.module.css');
  assert.match(css, /\.quit\s*\{[^}]*min-height: 44px/, 'zone d\'appui de 44 px');
  const src = read(PLAYER);
  // Le lecteur se ferme, rien n'est choisi — par quitQuestion, qui ignore d'abord le clic fantôme de l'ouverture
  // (relecture d'ensemble de la partie A, I3 ; garde testée dans cast-on-open.test.mjs).
  assert.ok(src.includes('onQuit={quitQuestion}'), 'le lecteur se ferme par quitQuestion');
  const quit = src.slice(src.indexOf('const quitQuestion = () => {'), src.indexOf('\n  };', src.indexOf('const quitQuestion')));
  assert.ok(quit.includes('closePlayer()') && !quit.includes('choose('), 'quitQuestion ferme le lecteur sans rien choisir');
  // Échap sous la question fait la même chose que « Retour ».
  const keys = src.slice(src.indexOf('if (versionPanelShown) {'), src.indexOf('// Échap ferme le lecteur même sans vidéo montée'));
  assert.match(keys, /if \(asking\) closePlayer\(\);/, 'Échap sous la question = « Retour »');
});

// Relecture d'ensemble de la partie A (m2, m3) : à chaque nouvel élément <video> (autre version, « Réessayer »), le
// volume et le muet repartaient à leurs valeurs par défaut (l'écouteur de VHSControls ne s'attachait qu'une fois, au
// premier élément), et l'avance ou le retour rapide survivait au remontage (« FF x2 » affiché, boucle visant le nouvel
// élément).
test('VIDÉO REMONTÉE: le volume et le muet passent au nouvel élément, l\'avance rapide s\'arrête', () => {
  const controls = read(CONTROLS);
  const at = controls.indexOf("video.addEventListener('volumechange'");
  const effect = controls.slice(controls.lastIndexOf('useEffect(() => {', at), controls.indexOf(']);', at) + 3);
  assert.match(effect, /\}, \[videoRef, videoKey\]\);$/, 'l\'écouteur suit la key de l\'élément');
  assert.match(effect, /if \(left\) \{\s*video\.volume = left\.volume;\s*video\.muted = left\.muted;\s*\}/, 'le nouvel élément reprend le volume et le muet');
  assert.match(effect, /levelRef\.current = \{ volume: video\.volume, muted: video\.muted \};/, 'l\'élément qui s\'en va les laisse');
  assert.ok(effect.indexOf('levelRef.current = {') > effect.indexOf('return () => {'), 'rangés au départ de l\'élément');
  const src = read(PLAYER);
  assert.ok(src.includes('videoKey={videoKey}'), 'le lecteur passe la key à VHSControls');
  assert.match(src, /useEffect\(\(\) => \{\s*stopRW\(\);\s*setFfSpeed\(0\);\s*\}, \[videoKey, stopRW\]\);/, 'avance ou retour rapide arrêtés à chaque nouvel élément');
});

// Relecture d'ensemble de la partie A (m6) : un Cast de ce film ou le rembobinage masquaient la liste « Version » sans
// la fermer — le geste retour restait armé sur une liste invisible, qui reparaissait ensuite d'elle-même.
test('VERSION LECTEUR: ce qui masque la liste des versions la ferme', () => {
  const src = read(PLAYER);
  assert.match(src, /const versionPanelMasked = remoteActive \|\| rewindPhase !== 'none' \|\| rewindingToStart;/);
  assert.match(src, /if \(versionPanelMasked && versionListOpen\) setVersionListOpen\(false\);/, 'masquée → fermée');
  assert.match(src, /const versionPanelShown = \(asking \|\| versionListOpen\) && !versionPanelMasked;/);
  assert.match(src, /useBackGuard\(versionListOpen, closeVersionList\);/, 'le geste retour suit l\'état fermé');
});
