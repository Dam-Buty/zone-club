import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CAST_SERVER_GIVE_UP_MS, castMediaRequest, castSourceFor, castStartAt, castSubtitleId, loadRequestData, mediaStatusEvent,
  rentalGoneFilm, settle,
} from '../../src/cast/cast-wire.ts';
import { swapResumeTime } from '../../src/utils/video-swap.ts';

// Le fil entre la machine du Cast et le SDK (src/cast/cast-wire.ts) : ce que le service envoie à la TV, et ce
// qu'il comprend de ce qu'elle répond. Pur ; son seul import de valeur (la règle de reprise, video-swap.ts) porte son
// extension : Node le charge tel quel.

const getOut = (o = {}) => ({
  url: 'u', title: 'Get Out', startAt: 42,
  subtitles: [{ id: 1, url: 's', language: 'fr', label: 'Français' }], activeSubtitleId: 1, ...o,
});

// Relecture d'ensemble de la partie A (m1) : la source retombait sur l'autre piste, puis sur l'adresse générique de la
// location — la télé pouvait jouer en silence une autre langue que la version annoncée. La version arrive décidée
// (decideVersion ne rend que des pistes offertes) : la source est sa piste, ou rien.
test('CAST FIL: source = la piste demandée, sinon rien — jamais l\'autre piste', () => {
  assert.equal(castSourceFor({ streamingUrls: { vf: 'a', vo: 'b' } }, 'vo'), 'b');
  assert.equal(castSourceFor({ streamingUrls: { vf: 'a', vo: 'b' } }, 'vf'), 'a');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: 'b' } }, 'vf'), null, 'VF demandée, absente : rien, pas la VO');
  assert.equal(castSourceFor({ streamingUrls: { vf: 'a', vo: null } }, 'vo'), null, 'VO demandée, absente : rien, pas la VF');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: null } }, 'vf'), null);
  assert.equal(castSourceFor(null, 'vf'), null);
});
test('CAST FIL: jamais l\'adresse générique de la location ; une adresse vide n\'est pas une source', () => {
  assert.equal(castSourceFor({ videoUrl: 'v', streamingUrls: { vf: null, vo: null } }, 'vo'), null);
  assert.equal(castSourceFor({ videoUrl: 'v' }, 'vf'), null);
  assert.equal(castSourceFor({ videoUrl: '', streamingUrls: { vf: '', vo: null } }, 'vf'), null);
  assert.equal(castSourceFor(undefined, 'vo'), null);
  const wire = readFileSync(path.join(process.cwd(), 'src/cast/cast-wire.ts'), 'utf8');
  const fn = wire.slice(wire.indexOf('export function castSourceFor('), wire.indexOf('\n}\n', wire.indexOf('export function castSourceFor(')));
  assert.ok(!/videoUrl|other/.test(fn), 'castSourceFor ne lit ni videoUrl ni l\'autre piste');
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
const subsEn = { id: 2, url: 'https://s/en.vtt', language: 'en', label: 'English' };

// Relecture de la tâche 8 des versions (deuxième tour) : le départ par défaut (castFilm sans `startAt`, celui de « Sur ma
// télé » de la borne) suit la règle de reprise de l'appareil, swapResumeTime — la position est reprise quel que soit le
// pourcentage ; elle vaut le début seulement si la durée du fichier est connue et qu'elle est dans ses 10 dernières
// secondes. L'ancienne règle « 100 % → 0 » faisait partir de 0 sur la télé un film que le téléphone reprenait à 201 s.
const DURATION = 596.48;

test('CAST FIL: le départ par défaut est la position de la location, quel que soit le pourcentage', () => {
  // Chemin de la borne : le client ne connaît pas la durée du fichier (null) — la position est reprise telle quelle.
  assert.equal(castStartAt(rental(), undefined, null), 1234);
  assert.equal(castStartAt(rental({ watchProgress: 100, watchPosition: 201 }), undefined, null), 201, 'film fini puis revu jusqu\'à 201 s : la télé reprend à 201 s, comme le téléphone');
  assert.equal(castStartAt(rental({ watchProgress: 99, watchPosition: 590 }), undefined, null), 590, 'durée inconnue : la position telle quelle');
  assert.equal(castStartAt(null, undefined, null), 0);
  assert.equal(castStartAt(rental({ watchPosition: Number.NaN }), undefined, null), 0);
  assert.equal(castStartAt(rental({ watchPosition: -5 }), undefined, null), 0);
});
test('CAST FIL: durée connue — une position dans les 10 dernières secondes du fichier vaut le début, comme sur l\'appareil', () => {
  assert.equal(castStartAt(rental({ watchProgress: 99, watchPosition: 590 }), undefined, DURATION), 0);
  assert.equal(castStartAt(rental({ watchProgress: 100, watchPosition: 300 }), undefined, DURATION), 300);
  // La même décision que l'appareil (swapResumeTime, sans élément précédent), pour chaque cas.
  for (const [position, duration] of [[0, DURATION], [201, DURATION], [586.48, DURATION], [586, DURATION], [590, null], [590, Number.NaN], [-1, DURATION]]) {
    assert.equal(
      castStartAt(rental({ watchPosition: position }), undefined, duration),
      swapResumeTime({ elementTime: 0, rentalPosition: position, duration }),
      `${position} / ${duration}`,
    );
  }
});
test('CAST FIL: un départ demandé prime, même 0 ; un départ illisible vaut « pas demandé »', () => {
  assert.equal(castStartAt(rental(), 600, null), 600);
  assert.equal(castStartAt(rental(), 0, null), 0);
  assert.equal(castStartAt(rental({ watchProgress: 100, watchPosition: 5400 }), 90, null), 90);
  assert.equal(castStartAt(rental({ watchPosition: 590 }), 590, DURATION), 590, 'le départ demandé n\'est pas réinterprété');
  assert.equal(castStartAt(rental(), Number.NaN, null), 1234);
  assert.equal(castStartAt(rental(), -3, null), 1234);
});
test('CAST FIL: la règle de la progression a quitté le fil ; il délègue à la règle de l\'appareil', () => {
  const wire = readFileSync(path.join(process.cwd(), 'src/cast/cast-wire.ts'), 'utf8');
  const fn = wire.slice(wire.indexOf('export function castStartAt('), wire.indexOf('\n}\n', wire.indexOf('export function castStartAt(')));
  assert.ok(!/watchProgress/.test(fn), 'castStartAt ne lit plus la progression');
  assert.ok(fn.includes('swapResumeTime({ elementTime: 0, rentalPosition:'), 'castStartAt = swapResumeTime sans élément précédent');
  assert.match(wire, /import \{ swapResumeTime \} from '\.\.\/utils\/video-swap\.ts';/, 'l\'import porte son extension (Node le charge tel quel)');
});

test('CAST FIL: la demande de Cast d\'un film = source, titre, départ, sous-titres', () => {
  const media = castMediaRequest({ rental: rental(), audio: 'vo', title: 'Get Out', subtitles: subs, subtitle: 'fr' });
  assert.deepEqual(media, { url: 'https://s/vo.mp4', title: 'Get Out', startAt: 1234, subtitles: subs, activeSubtitleId: 1 });
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: 'Get Out', startAt: 5, subtitles: [], subtitle: 'off' }).startAt, 5);
  // Une location vue à 100 % puis revue jusqu'à 201 s : « Sur ma télé » de la borne la reprend à 201 s.
  assert.equal(castMediaRequest({ rental: rental({ watchProgress: 100, watchPosition: 201 }), audio: 'vf', title: 'x', subtitles: [], subtitle: 'off' }).startAt, 201);
});
test('CAST FIL: sans source il n\'y a pas de demande ; sans titre, le nom du club', () => {
  assert.equal(castMediaRequest({ rental: rental({ videoUrl: '', streamingUrls: { vf: null, vo: null } }), audio: 'vf', title: 'x', subtitles: [], subtitle: 'off' }), null);
  assert.equal(castMediaRequest({ rental: null, audio: 'vf', title: 'x', subtitles: [], subtitle: 'off' }), null);
  // La piste de la version absente : pas de demande, même si l'autre piste et l'adresse générique existent.
  assert.equal(castMediaRequest({ rental: rental({ streamingUrls: { vf: null, vo: 'https://s/vo.mp4' } }), audio: 'vf', title: 'x', subtitles: [], subtitle: 'off' }), null);
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: null, subtitles: [], subtitle: 'off' }).title, 'Zone Club');
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: '   ', subtitles: [], subtitle: 'off' }).title, 'Zone Club');
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

