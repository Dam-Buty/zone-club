import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { sceneAtLoad } from '../../src/utils/scene-at-load.ts';

// Retours de Rusmir du 25/11/2026, après le déploiement sur club.lazone.at.
const src = (p) => readText(path.join(process.cwd(), p));

test('SCÈNE: un rechargement repart de la devanture, même depuis le vidéoclub ou la borne', () => {
  for (const persisted of ['interior', 'kiosk', 'exterior']) {
    assert.equal(sceneAtLoad({ persisted, castEnded: false, wasDiscarded: false }), 'exterior', persisted);
  }
  assert.equal(sceneAtLoad({ persisted: 'interior', castEnded: false, wasDiscarded: true }), 'interior', 'onglet déchargé par le navigateur : on retrouve sa scène');
  assert.equal(sceneAtLoad({ persisted: 'interior', castEnded: true, wasDiscarded: false }), 'interior', 'lien de notification : il mène lui-même au lecteur');
});

test('SCÈNE: App décide de la scène au chargement par sceneAtLoad, plus par un drapeau de sessionStorage', () => {
  const app = src('src/App.tsx');
  assert.match(app, /sceneAtLoad\(\{/);
  assert.doesNotMatch(app, /zone-club-session-active/, 'sessionStorage survit au rechargement : il ramenait dans le vidéoclub');
});

test('SORTIE: la porte du vidéoclub est une sortie, visée ou touchée, avec un fondu au noir', () => {
  // Le rayon des contrôles ne voit que deux calques (cassettes, interactifs) : sans le second, la porte était ignorée.
  assert.match(src('src/components/interior/Storefront.tsx'), /<group userData=\{\{ isExitDoor: true \}\} ref=\{\(door\) => door\?\.traverse\(\(o\) => o\.layers\.enable\(RAYCAST_LAYER_INTERACTIVE\)\)\}>/);
  const controls = src('src/components/interior/Controls.tsx');
  assert.match(controls, /if \(obj\.userData\?\.isExitDoor\) \{\s*foundInteractive = "exitDoor";/, 'visée au centre de l\'écran (ordinateur)');
  assert.match(controls, /if \(interactive === "exitDoor"\) \{[^}]*leaveStore\(\)/, 'clic ou [E] sur la porte');
  assert.match(controls, /if \(obj\.userData\?\.isExitDoor\) \{\s*useStore\.getState\(\)\.leaveStore\(\);/, 'toucher (mobile)');
  assert.match(src('src/components/interior/InteriorScene.tsx'), /targetedInteractive === 'exitDoor'\) \{\s*hint = 'Sortir \[E\]'/);
  const app = src('src/App.tsx');
  assert.match(app, /if \(!leavingStore\) return;[\s\S]*?setScene\('exterior'\), LEAVE_STORE_FADE_MS/, 'la devanture après le fondu');
  assert.match(app, /\{leavingStore && \(/, 'le voile noir du fondu');
});

test('BANDE-ANNONCE: plus de lecteur YouTube dans la fiche K7, la nôtre préchargée dès l\'ouverture', () => {
  const overlay = src('src/components/videoclub/VHSCaseOverlay.tsx');
  assert.doesNotMatch(overlay, /<iframe|getYouTubeEmbedUrl|tmdb\.getVideos/, 'YouTube peut diffuser des publicités');
  assert.match(overlay, /<K7Trailer tmdbId=\{isOpen \? film\?\.tmdb_id \?\? null : null\}/, 'montée dès l\'ouverture de la fiche');
  const k7 = src('src/components/videoclub/K7Trailer.tsx');
  assert.match(k7, /useTrailerStatus\(tmdbId\)/);
  assert.match(k7, /preload="auto"/);
  assert.match(k7, /display: open \? 'flex' : 'none'/, 'cachée, pas démontée : le préchargement est gardé');
});

test('BANDE-ANNONCE: la borne prépare et précharge la bande-annonce dès l\'ouverture de la fiche', () => {
  const detail = src('src/components/kiosk/KioskDetail.tsx');
  assert.match(detail, /const trailer = useTrailerStatus\(tmdbId\);/, 'au niveau de la fiche, pas de la rubrique');
  assert.match(detail, /<div className=\{styles\.kTrailer\} hidden=\{!trailerShown\}>/, 'lecteur monté hors de la rubrique, caché');
  assert.match(detail, /useTrailerPlayback\(trailerVideo, trailerShown && !covered\)/, 'recouverte, elle se tait');
});
