import test from 'node:test';
import assert from 'node:assert/strict';
import { castSourceFor, loadRequestData, mediaStatusEvent } from '../../src/cast/cast-wire.ts';

// Le fil entre la machine du Cast et le SDK (src/cast/cast-wire.ts) : ce que le service envoie à la TV, et ce
// qu'il comprend de ce qu'elle répond. Pur, sans import de valeur : Node le charge tel quel.

const getOut = (o = {}) => ({
  url: 'u', title: 'Get Out', startAt: 42,
  subtitles: [{ id: 1, url: 's', language: 'fr', label: 'Français' }], activeSubtitleId: 1, ...o,
});

test('CAST FIL: source = piste demandée, sinon l\'autre, sinon rien', () => {
  assert.equal(castSourceFor({ streamingUrls: { vf: 'a', vo: 'b' } }, 'vo'), 'b');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: 'b' } }, 'vf'), 'b');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: null } }, 'vf'), null);
  assert.equal(castSourceFor(null, 'vf'), null);
});
test('CAST FIL: sans piste, l\'adresse de la location ; une adresse vide n\'est pas une source', () => {
  assert.equal(castSourceFor({ videoUrl: 'v', streamingUrls: { vf: null, vo: null } }, 'vo'), 'v');
  assert.equal(castSourceFor({ videoUrl: 'v' }, 'vf'), 'v');
  // Le magasin pose videoUrl à '' quand la location n'a aucune piste.
  assert.equal(castSourceFor({ videoUrl: '', streamingUrls: { vf: '', vo: null } }, 'vf'), null);
  assert.equal(castSourceFor(undefined, 'vo'), null);
});

test('CAST FIL: la demande de chargement porte le film', () => {
  const d = loadRequestData(7, getOut(), true);
  assert.deepEqual(d.customData, { filmId: 7 }); assert.equal(d.currentTime, 42); assert.deepEqual(d.activeTrackIds, [1]);
  assert.equal(d.contentId, 'u');
  assert.equal(d.contentType, 'video/mp4');
  assert.equal(d.title, 'Get Out');
  assert.equal(d.autoplay, true);
  assert.deepEqual(d.tracks, [{ trackId: 1, trackContentId: 's', language: 'fr', name: 'Français' }]);
});
test('CAST FIL: une prévisualisation /admin se dit telle dans son média', () => {
  // Rechargée, la page la reconnaîtra au statut de la TV et n'ira pas la suivre sur une vraie location.
  const d = loadRequestData(7, getOut({ activeSubtitleId: null }), false);
  assert.deepEqual(d.customData, { filmId: 7, preview: true });
  assert.deepEqual(d.activeTrackIds, []);
});
test('CAST FIL: jamais de piste active qui n\'est pas déclarée, jamais de départ avant le début', () => {
  // Le récepteur refuse un chargement dont la piste active n'existe pas : le film ne partirait pas.
  assert.deepEqual(loadRequestData(7, getOut({ activeSubtitleId: 2 }), true).activeTrackIds, []);
  assert.deepEqual(loadRequestData(7, getOut({ subtitles: [], activeSubtitleId: 1 }), true).tracks, []);
  assert.equal(loadRequestData(7, getOut({ startAt: -3 }), true).currentTime, 0);
  assert.equal(loadRequestData(7, getOut({ startAt: Number.NaN }), true).currentTime, 0);
});

test('CAST FIL: statut de la TV → événement', () => {
  assert.deepEqual(mediaStatusEvent(null, 0.3), { type: 'NO_MEDIA' });
  const e = mediaStatusEvent({ playerState: 'IDLE', idleReason: 'FINISHED', media: { duration: 596.5, customData: { filmId: 7 } }, getEstimatedTime: () => 0 }, 0.3);
  assert.equal(e.idleReason, 'FINISHED'); assert.equal(e.filmId, 7); assert.equal(e.duration, 596.5);
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { customData: { filmId: 'x' } } }, 1).filmId, null);
  assert.deepEqual(e, {
    type: 'MEDIA_STATUS', filmId: 7, playerState: 'IDLE', idleReason: 'FINISHED',
    position: 0, duration: 596.5, volume: 0.3, preview: false,
  });
});
test('CAST FIL: lecture en cours — position estimée, volume du récepteur, prévisualisation reconnue', () => {
  const e = mediaStatusEvent({ playerState: 'PAUSED', idleReason: null, media: { duration: 600, customData: { filmId: 3, preview: true } }, getEstimatedTime: () => 125.4 }, 0.28);
  assert.deepEqual(e, {
    type: 'MEDIA_STATUS', filmId: 3, playerState: 'PAUSED', idleReason: null,
    position: 125.4, duration: 600, volume: 0.28, preview: true,
  });
});
test('CAST FIL: ce que la TV dit mal ne devient jamais une valeur fausse', () => {
  // État inconnu (LOADING…) : en attente. Raison d'arrêt hors IDLE ou inconnue : aucune.
  const loading = mediaStatusEvent({ playerState: 'LOADING', idleReason: 'FINISHED', media: { customData: { filmId: 3 } } }, 1);
  assert.equal(loading.playerState, 'BUFFERING');
  assert.equal(loading.idleReason, null);
  assert.equal(mediaStatusEvent({ playerState: 'IDLE', idleReason: 'BOGUS', media: { customData: { filmId: 3 } } }, 1).idleReason, null);
  // Identifiant non entier, nul ou négatif, customData absent : média que nous n'avons pas lancé.
  for (const customData of [{ filmId: 2.5 }, { filmId: 0 }, { filmId: -4 }, null, 'filmId=3', undefined]) {
    assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { customData } }, 1).filmId, null, JSON.stringify(customData));
  }
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: null }, 1).filmId, null);
  // Seul `true` fait une prévisualisation.
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { customData: { filmId: 3, preview: 'oui' } } }, 1).preview, false);
  // Horloge absente ou illisible, durée inconnue (le SDK la remet à zéro en fin de film), volume hors bornes.
  const odd = mediaStatusEvent({ playerState: 'PLAYING', media: { duration: null, customData: { filmId: 3 } }, getEstimatedTime: () => Number.NaN }, 1.7);
  assert.equal(odd.position, 0);
  assert.equal(odd.duration, 0);
  assert.equal(odd.volume, 1);
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { duration: -1, customData: { filmId: 3 } } }, -0.2).volume, 0);
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { customData: { filmId: 3 } } }, Number.NaN).volume, 1);
});
