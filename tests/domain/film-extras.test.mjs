import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMovieExtras } from '../../lib/tmdb-extras.ts';
import { relatedFilmIds } from '../../lib/related-films.ts';

// Réponse de TMDB pour « Get Out » (fr-FR, append_to_response=credits,release_dates),
// réduite aux champs lus — valeurs relevées sur l'API le 17/11/2026.
const GET_OUT = {
  tagline: "Ce n'est pas parce que vous êtes invité que vous êtes le bienvenu.",
  vote_average: 7.625,
  vote_count: 19659,
  production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
  credits: {
    crew: [
      { name: 'Jordan Peele', job: 'Director', department: 'Directing' },
      { name: 'Jordan Peele', job: 'Writer', department: 'Writing' },
      { name: 'Michael Abels', job: 'Original Music Composer', department: 'Sound' },
      { name: 'Toby Oliver', job: 'Director of Photography', department: 'Camera' },
      { name: 'Denson Baker', job: 'Director of Photography', department: 'Camera' },
      { name: 'Gregory Plotkin', job: 'Editor', department: 'Editing' },
    ],
  },
  release_dates: {
    results: [
      { iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3, release_date: '2017-02-24T00:00:00.000Z' }] },
      {
        iso_3166_1: 'FR',
        release_dates: [
          { certification: '', type: 1, release_date: '2017-01-23T00:00:00.000Z' },
          { certification: '12', type: 3, release_date: '2017-05-03T00:00:00.000Z' },
          { certification: '', type: 4, release_date: '2017-09-08T00:00:00.000Z' },
        ],
      },
    ],
  },
};

test('FICHE: ce que la fiche retient de TMDB pour un film', () => {
  const x = parseMovieExtras(GET_OUT);
  assert.equal(x.tagline, "Ce n'est pas parce que vous êtes invité que vous êtes le bienvenu.");
  assert.equal(x.certification, '12', 'classification de la sortie en salles en France');
  assert.equal(x.releaseDate, '2017-05-03', 'sortie en salles en France');
  assert.deepEqual(x.countries, ['États-Unis'], 'pays en français');
  assert.deepEqual(x.crew, { screenplay: ['Jordan Peele'], music: ['Michael Abels'], photography: ['Toby Oliver', 'Denson Baker'], editing: ['Gregory Plotkin'] });
  assert.deepEqual(x.vote, { average: 7.6, count: 19659 });
  assert.equal('trailer' in x, false, 'plus de bande-annonce YouTube : elles viennent d\'Allociné, sans publicité (lib/trailers.ts)');
});

test('FICHE: une réponse incomplète de TMDB ne casse rien', () => {
  const x = parseMovieExtras({});
  assert.deepEqual(x, { tagline: null, certification: null, releaseDate: null, countries: [], crew: { screenplay: [], music: [], photography: [], editing: [] }, vote: null });
  assert.equal(parseMovieExtras({ tagline: '  ' }).tagline, null, 'accroche vide');
  assert.equal(parseMovieExtras({ vote_count: 0, vote_average: 0 }).vote, null, 'note sans votes');
});

test('FICHE: « À voir aussi » — même réalisateur, puis acteurs en commun, dans nos rayons', () => {
  const target = { id: 1, directors: [{ tmdb_id: 10 }], actors: [{ tmdb_id: 100, name: 'A' }, { tmdb_id: 101, name: 'B' }] };
  const all = [
    target,
    { id: 2, directors: [{ tmdb_id: 10 }], actors: [] },
    { id: 3, directors: [{ tmdb_id: 11 }], actors: [{ tmdb_id: 100, name: 'A' }, { tmdb_id: 101, name: 'B' }] },
    { id: 4, directors: [], actors: [{ tmdb_id: 101, name: 'B' }] },
    { id: 5, directors: [{ tmdb_id: 10 }], actors: [{ tmdb_id: 100, name: 'A' }] },
    { id: 6, directors: [{ tmdb_id: 12 }], actors: [{ tmdb_id: 999, name: 'Z' }] },
  ];
  const r = relatedFilmIds(target, all);
  assert.deepEqual(r.sameDirector, [2, 5]);
  assert.deepEqual(r.sameCast, [{ id: 3, names: ['A', 'B'] }, { id: 4, names: ['B'] }], 'le plus d\'acteurs en commun d\'abord ; un film déjà « du même réalisateur » n\'est pas répété');
  assert.deepEqual(relatedFilmIds({ id: 7, directors: [], actors: [] }, all), { sameDirector: [], sameCast: [] });
});

test('FICHE: « À voir aussi » s\'arrête à six films par rangée', () => {
  const target = { id: 0, directors: [{ tmdb_id: 1 }], actors: [{ tmdb_id: 2, name: 'X' }] };
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, directors: [{ tmdb_id: 1 }], actors: [] }));
  assert.equal(relatedFilmIds(target, many).sameDirector.length, 6);
});
