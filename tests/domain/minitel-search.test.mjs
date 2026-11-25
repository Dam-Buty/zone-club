// La recherche de films : ce que le visiteur tape n'a pas à reproduire la typographie du titre (batterie de tests du
// 25/11/2026 : « bout de l'enfer » ne trouvait pas « Voyage au bout de l’enfer »).
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchFilms } from '../../src/utils/minitelSearch.ts';

const films = [
  { id: 1, title: 'Voyage au bout de l’enfer' },
  { id: 2, title: "2001 : L'Odyssée de l'espace" },
  { id: 3, title: 'Spider-Man' },
  { id: 4, title: 'Le Mans 66' },
];
const ids = (q) => searchFilms(films, q).map((f) => f.id);

test('RECHERCHE: les deux apostrophes se valent', () => {
  assert.deepEqual(ids("bout de l'enfer"), [1], 'apostrophe droite tapée, typographique dans le titre');
  assert.deepEqual(ids('l’odyssée'), [2], 'apostrophe typographique tapée, droite dans le titre');
});

test('RECHERCHE: trait d\'union, espaces en trop et ponctuation ne comptent pas', () => {
  assert.deepEqual(ids('spider man'), [3]);
  assert.deepEqual(ids('spiderman'), [3], 'en un seul mot');
  assert.deepEqual(ids('le  mans'), [4], 'deux espaces');
  assert.deepEqual(ids('2001 l odyssee'), [2]);
});

test('RECHERCHE: rien de tapé, ou que de la ponctuation : aucun résultat', () => {
  assert.deepEqual(ids('   '), []);
  assert.deepEqual(ids("'-"), []);
});