// Sous-titres : ceux de la version décidée, toujours donnés (relecture d'ensemble de la partie A, m1 : le défaut
// français de castSubtitleId, reste du lecteur d'avant, contredisait une VF demandée sans sous-titres). Seules les URL
// absolues sont déclarées à la TV (buildCastSubtitleTracks) : testé avec https.
test('CAST FIL: la piste de sous-titres de la version décidée, telle quelle, quel que soit l\'ordre des pistes', () => {
  assert.equal(castSubtitleId([...subs, subsEn], 'fr'), 1);
  assert.equal(castSubtitleId([subsEn, ...subs], 'fr'), 1, 'l\'ordre des pistes ne compte pas');
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vo', title: 'x', subtitles: [...subs, subsEn], subtitle: 'en' }).activeSubtitleId, 2);
});
test('CAST FIL: VF sans sous-titres → aucune piste active, même quand le français existe (plus de défaut)', () => {
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: 'x', subtitles: [...subs, subsEn], subtitle: 'off' }).activeSubtitleId, null);
  assert.equal(castSubtitleId([], 'off'), null);
  const wire = readFileSync(path.join(process.cwd(), 'src/cast/cast-wire.ts'), 'utf8');
  assert.match(wire, /export function castSubtitleId\(subtitles: CastMediaRequest\['subtitles'\], asked: 'off' \| 'fr' \| 'en'\): number \| null \{/, 'asked obligatoire');
  assert.match(wire, /\n {2}subtitle: 'off' \| 'fr' \| 'en';\n\}\): CastMediaRequest \| null \{/, 'castMediaRequest : subtitle obligatoire');
  assert.ok(!/subtitles\[0\]/.test(wire), 'plus de « première langue disponible » d\'office');
});
test('CAST FIL: « off » demandé coupe les sous-titres, même si le français existe', () => {
  assert.equal(castSubtitleId([...subs, subsEn], 'off'), null);
  assert.equal(castMediaRequest({ rental: rental(), audio: 'vf', title: 'x', subtitles: [...subs, subsEn], subtitle: 'off' }).activeSubtitleId, null);
});
test('CAST FIL: une langue demandée est honorée, et jamais remplacée par une autre', () => {
  assert.equal(castSubtitleId([...subs, subsEn], 'en'), 2);
  assert.equal(castSubtitleId([...subs, subsEn], 'fr'), 1);
  assert.equal(castSubtitleId([subsEn], 'fr'), null, 'français demandé, absent : aucun, pas l\'anglais');
});

