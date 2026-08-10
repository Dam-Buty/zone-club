import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyTracks } from '../../lib/media/identify-tracks.ts';

const streams = [
  { index: 0, codec_type: 'video', codec_name: 'hevc' },
  { index: 1, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'fre' } },
  { index: 2, codec_type: 'audio', codec_name: 'ac3',  tags: { language: 'eng' } },
  { index: 3, codec_type: 'subtitle', codec_name: 'subrip',            tags: { language: 'fre' } },
  { index: 4, codec_type: 'subtitle', codec_name: 'subrip',            tags: { language: 'eng' } },
  { index: 5, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } },
];

test('film anglophone: VO=eng, VF=fre, subs texte fr+en, flag PGS', () => {
  const r = identifyTracks(streams, 'en');
  assert.equal(r.voAudioIndex, 2);
  assert.equal(r.vfAudioIndex, 1);
  assert.equal(r.voAudioOrdinal, 1);
  assert.equal(r.vfAudioOrdinal, 0);
  assert.deepEqual(r.textSubs.map(s => [s.lang, s.streamIndex]), [['fr', 3], ['en', 4]]);
  assert.equal(r.imageSubsFlagged, true);
});

test('film japonais: VO=jpn même si eng présent', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
    { index: 3, codec_type: 'audio', codec_name: 'aac', tags: { language: 'fre' } },
  ];
  const r = identifyTracks(s, 'ja');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, 3);
  assert.equal(r.voAudioOrdinal, 0);
  assert.equal(r.vfAudioOrdinal, 2);
});

test('pas de VF: vfAudioIndex null, VO fallback première audio', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
  ];
  const r = identifyTracks(s, 'en');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, null);
  assert.equal(r.voAudioOrdinal, 0);
  assert.equal(r.vfAudioOrdinal, null);
});

test('audio sans tags: VO=première audio, pas de VF', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac' },
  ];
  const r = identifyTracks(s, 'en');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, null);
  assert.equal(r.voAudioOrdinal, 0);
  assert.equal(r.vfAudioOrdinal, null);
});
