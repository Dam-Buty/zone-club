import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { createBackGuardStack } from '../../src/hooks/back-guard-stack.ts';

// Un historique de navigateur réduit à ce qui compte ici. Comme dans Chrome (tracé le 17/11/2026) :
// pushState est immédiat ; back() et go() sont différés, et leur cible est calculée au moment de
// l'appel, à partir de la dernière cible demandée (deux retours d'affilée reculent de deux
// entrées). L'entrée 0 est le site d'avant : y retomber, c'est avoir quitté la page.
function fakeBrowser() {
  const entries = ['site précédent', 'la page'];
  let index = 1;
  let cursor = 1;      // dernière cible demandée
  const queue = [];
  const timers = [];
  let left = false;
  const history = {
    pushState(state) { entries.length = index + 1; entries.push(state); index++; if (!queue.length) cursor = index; },
    back() { cursor -= 1; queue.push(cursor); },
    go(delta) { cursor += delta; queue.push(cursor); },
  };
  const stack = createBackGuardStack({ history: () => history, defer: (task) => { timers.push(task); } });
  const settle = () => {
    while (timers.length || queue.length) {
      while (timers.length) timers.shift()();
      while (queue.length) {
        index = queue.shift();
        if (index < 1) left = true; else stack.handlePop();
      }
      cursor = index;
    }
  };
  return {
    stack,
    settle,
    /** Geste retour du visiteur, puis tout ce qui en découle. */
    userBack() { history.back(); settle(); },
    get left() { return left; },
    get depth() { return index - 1; },   // entrées de garde sous la position courante
  };
}

test('RETOUR: le geste retour ferme la garde la plus récente, une à la fois', () => {
  const b = fakeBrowser(); const closed = [];
  b.stack.open(() => closed.push('borne'));
  b.stack.open(() => closed.push('lecteur'));
  b.settle();
  b.userBack();
  assert.deepEqual(closed, ['lecteur']);
  b.userBack();
  assert.deepEqual(closed, ['lecteur', 'borne']);
  assert.equal(b.left, false, 'deux gardes, deux gestes : la page n\'est pas quittée');
});

test('RETOUR: une garde refermée par l\'interface retire son entrée sans rien fermer d\'autre', () => {
  const b = fakeBrowser(); const closed = [];
  b.stack.open(() => closed.push('borne'));
  const release = b.stack.open(() => closed.push('lecteur'));
  b.settle();
  release();                               // bouton « fermer » du lecteur
  b.settle();
  assert.deepEqual(closed, [], 'le retrait de l\'entrée ne ferme pas la borne');
  assert.equal(b.depth, 1, 'il ne reste que l\'entrée de la borne');
  b.userBack();
  assert.deepEqual(closed, ['borne']);
  assert.equal(b.left, false);
});

// Constat du 17/11/2026, tracé dans le navigateur sur le serveur de développement : React y rejoue
// l'effet d'un composant à son montage (effet, nettoyage, effet). Le lecteur est monté à son
// ouverture : sa garde posait une entrée, lançait son retrait (différé), puis en reposait une
// aussitôt. Le retrait, appliqué après coup, laissait l'historique une entrée trop bas : le
// premier geste retour fermait le lecteur, le suivant sortait du site au lieu d'agir dans la borne.
test('RETOUR: une garde ouverte, refermée et rouverte dans la même tâche ne décale pas l\'historique', () => {
  const b = fakeBrowser(); const closed = [];
  b.stack.open(() => closed.push('borne'));
  b.settle();
  const release = b.stack.open(() => closed.push('lecteur'));   // effet
  release();                                                    // nettoyage rejoué par React
  b.stack.open(() => closed.push('lecteur'));                   // effet rejoué
  b.settle();
  assert.equal(b.depth, 2, 'une entrée pour la borne, une pour le lecteur');
  b.userBack();
  assert.deepEqual(closed, ['lecteur']);
  assert.equal(b.left, false);
  b.userBack();
  assert.deepEqual(closed, ['lecteur', 'borne'], 'le second geste agit dans la borne');
  assert.equal(b.left, false, 'la page n\'est pas quittée');
});

test('RETOUR: ouvrir et refermer vingt fois n\'empile pas les entrées', () => {
  const b = fakeBrowser();
  b.stack.open(() => {});
  for (let i = 0; i < 20; i++) { const release = b.stack.open(() => {}); b.settle(); release(); b.settle(); }
  assert.equal(b.depth, 1);
});

test('RETOUR: un geste retour fait juste après une fermeture par l\'interface agit sur la garde suivante', () => {
  const b = fakeBrowser(); const closed = [];
  b.stack.open(() => closed.push('borne'));
  const release = b.stack.open(() => closed.push('lecteur'));
  b.settle();
  release();          // l'entrée du lecteur attend encore son retrait…
  b.userBack();       // …quand le visiteur fait le geste retour
  assert.deepEqual(closed, ['borne'], 'le geste n\'est pas perdu : il ferme la garde du dessous');
  assert.equal(b.depth, 0, 'les deux entrées sont parties');
  assert.equal(b.left, false, 'et la page n\'est pas quittée');
});

test('RETOUR: useBackGuard s\'appuie sur cette pile', () => {
  const src = readText(path.join(process.cwd(), 'src/hooks/useBackGuard.ts'));
  assert.ok(src.includes('createBackGuardStack('), 'le crochet délègue à la pile testée');
  assert.ok(!/history\.back\(\)/.test(src), 'plus de retrait d\'entrée direct dans le crochet');
});