// ---------------------------------------------------------------------------------------------------------
// settle : un appel serveur qui se règle toujours (src/store/slices/cast.ts en entoure chaque port)
// ---------------------------------------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve));
const pending = () => new Promise(() => {});

test('CAST FIL: settle rend la réponse quand elle arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await settle(() => Promise.resolve('réponse'), 'repli'), 'réponse');
});
test('CAST FIL: settle se règle sur un rejet', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await settle(() => Promise.reject(new Error('503')), 'repli'), 'repli');
});
test('CAST FIL: settle se règle sur une exception synchrone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await settle(() => { throw new Error('boum'); }, 'repli'), 'repli');
});
test('CAST FIL: settle abandonne à 10 000 ms, pas avant', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(CAST_SERVER_GIVE_UP_MS, 10000);
  let settled = false;
  const result = settle(pending, 'repli').then((value) => { settled = true; return value; });
  t.mock.timers.tick(CAST_SERVER_GIVE_UP_MS - 1);
  await flush();
  assert.equal(settled, false, 'à 9 999 ms l\'appel est encore attendu');
  t.mock.timers.tick(1);
  assert.equal(await result, 'repli');
});
test('CAST FIL: une réponse qui arrive après l\'échéance n\'y change rien', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answer;
  const result = settle(() => new Promise((resolve) => { answer = resolve; }), 'repli');
  t.mock.timers.tick(CAST_SERVER_GIVE_UP_MS);
  assert.equal(await result, 'repli');
  answer('trop tard');
  await flush();
  assert.equal(await result, 'repli');
});
test('CAST FIL: une réponse à temps lève l\'échéance', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answer;
  const result = settle(() => new Promise((resolve) => { answer = resolve; }), 'repli');
  t.mock.timers.tick(CAST_SERVER_GIVE_UP_MS - 1);
  answer('à temps');
  assert.equal(await result, 'à temps');
  t.mock.timers.tick(10);                                  // l'échéance ne part plus
  assert.equal(await result, 'à temps');
});
