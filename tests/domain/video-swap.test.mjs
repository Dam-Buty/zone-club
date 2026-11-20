import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { swapResumeTime } from '../../src/utils/video-swap.ts';

// La vidéo du lecteur est remontée à chaque autre piste audio (sa `key`) et à chaque « Réessayer » (spec
// 2026-11-19-versions-et-erreurs-de-lecture, § 4.3 b). Avant cette tâche, la fin du film et la reprise restaient
// attachées à l'ancien élément : après un changement de version, plus de « BE KIND REWIND », et un changement fait
// avant la première image repartait de zéro. Ici : où reprend le nouvel élément, et les écouteurs qui le suivent.

const read = (rel) => readText(path.join(process.cwd(), rel));
const LIFECYCLE = 'src/components/player/useVideoLifecycle.ts';

test('VIDÉO REMONTÉE: un changement fait avant la première image reprend à la position de la location', () => {
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 300, rentalProgress: 50 }), 300);
  // Un élément qui a à peine démarré (moins que la position enregistrée) ne fait pas reculer le film.
  assert.equal(swapResumeTime({ elementTime: 0.4, rentalPosition: 300, rentalProgress: 50 }), 300);
});

test('VIDÉO REMONTÉE: un changement en cours de film garde la seconde de l\'élément', () => {
  // La location n'est enregistrée que toutes les 10 s : l'élément est en avance sur elle.
  assert.equal(swapResumeTime({ elementTime: 421.7, rentalPosition: 412, rentalProgress: 70 }), 421.7);
});

test('VIDÉO REMONTÉE: une location vue à 100 % ne fait pas reprendre à sa position enregistrée', () => {
  // La fin du film, ou une position périmée : le nouvel élément part du début, jamais de la fin (« ended » aussitôt).
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 596.5, rentalProgress: 100 }), 0);
  // Revoir un film fini : la seconde de l'élément est gardée, seule la position de la location ne compte plus.
  assert.equal(swapResumeTime({ elementTime: 200, rentalPosition: 596.5, rentalProgress: 100 }), 200);
});

test('VIDÉO REMONTÉE: une position illisible ne compte pas', () => {
  assert.equal(swapResumeTime({ elementTime: Number.NaN, rentalPosition: 120, rentalProgress: 20 }), 120);
  assert.equal(swapResumeTime({ elementTime: 30, rentalPosition: Number.NaN, rentalProgress: Number.NaN }), 30);
  assert.equal(swapResumeTime({ elementTime: -5, rentalPosition: -1, rentalProgress: 0 }), 0);
});

/** Chaque tableau de dépendances d'un effet du fichier (`}, [ … ]);`). */
function depArrays(src) {
  return [...src.matchAll(/\}, \[([^\]]*)\]\);/g)].map((m) => m[1]);
}

test('VIDÉO REMONTÉE: chaque effet de useVideoLifecycle suit la key de l\'élément <video>', () => {
  const src = read(LIFECYCLE);
  const deps = depArrays(src);
  assert.equal(deps.length >= 3, true, `trois effets attendus, ${deps.length} tableaux trouvés`);
  for (const d of deps) assert.match(d, /\bvideoKey\b/, `tableau de dépendances sans videoKey : [${d}]`);
});

test('VIDÉO REMONTÉE: fin du film, reprise à l\'ouverture et position rétablie sur le nouvel élément', () => {
  const src = read(LIFECYCLE);
  assert.match(src, /addEventListener\('ended', onEnded\)/, 'la fin du film appelle onEnded');
  assert.match(src, /addEventListener\('canplay', [^)]*\{ once: true \}\)/, 'la reprise à l\'ouverture attend canplay');
  assert.match(src, /addEventListener\('loadedmetadata', [^)]*\{ once: true \}\)/, 'le remontage attend les métadonnées du nouvel élément');
  // Seulement un élément qui n'a pas déjà sa position : jamais un saut en arrière sous les pieds du visiteur.
  assert.equal((src.match(/currentTime < 1/g) ?? []).length >= 2, true, 'reprise et remontage ne touchent qu\'un élément sous 1 s');
  assert.ok(src.includes('readyState'), 'des métadonnées déjà là (cache) ne font pas manquer le remontage');
});
