import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { RESUME_END_MARGIN_S, swapResumeTime, resumeSeek, leavingTime } from '../../src/utils/video-swap.ts';

// La vidéo du lecteur est remontée à chaque autre piste audio (sa `key`) et à chaque « Réessayer » (spec
// 2026-11-19-versions-et-erreurs-de-lecture, § 4.3 b). Avant la tâche 8, la fin du film et la reprise restaient
// attachées à l'ancien élément : après un changement de version, plus de « BE KIND REWIND », et un changement fait
// avant la première image repartait de zéro. Ici : où reprend un élément (ou la télé), et les écouteurs qui le suivent.
// Relecture de la tâche 8 : une seule fonction pure décide aux trois endroits (reprise à l'ouverture, remontage, départ
// sur la télé) ; la règle de fin se lit sur la durée du fichier, plus sur la progression, qui ne redescend jamais.

const read = (rel) => readText(path.join(process.cwd(), rel));
const LIFECYCLE = 'src/components/player/useVideoLifecycle.ts';
const PLAYER = 'src/components/player/VHSPlayer.tsx';
/** La vidéo du seed : Big Buck Bunny, 596,48 s. */
const DURATION = 596.48;

test('REPRISE: une position enregistrée dans les 10 dernières secondes du fichier vaut le début', () => {
  assert.equal(RESUME_END_MARGIN_S, 10);
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 590, duration: DURATION }), 0);
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: DURATION, duration: DURATION }), 0, 'la fin exacte');
  // La frontière : à 10 s de la fin, c'est déjà la fin ; juste avant, la position est reprise.
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: DURATION - 10, duration: DURATION }), 0);
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: DURATION - 10.5, duration: DURATION }), DURATION - 10.5);
});

test('REPRISE: une position revue après la fin est reprise, quel que soit le pourcentage (la progression ne redescend jamais)', () => {
  // Film vu jusqu'au bout (100 %), puis revu jusqu'à 200 s : on reprend à 200 s.
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 200, duration: DURATION }), 200);
});

test('REPRISE: durée inconnue (pas encore de métadonnées) → la position enregistrée est reprise', () => {
  for (const duration of [null, Number.NaN, 0, Infinity]) {
    assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 590, duration }), 590, String(duration));
  }
});

test('REPRISE: un changement fait avant la première image reprend à la position de la location', () => {
  assert.equal(swapResumeTime({ elementTime: 0, rentalPosition: 300, duration: DURATION }), 300);
  // Un élément qui a à peine démarré (moins que la position enregistrée) ne fait pas reculer le film.
  assert.equal(swapResumeTime({ elementTime: 0.4, rentalPosition: 300, duration: DURATION }), 300);
});

test('REPRISE: un changement en cours de film garde la seconde de l\'élément', () => {
  // La location n'est enregistrée que toutes les 10 s : l'élément est en avance sur elle.
  assert.equal(swapResumeTime({ elementTime: 421.7, rentalPosition: 412, duration: DURATION }), 421.7);
  // Le générique : la seconde de l'élément est gardée (la règle de fin ne vaut que pour la position enregistrée).
  assert.equal(swapResumeTime({ elementTime: 590, rentalPosition: 0, duration: DURATION }), 590);
});

test('REPRISE: une position illisible ne compte pas', () => {
  assert.equal(swapResumeTime({ elementTime: Number.NaN, rentalPosition: 120, duration: DURATION }), 120);
  assert.equal(swapResumeTime({ elementTime: 30, rentalPosition: Number.NaN, duration: DURATION }), 30);
  assert.equal(swapResumeTime({ elementTime: -5, rentalPosition: -1, duration: DURATION }), 0);
});

// resumeSeek : ce que le crochet fait d'un élément, à l'ouverture (élément précédent : aucun, 0) comme au remontage
// (la seconde transmise par l'élément remplacé).
test('REPRISE: l\'ouverture place un élément encore au début sur la position de la location', () => {
  assert.equal(resumeSeek({ currentTime: 0, elementTime: 0, rentalPosition: 300, duration: DURATION }), 300);
  assert.equal(resumeSeek({ currentTime: 0.6, elementTime: 0, rentalPosition: 300, duration: DURATION }), 300, 'sous 1 s');
});

test('REPRISE: un élément qui a déjà sa position (1 s ou plus) n\'est jamais déplacé sous les pieds du visiteur', () => {
  assert.equal(resumeSeek({ currentTime: 1, elementTime: 0, rentalPosition: 300, duration: DURATION }), null);
  assert.equal(resumeSeek({ currentTime: 324.5, elementTime: 324.5, rentalPosition: 300, duration: DURATION }), null);
});

test('REPRISE: rien à reprendre (début, ou position dans les 10 dernières secondes) → l\'élément ne bouge pas', () => {
  assert.equal(resumeSeek({ currentTime: 0, elementTime: 0, rentalPosition: 0, duration: DURATION }), null);
  assert.equal(resumeSeek({ currentTime: 0, elementTime: 0, rentalPosition: 591, duration: DURATION }), null);
});

