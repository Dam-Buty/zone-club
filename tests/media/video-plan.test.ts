import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVideo, estimateVideoBitrate } from '../../lib/media/video-plan.ts';

// 1080p h264 8 bits + une piste audio, taille/durée réglables pour viser un débit.
const src = (over: Record<string, unknown> = {}, audioBits = 640_000) => [
  { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'Main', pix_fmt: 'yuv420p', width: 1920, height: 1080, ...over },
  { index: 1, codec_type: 'audio', codec_name: 'ac3', bit_rate: audioBits },
];

// 5 Mbit/s vidéo + 0,64 Mbit/s audio sur 7500 s
const SIZE_5MBPS = ((5_000_000 + 640_000) * 7500) / 8;
// 8,5 Mbit/s vidéo
const SIZE_8MBPS = ((8_500_000 + 640_000) * 7500) / 8;

test('WEB-DL déjà compatible et peu chargé: copie sans réencodage', () => {
  const p = planVideo(src(), SIZE_5MBPS, 7500);
  assert.equal(p.action, 'copy');
  assert.match(p.reason, /H\.264 Main 1920×1080/);
});

test('BluRay au-dessus du seuil: réencodage pour la bande passante', () => {
  const p = planVideo(src(), SIZE_8MBPS, 7500);
  assert.equal(p.action, 'encode');
  assert.match(p.reason, /seuil/);
});

test('HEVC: réencodage même à bas débit (illisible en navigateur)', () => {
  const p = planVideo(src({ codec_name: 'hevc' }), SIZE_5MBPS, 7500);
  assert.equal(p.action, 'encode');
  assert.match(p.reason, /hevc/);
});

test('h264 10 bits: réencodage (High 10 non lu par les navigateurs)', () => {
  const p = planVideo(src({ profile: 'High 10', pix_fmt: 'yuv420p10le' }), SIZE_5MBPS, 7500);
  assert.equal(p.action, 'encode');
  assert.match(p.reason, /pix_fmt/);
});

test('4K: réencodage pour rentrer dans le cadre', () => {
  const p = planVideo(src({ width: 3840, height: 1608 }), SIZE_5MBPS, 7500);
  assert.equal(p.action, 'encode');
  assert.match(p.reason, /3840×1608 dépasse/);
});

test('débit indéterminable: on réencode plutôt que de parier', () => {
  const p = planVideo(src(), 0, 0);
  assert.equal(p.action, 'encode');
  assert.match(p.reason, /indéterminable/);
});

test('bit_rate déclaré sur le stream: prioritaire sur l’estimation', () => {
  const streams = src({ bit_rate: 3_000_000 });
  assert.equal(estimateVideoBitrate(streams, SIZE_8MBPS, 7500), 3_000_000);
});

test('sans bit_rate déclaré: estimé à partir de la taille moins l’audio', () => {
  const got = estimateVideoBitrate(src(), SIZE_5MBPS, 7500);
  assert.ok(got !== null && Math.abs(got - 5_000_000) < 1000, `attendu ~5 Mbit/s, obtenu ${got}`);
});
