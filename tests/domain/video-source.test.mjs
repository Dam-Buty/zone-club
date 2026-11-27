// Les films de la borne en deux codages (Rusmir, 26/11/2026) : « ceux qui sont compatibles AV1 reçoivent la vidéo AV1,
// les autres la vidéo H264 ». Le choix est fait par src/utils/video-source.ts.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchFilm, readsAv1 } from '../../src/utils/video-source.ts';

const FILM = {
  src: '/film.mp4', width: 720, height: 1290, framerate: 24, durationMs: 9250,
  av1: { src: '/film.av1.mp4', codecs: 'av01.0.05M.08', octets: 1_746_953 },
};
const capacites = (reponse) => {
  const demandes = [];
  return {
    demandes,
    decodingInfo: async (config) => {
      demandes.push(config);
      if (reponse instanceof Error) throw reponse;
      return reponse;
    },
  };
};

test('AV1 : lu quand le navigateur l\'annonce lisible et fluide, avec le codage exact du fichier', async () => {
  const c = capacites({ supported: true, smooth: true, powerEfficient: false });
  assert.equal(await readsAv1(FILM, c), true);
  const v = c.demandes[0];
  assert.equal(c.demandes[0].type, 'file');
  assert.equal(v.video.contentType, 'video/mp4; codecs="av01.0.05M.08"');
  assert.deepEqual([v.video.width, v.video.height, v.video.framerate], [720, 1290, 24]);
  assert.equal(v.video.bitrate, Math.round((1_746_953 * 8) / 9.25), 'débit moyen du fichier');
});

test('AV1 : pas lu s\'il n\'est pas fluide, pas pris en charge, si l\'API manque ou se trompe', async () => {
  assert.equal(await readsAv1(FILM, capacites({ supported: true, smooth: false, powerEfficient: false })), false);
  assert.equal(await readsAv1(FILM, capacites({ supported: false, smooth: false, powerEfficient: false })), false);
  assert.equal(await readsAv1(FILM, undefined), false);
  assert.equal(await readsAv1(FILM, capacites(new TypeError('config'))), false);
  assert.equal(await readsAv1({ ...FILM, av1: undefined }, capacites({ supported: true, smooth: true })), false, 'film sans version AV1');
});

function reseau(statuts) {
  const appels = [];
  const fetcher = async (url) => {
    appels.push(url);
    const statut = statuts[url] ?? 404;
    if (statut === 'panne') throw new TypeError('réseau');
    return { ok: statut === 200, status: statut, blob: async () => ({ url }) };
  };
  return { appels, fetcher };
}

test('téléchargement : l\'AV1 pour un navigateur qui le lit, le H.264 sinon — un seul fichier chaque fois', async () => {
  const r1 = reseau({ '/film.mp4': 200, '/film.av1.mp4': 200 });
  assert.deepEqual(await fetchFilm(FILM, capacites({ supported: true, smooth: true }), r1.fetcher), { url: '/film.av1.mp4' });
  assert.deepEqual(r1.appels, ['/film.av1.mp4']);
  const r2 = reseau({ '/film.mp4': 200, '/film.av1.mp4': 200 });
  assert.deepEqual(await fetchFilm(FILM, capacites({ supported: false, smooth: false }), r2.fetcher), { url: '/film.mp4' });
  assert.deepEqual(r2.appels, ['/film.mp4']);
});

test('téléchargement : l\'AV1 absent ou en panne, on prend le H.264 ; le H.264 absent, c\'est une erreur', async () => {
  for (const panne of [404, 'panne']) {
    const r = reseau({ '/film.mp4': 200, '/film.av1.mp4': panne });
    assert.deepEqual(await fetchFilm(FILM, capacites({ supported: true, smooth: true }), r.fetcher), { url: '/film.mp4' });
    assert.deepEqual(r.appels, ['/film.av1.mp4', '/film.mp4']);
  }
  const r = reseau({});
  await assert.rejects(fetchFilm(FILM, capacites({ supported: false, smooth: false }), r.fetcher));
});
