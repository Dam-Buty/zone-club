import test from 'node:test';
import assert from 'node:assert/strict';
import { castMediaRequest, castSourceFor, castStartAt, loadRequestData, mediaStatusEvent, rentalGoneFilm } from '../../src/cast/cast-wire.ts';

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
test('CAST FIL: une entrée brute de la réponse à GET_STATUS donne le même événement que l\'objet du SDK', () => {
  // Après un rechargement le SDK n'a pas encore d'objet média (F2) : la réponse brute porte currentTime, pas
  // getEstimatedTime().
  const raw = { mediaSessionId: 3, playerState: 'PLAYING', currentTime: 1234.5, media: { duration: 5400, customData: { filmId: 7 } } };
  assert.deepEqual(mediaStatusEvent(raw, 0.28), {
    type: 'MEDIA_STATUS', filmId: 7, playerState: 'PLAYING', idleReason: null,
    position: 1234.5, duration: 5400, volume: 0.28, preview: false,
  });
  // L'horloge du SDK, quand elle existe, prime sur la dernière position reçue.
  assert.equal(mediaStatusEvent({ ...raw, getEstimatedTime: () => 1240 }, 1).position, 1240);
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

// ---------------------------------------------------------------------------------------------------------
// Ce que la tranche du magasin décide avant de parler au service (src/store/slices/cast.ts)
// ---------------------------------------------------------------------------------------------------------

const rental = (o = {}) => ({
  videoUrl: 'v', streamingUrls: { vf: 'https://s/vf.mp4', vo: 'https://s/vo.mp4' }, watchProgress: 40, watchPosition: 1234, ...o,
});
const subs = [{ id: 1, url: 'https://s/fr.vtt', language: 'fr', label: 'Français' }];

test('CAST FIL: le départ par défaut est la position de la location, 0 si elle est vue jusqu\'au bout', () => {
  assert.equal(castStartAt(rental(), undefined), 1234);
  assert.equal(castStartAt(rental({ watchProgress: 100, watchPosition: 5400 }), undefined), 0);
  assert.equal(castStartAt(rental({ watchProgress: 99, watchPosition: 5300 }), undefined), 5300);
  assert.equal(castStartAt(null, undefined), 0);
  assert.equal(castStartAt(rental({ watchPosition: Number.NaN }), undefined), 0);
  assert.equal(castStartAt(rental({ watchPosition: -5 }), undefined), 0);
});
test('CAST FIL: un départ demandé prime, même 0 ; un départ illisible vaut « pas demandé »', () => {
  assert.equal(castStartAt(rental(), 600), 600);
  assert.equal(castStartAt(rental(), 0), 0);
  assert.equal(castStartAt(rental({ watchProgress: 100, watchPosition: 5400 }), 90), 90);
  assert.equal(castStartAt(rental(), Number.NaN), 1234);
  assert.equal(castStartAt(rental(), -3), 1234);
});

test('CAST FIL: la demande de Cast d\'un film = source, titre, départ, sous-titres', () => {
  const media = castMediaRequest({ rental: rental(), audio: 'vo', title: 'Get Out', subtitles: subs, activeSubtitleId: 1 });
  assert.deepEqual(media, { url: 'https://s/vo.mp4', title: 'Get Out', startAt: 1234, subtitles: subs, activeSubtitleId: 1 });
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: 'Get Out', startAt: 5, subtitles: [], activeSubtitleId: null }).startAt, 5);
});
test('CAST FIL: sans source il n\'y a pas de demande ; sans titre, le nom du club', () => {
  assert.equal(castMediaRequest({ rental: rental({ videoUrl: '', streamingUrls: { vf: null, vo: null } }), audio: 'vf', title: 'x', subtitles: [], activeSubtitleId: null }), null);
  assert.equal(castMediaRequest({ rental: null, audio: 'vf', title: 'x', subtitles: [], activeSubtitleId: null }), null);
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: null, subtitles: [], activeSubtitleId: null }).title, 'Zone Club');
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: '   ', subtitles: [], activeSubtitleId: null }).title, 'Zone Club');
});

// La location qui disparaît pendant un Cast arrête la TV ; pendant que les locations ne sont pas encore chargées,
// rien ne disparaît (la liste vide d'avant la première réponse du serveur n'est pas une location perdue).
const own = (o = {}) => ({ owned: 7, tracked: true, before: [{ filmId: 7 }, { filmId: 9 }], after: [{ filmId: 9 }], ...o });
test('CAST FIL: une location qui était là et n\'y est plus arrête le Cast de ce film', () => {
  assert.equal(rentalGoneFilm(own()), 7);
  assert.equal(rentalGoneFilm(own({ after: [] })), 7);
});
test('CAST FIL: les locations pas encore chargées ne sont pas des locations perdues', () => {
  // Avant la première réponse de fetchMe : [] puis la liste. Le film n'a jamais été là, il n'a pas disparu.
  assert.equal(rentalGoneFilm(own({ before: [], after: [] })), null);
  assert.equal(rentalGoneFilm(own({ before: [], after: [{ filmId: 9 }] })), null);
});
test('CAST FIL: la location du film encore là, ou un autre film perdu, ne touche pas le Cast', () => {
  assert.equal(rentalGoneFilm(own({ after: [{ filmId: 7 }, { filmId: 9 }] })), null);
  assert.equal(rentalGoneFilm(own({ before: [{ filmId: 7 }, { filmId: 9 }], after: [{ filmId: 7 }] })), null);
});
test('CAST FIL: rien à arrêter sans film sur la TV, ni pour une prévisualisation /admin', () => {
  assert.equal(rentalGoneFilm(own({ owned: null })), null);
  // Une prévisualisation n'a pas de location : celle, réelle, du même film qui s'éteint ne l'arrête pas.
  assert.equal(rentalGoneFilm(own({ tracked: false })), null);
});
