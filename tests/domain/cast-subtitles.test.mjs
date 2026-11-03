/**
 * Sous-titres en cast — le receiver ne reçoit que le MP4, les WebVTT doivent
 * être déclarés en side-load. Ces tests couvrent la sélection des pistes et
 * l'ID à activer.
 *
 * Run: node --test tests/domain/cast-subtitles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCastSubtitleTracks,
  activeSubtitleId,
} from '../../src/utils/cast-subtitles.ts';

const FR = 'https://club-storage.lazone.at/uuid/subs_fr.vtt';
const EN = 'https://club-storage.lazone.at/uuid/subs_en.vtt';

test('CAST-SUBS: déclare les deux pistes avec des IDs stables', () => {
  const tracks = buildCastSubtitleTracks({ subtitles: FR, subtitles_en: EN });

  assert.deepEqual(tracks, [
    { id: 1, url: FR, language: 'fr', label: 'Français' },
    { id: 2, url: EN, language: 'en', label: 'English' },
  ]);
});

test('CAST-SUBS: une seule langue disponible', () => {
  assert.deepEqual(buildCastSubtitleTracks({ subtitles: FR }), [
    { id: 1, url: FR, language: 'fr', label: 'Français' },
  ]);
  assert.deepEqual(buildCastSubtitleTracks({ subtitles_en: EN }), [
    { id: 2, url: EN, language: 'en', label: 'English' },
  ]);
});

test('CAST-SUBS: aucune piste sans sous-titres', () => {
  assert.deepEqual(buildCastSubtitleTracks(null), []);
  assert.deepEqual(buildCastSubtitleTracks({}), []);
  assert.deepEqual(buildCastSubtitleTracks({ subtitles: null, subtitles_en: null }), []);
});

test('CAST-SUBS: les URLs relatives du seed sont exclues', () => {
  // Un chemin same-origin est résolu par le navigateur, pas par le Chromecast.
  const tracks = buildCastSubtitleTracks({
    subtitles: '/seed-media/sub.fr.vtt',
    subtitles_en: '/seed-media/sub.en.vtt',
  });
  assert.deepEqual(tracks, []);
});

test('CAST-SUBS: mapping de la piste sélectionnée', () => {
  const tracks = buildCastSubtitleTracks({ subtitles: FR, subtitles_en: EN });

  assert.equal(activeSubtitleId(tracks, 'fr'), 1);
  assert.equal(activeSubtitleId(tracks, 'en'), 2);
  assert.equal(activeSubtitleId(tracks, 'off'), null);
});

test('CAST-SUBS: langue absente → aucune piste active', () => {
  const frOnly = buildCastSubtitleTracks({ subtitles: FR });
  assert.equal(activeSubtitleId(frOnly, 'en'), null);
  assert.equal(activeSubtitleId([], 'fr'), null);
});
