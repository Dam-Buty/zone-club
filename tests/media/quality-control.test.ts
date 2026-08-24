import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../../lib/media/quality-control.ts';
import type { TrackIdentification } from '../../lib/media/identify-tracks.ts';

const ALL = { vfAudio: true, voAudio: true, frSubs: true };

const tracks = (over: Partial<TrackIdentification> = {}): TrackIdentification => ({
  voAudioIndex: 2, vfAudioIndex: 1,
  voAudioOrdinal: 1, vfAudioOrdinal: 0,
  textSubs: [{ lang: 'fr', streamIndex: 3, codec: 'subrip' }],
  imageSubs: [],
  imageSubsFlagged: false,
  ...over,
});

test('release complète: acceptée', () => {
  const v = checkRelease(tracks(), 'en', ALL);
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
});

test('pas de VF (cas Chihiro): rejetée', () => {
  const v = checkRelease(tracks({ vfAudioIndex: null, vfAudioOrdinal: null }), 'ja', ALL);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['piste audio VF']);
});

test('pas de sous-titres français: rejetée', () => {
  const v = checkRelease(tracks({ textSubs: [{ lang: 'en', streamIndex: 3, codec: 'subrip' }] }), 'en', ALL);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['sous-titres français']);
});

test('VO retombée sur la piste française: pas une vraie VO, rejetée', () => {
  // identifyTracks n'avait qu'une piste FR: voAudioOrdinal === vfAudioOrdinal
  const v = checkRelease(tracks({ voAudioOrdinal: 0, vfAudioOrdinal: 0 }), 'en', ALL);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['piste audio VO']);
});

test('plusieurs manques: tous listés', () => {
  const v = checkRelease(
    tracks({ vfAudioIndex: null, vfAudioOrdinal: null, textSubs: [] }),
    'ja',
    ALL,
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['piste audio VF', 'sous-titres français']);
});

test('film français: une piste audio suffit, pas d’exigence de subs FR', () => {
  const v = checkRelease(
    tracks({ vfAudioOrdinal: 0, voAudioOrdinal: 0, textSubs: [] }),
    'fr',
    ALL,
  );
  assert.equal(v.ok, true);
});

test('film français sans aucune audio: rejeté', () => {
  const v = checkRelease(
    tracks({ vfAudioIndex: null, vfAudioOrdinal: null, voAudioIndex: null, voAudioOrdinal: null, textSubs: [] }),
    'fr',
    ALL,
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['piste audio française']);
});

test('exigences désactivables une par une', () => {
  const noVf = checkRelease(
    tracks({ vfAudioIndex: null, vfAudioOrdinal: null }),
    'ja',
    { ...ALL, vfAudio: false },
  );
  assert.equal(noVf.ok, true);
});

// Le cas qui faisait refuser Saving Private Ryan, Die Hard 2 et Naked Gun : la
// release PORTE des sous-titres français, mais en PGS. L'OCR les récupère à
// l'extraction, donc ils comptent au contrôle qualité.
test('sous-titres français uniquement en PGS: acceptée (OCR)', () => {
  const v = checkRelease(
    tracks({ textSubs: [], imageSubs: [{ lang: 'fr', streamIndex: 4, codec: 'hdmv_pgs_subtitle' }] }),
    'en',
    ALL,
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
});

test('sous-titres image dans une autre langue: toujours rejetée', () => {
  const v = checkRelease(
    tracks({ textSubs: [], imageSubs: [{ lang: 'en', streamIndex: 4, codec: 'hdmv_pgs_subtitle' }] }),
    'en',
    ALL,
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['sous-titres français']);
});
