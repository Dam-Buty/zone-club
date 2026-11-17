import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../lib/trailer-source.ts';

// Bandes-annonces sans publicité (Rusmir, 17/11/2026 : « on veut la bande-annonce sans pub, point »).
// Elles viennent d'Allociné, qui les héberge sur Dailymotion : le serveur les récupère une fois en
// 480, les garde, et la borne les joue dans son propre lecteur. Ni YouTube, ni lecteur tiers.

// Modèle d'une page de lecteur Allociné, relevé le 17/11/2026 (« Get Out », vidéo 19569801), réduit
// aux champs lus, encodé comme dans l'attribut HTML.
const enc = (o) => JSON.stringify(o).replace(/"/g, '&quot;').replace(/\//g, '\\/');
const vf = { id: 19569801, idDailymotion: 'x8a4fdw', idConnatix: null, title: 'Get Out Bande-annonce VF', file_type: 'TRAILER', duration: 87 };
const vo = { id: 19565427, idDailymotion: 'x8a4e16', idConnatix: null, title: 'Get Out Bande-annonce VO', file_type: 'TRAILER', duration: 90 };
const PLAYER_PAGE = `<figure class="player js-player" data-model="${enc({ videos: [vf], disablePreroll: false })}"></figure>`;
const FILM_PAGE = `<a class="trailer roller-item" href="/video/player_gen_cmedia=19565427&amp;cfilm=241160.html">Bandes-annonces</a>
<figure data-model="${enc({ videos: [vo] })}"></figure>
<a href="/video/player_gen_cmedia=19569801&amp;cfilm=241160.html">VF</a><a href="/video/player_gen_cmedia=19565427&amp;cfilm=241160.html">VO</a>`;

test('BANDE-ANNONCE: les vidéos d\'une page Allociné, avec leur identifiant Dailymotion', () => {
  assert.deepEqual(T.allocineVideos(PLAYER_PAGE), [{ media: 19569801, dailymotion: 'x8a4fdw', title: 'Get Out Bande-annonce VF', trailer: true }]);
  assert.deepEqual(T.allocineMediaIds(FILM_PAGE), [19565427, 19569801], 'dans l\'ordre de la page, sans doublon');
  const titled = `<figure data-model="${enc({ videos: [{ ...vf, title: 'L\'Impasse Bande-annonce VF' }] })}"></figure>`.replace("'", '&#039;');
  assert.equal(T.allocineVideos(titled)[0].title, "L'Impasse Bande-annonce VF", 'entités HTML décodées');
  assert.deepEqual(T.allocineVideos(`<figure data-model="${enc({ videos: [{ ...vf, idDailymotion: null }] })}"></figure>`), [], 'sans Dailymotion, rien à récupérer');
  assert.deepEqual(T.allocineVideos('<figure data-model="pas du json"></figure>'), [], 'un modèle illisible est ignoré');
});

test('BANDE-ANNONCE: la VF d\'abord, puis la VOST, puis la VO ; la bande-annonce avant le teaser', () => {
  const v = (title, trailer = true) => ({ media: title.length, dailymotion: 'x' + title.length, title, trailer });
  const pick = (...titles) => T.pickAllocineTrailer(titles.map((t) => v(t)))?.title ?? null;
  assert.equal(pick('Heat Bande-annonce VO', 'Heat Bande-annonce VF'), 'Heat Bande-annonce VF');
  assert.equal(pick('Heat Teaser VF', 'Heat Bande-annonce VF'), 'Heat Bande-annonce VF');
  assert.equal(pick('Heat Bande-annonce VO', 'Heat Bande-annonce VOST'), 'Heat Bande-annonce VOST');
  assert.equal(pick('Trainspotting Bande-annonce VO', 'Trainspotting Bande-annonce VO STFR'), 'Trainspotting Bande-annonce VO STFR', '« VO STFR » est sous-titré');
  assert.equal(pick('Heat Bande-annonce VO'), 'Heat Bande-annonce VO');
  assert.equal(T.pickAllocineTrailer([v('Heat Extrait VF', false)]), null, 'un extrait n\'est pas une bande-annonce');
  assert.equal(T.trailerLang('Heat Bande-annonce VF'), 'vf');
  assert.equal(T.trailerLang('Trainspotting Bande-annonce VO STFR'), 'vost');
  assert.equal(T.trailerLang('Heat Bande-annonce VOST'), 'vost');
  assert.equal(T.trailerLang('Heat Bande-annonce VO'), 'vo');
  assert.equal(T.hasVfTrailer([v('Heat Bande-annonce VF')]), true);
  assert.equal(T.hasVfTrailer([v('Heat Teaser VF'), v('Heat Bande-annonce VO')]), false);
});

test('BANDE-ANNONCE: le flux « 480 » de la playlist Dailymotion, jamais plus lourd', () => {
  // Lignes de flux relevées le 17/11/2026 sur x8a4fdw ; adresses raccourcies.
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=836280,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=848x360,NAME="480"',
    'https://vod3.cf.dmcdn.net/sec2(abc)/video/x480.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=460560,CODECS="avc1.42001e,mp4a.40.2",RESOLUTION=512x216,NAME="380"',
    'https://vod3.cf.dmcdn.net/sec2(abc)/video/x380.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2149280,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x544,NAME="720"',
    'https://vod3.cf.dmcdn.net/sec2(abc)/video/x720.m3u8',
  ].join('\n');
  assert.equal(T.pickHlsVariant(master, 'https://cdndirector.dailymotion.com/cdn/manifest/video/x8a4fdw.m3u8'), 'https://vod3.cf.dmcdn.net/sec2(abc)/video/x480.m3u8');
  const noName = master.replace(/,NAME="\d+"/g, '');
  assert.equal(T.pickHlsVariant(noName, 'https://x.dailymotion.com/m.m3u8'), 'https://vod3.cf.dmcdn.net/sec2(abc)/video/x480.m3u8', 'sans nom, le plus haut sous 480 lignes');
  const relative = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=836280,RESOLUTION=848x360,NAME="480"\nv/480.m3u8';
  assert.equal(T.pickHlsVariant(relative, 'https://cdndirector.dailymotion.com/cdn/manifest/video/x8a4fdw.m3u8'), 'https://cdndirector.dailymotion.com/cdn/manifest/video/v/480.m3u8');
  assert.equal(T.pickHlsVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2149280,RESOLUTION=1280x544,NAME="720"\nhttps://a.dmcdn.net/720.m3u8', 'https://x.dailymotion.com/m'), null, 'seulement du 720 : rien');
});

test('BANDE-ANNONCE: le serveur ne va chercher que chez Dailymotion', () => {
  for (const ok of ['https://cdndirector.dailymotion.com/cdn/manifest/video/x8a4fdw.m3u8', 'https://vod3.cf.dmcdn.net/a.m3u8', 'https://www.dailymotion.com/player/metadata/video/x8a4fdw']) assert.equal(T.isDailymotionUrl(ok), true, ok);
  for (const bad of ['http://www.dailymotion.com/x', 'https://dailymotion.com.evil.net/x', 'https://evil.net/dmcdn.net', 'file:///etc/passwd', 'pas une adresse']) assert.equal(T.isDailymotionUrl(bad), false, bad);
  assert.equal(T.isDailymotionId('x8a4fdw'), true);
  for (const bad of ['', 'x8a4fdw/../..', 'X8A4FDW', 'abc', null]) assert.equal(T.isDailymotionId(bad), false, String(bad));
});

test('BANDE-ANNONCE: plages d\'octets demandées par le lecteur vidéo', () => {
  assert.deepEqual(T.byteRange('bytes=0-1', 1000), { start: 0, end: 1 }, 'la première demande de Safari');
  assert.deepEqual(T.byteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(T.byteRange('bytes=-200', 1000), { start: 800, end: 999 }, 'les 200 derniers octets');
  assert.deepEqual(T.byteRange('bytes=900-5000', 1000), { start: 900, end: 999 }, 'fin ramenée à la taille');
  for (const bad of ['bytes=1000-', 'bytes=5-2', 'octets=0-1', 'bytes=-0', 'bytes=0-1,5-6']) assert.equal(T.byteRange(bad, 1000), null, bad);
});