test('REPRISE: le remontage reprend la seconde transmise, ou la location si elle est plus loin', () => {
  assert.equal(resumeSeek({ currentTime: 0, elementTime: 324.53, rentalPosition: 320, duration: DURATION }), 324.53);
  assert.equal(resumeSeek({ currentTime: 0, elementTime: 0, rentalPosition: 120, duration: DURATION }), 120);
});

test('REPRISE: un élément remplacé avant d\'avoir repris transmet la seconde qu\'il devait reprendre', () => {
  // Deux changements rapides (le deuxième avant les métadonnées du premier) ne perdent pas la position.
  assert.equal(leavingTime({ pending: 120, currentTime: 0 }), 120);
  // Position reprise (ou rien à reprendre) : il transmet sa propre seconde.
  assert.equal(leavingTime({ pending: null, currentTime: 341.98 }), 341.98);
});

/** Chaque tableau de dépendances d'un effet du fichier (`}, [ … ]);`). */
function depArrays(src) {
  return [...src.matchAll(/\}, \[([^\]]*)\]\);/g)].map((m) => m[1]);
}

test('VIDÉO REMONTÉE: chaque effet de useVideoLifecycle suit la key de l\'élément <video>', () => {
  const src = read(LIFECYCLE);
  const deps = depArrays(src);
  // Deux effets depuis la vague de la partie A : la fin du film, et la place de l'élément (ouverture et remontage).
  assert.equal(deps.length >= 2, true, `deux effets attendus, ${deps.length} tableaux trouvés`);
  for (const d of deps) assert.match(d, /\bvideoKey\b/, `tableau de dépendances sans videoKey : [${d}]`);
});

// Relecture d'ensemble de la partie A (I2) : la reprise à l'ouverture attendait `canplay`, alors que les sauvegardes
// (éjection, fermeture, pause) écrivent dès que la durée est connue. Quitter entre les métadonnées et `canplay` — longue
// attente sur une liaison lente, sans fin quand la vidéo est retenue (question, « Regarder sur TV ? ») — écrasait la
// position enregistrée par 0. Et l'écouteur, réarmé à chaque sauvegarde, ramenait après ⏮ le film à l'ancienne position.
test('REPRISE: l\'élément est placé dès ses métadonnées, une seule fois — jamais au canplay, jamais réarmé par une sauvegarde', () => {
  const src = read(LIFECYCLE);
  assert.match(src, /addEventListener\('ended', onEnded\)/, 'la fin du film appelle onEnded');
  assert.ok(!/addEventListener\('canplay'/.test(src), 'plus aucun écouteur canplay');
  assert.match(src, /addEventListener\('loadedmetadata', place, \{ once: true \}\)/, 'la place se prend aux métadonnées du nouvel élément');
  assert.match(src, /if \(video\.readyState >= HTMLMediaElement\.HAVE_METADATA\) place\(\);/, 'des métadonnées déjà là (cache) : tout de suite');
  // Une seule pose, la même pour l'ouverture (rien à transmettre : 0) et le remontage (la seconde de l'élément remplacé).
  assert.equal((src.match(/resumeSeek\(\{/g) ?? []).length, 1, 'une seule pose, par resumeSeek');
  assert.match(src, /resumeSeek\(\{ currentTime: video\.currentTime, elementTime: pending, rentalPosition: rentalPositionRef\.current, duration: video\.duration \}\)/, 'position de la location lue à l\'arrivée des métadonnées');
  assert.match(src, /let pending: number \| null = leftRef\.current \?\? 0;/, 'à l\'ouverture, aucun élément précédent : 0');
  assert.ok(src.includes('leavingTime({'), 'la seconde transmise : leavingTime');
  assert.ok(!/Math\.max|currentTime < 1/.test(src), 'aucune règle de reprise réécrite dans le crochet');
  // L'effet de la pose ne dépend pas de la position enregistrée : une sauvegarde (après ⏮, à la pause) ne réarme rien.
  const at = src.indexOf("addEventListener('loadedmetadata'");
  const deps = src.slice(src.indexOf('}, [', at), src.indexOf(']);', at) + 3);
  assert.match(deps, /^\}, \[videoRef, videoKey\]\);$/, `dépendances de la pose : ${deps}`);
});

test('REPRISE: le départ sur la télé suit la même règle que l\'appareil', () => {
  const src = read(PLAYER);
  const start = src.indexOf('const sendToTv = useCallback(');
  const send = src.slice(start, src.indexOf('}, [', start));
  assert.match(send, /startAt: swapResumeTime\(\{ elementTime: video\?\.currentTime \?\? 0, rentalPosition: rental\?\.watchPosition \?\? 0, duration: video\?\.duration \?\? null \}\)/, 'startAt = swapResumeTime');
  assert.ok(!/Math\.max\(videoRef/.test(src), 'plus de Math.max(currentTime, watchPosition) à part');
  assert.match(src, /useVideoLifecycle\(\{ videoRef, videoKey, rentalPosition: rental\?\.watchPosition \?\? 0, onEnded: handleEnded \}\)/, 'le crochet reçoit la position brute de la location');
});
