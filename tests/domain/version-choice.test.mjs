import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VF, VOSTFR, VO, VF_ST, VO_STEN, FULL_OFFER,
  versionOffer, sameVersion, isOffered, offeredVersions, parseVersionChoice,
  versionName, versionSubLabel, defaultVersion, otherVersion,
  decideVersion, resolvedVersion, versionRows, versionLine,
  nextAudio, nextSubtitle, prunedFilmVersions,
  readableFilmVersions, filmChoiceIn, keptFilmVersions,
} from '../../src/utils/version-choice.ts';

// Une seule décision de version (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.1) : ce que le visiteur demande
// (choix fait pour le film, sinon version préférée du compte), ce que la location offre, ce qui joue. Le lecteur, la
// borne et la télécommande du Cast s'en servent tous ; aucun autre code ne choisit « vf » d'office.

const VF_EN = { audio: 'vf', subtitle: 'en' };
const SIX = [VF, VOSTFR, VO, VF_ST, VO_STEN, VF_EN];

test('VERSION: les constantes sont les couples annoncés, et la liste du compte offre tout', () => {
  assert.deepEqual(VF, { audio: 'vf', subtitle: 'off' });
  assert.deepEqual(VOSTFR, { audio: 'vo', subtitle: 'fr' });
  assert.deepEqual(VO, { audio: 'vo', subtitle: 'off' });
  assert.deepEqual(VF_ST, { audio: 'vf', subtitle: 'fr' });
  assert.deepEqual(VO_STEN, { audio: 'vo', subtitle: 'en' });
  assert.deepEqual(FULL_OFFER, { vf: true, vo: true, fr: true, en: true });
  // Partagées entre toutes les décisions : une mutation par un appelant les corromprait pour tout le monde.
  for (const v of [VF, VOSTFR, VO, VF_ST, VO_STEN, FULL_OFFER]) assert.equal(Object.isFrozen(v), true);
});

test('VERSION: ce que la location offre se lit sur les adresses de diffusion', () => {
  const urls = { vf: 'https://s/vf.mp4', vo: 'https://s/vo.mp4', subtitles: 'https://s/fr.vtt', subtitles_en: null };
  assert.deepEqual(versionOffer(urls), { vf: true, vo: true, fr: true, en: false });
  assert.deepEqual(versionOffer({ vf: null, vo: 'x', subtitles: null, subtitles_en: 'y' }), { vf: false, vo: true, fr: false, en: true });
  // Pas de location lue (ou pas encore) : rien n'est offert.
  const nothing = { vf: false, vo: false, fr: false, en: false };
  assert.deepEqual(versionOffer(null), nothing);
  assert.deepEqual(versionOffer(undefined), nothing);
  // Une adresse vide n'est pas une adresse.
  assert.deepEqual(versionOffer({ vf: '', vo: '', subtitles: '', subtitles_en: '' }), nothing);
});

test('VERSION: deux choix se comparent par couple ; un couple est offert quand sa piste ET ses sous-titres le sont', () => {
  assert.equal(sameVersion(VF, { audio: 'vf', subtitle: 'off' }), true);
  assert.equal(sameVersion(VF, VF_ST), false);
  assert.equal(sameVersion(VOSTFR, VO), false);
  assert.equal(sameVersion(VF, null), false);
  assert.equal(sameVersion(null, VF), false);
  assert.equal(sameVersion(null, null), true, 'rien de choisi des deux côtés : le même état');

  // Un film VO seul avec sous-titres français offre VOSTFR et VO (spec § 4.1 : on compte par couple).
  const voFr = { vf: false, vo: true, fr: true, en: false };
  assert.equal(isOffered(voFr, VOSTFR), true);
  assert.equal(isOffered(voFr, VO), true);
  assert.equal(isOffered(voFr, VF), false);
  assert.equal(isOffered(voFr, VF_ST), false, 'les sous-titres existent, la piste française non');
  assert.equal(isOffered(voFr, VO_STEN), false, 'la piste existe, les sous-titres anglais non');
  assert.deepEqual(offeredVersions(voFr), [VOSTFR, VO]);
});

test('VERSION: offeredVersions rend tous les couples jouables, dans l\'ordre VF, VOSTFR, VO, puis les plus rares', () => {
  assert.deepEqual(offeredVersions(FULL_OFFER), SIX);
  assert.deepEqual(offeredVersions({ vf: true, vo: false, fr: false, en: false }), [VF]);
  assert.deepEqual(offeredVersions({ vf: true, vo: true, fr: false, en: true }), [VF, VO, VO_STEN, VF_EN]);
  assert.deepEqual(offeredVersions({ vf: false, vo: false, fr: true, en: true }), []);
});

test('VERSION: sans rien de demandé — VF, sinon VOSTFR, sinon VO + anglais, sinon VO', () => {
  assert.deepEqual(defaultVersion({ vf: true, vo: true, fr: true, en: true }), VF);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: true, en: true }), VOSTFR);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: false, en: true }), VO_STEN);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: false, en: false }), VO);
  assert.equal(defaultVersion({ vf: false, vo: false, fr: true, en: true }), null);
});

test('VERSION: le choix du film prime sur la préférence, la préférence sur le défaut', () => {
  const offer = { vf: true, vo: true, fr: true, en: true };
  assert.deepEqual(decideVersion({ offer, filmChoice: VO, pref: VOSTFR }), { kind: 'play', version: VO, note: null });
  assert.deepEqual(decideVersion({ offer, filmChoice: null, pref: VOSTFR }), { kind: 'play', version: VOSTFR, note: null });
  // Rien de demandé : le défaut, sans note (l'écran n'a rien à expliquer).
  assert.deepEqual(decideVersion({ offer, filmChoice: null, pref: null }), { kind: 'play', version: VF, note: null });
  assert.deepEqual(
    decideVersion({ offer: { vf: false, vo: true, fr: true, en: true }, filmChoice: null, pref: null }),
    { kind: 'play', version: VOSTFR, note: null },
  );
});

test('VERSION: aucune piste audio → rien ne joue, quoi qu\'on demande', () => {
  const offer = { vf: false, vo: false, fr: true, en: true };
  assert.deepEqual(decideVersion({ offer, filmChoice: VF, pref: VOSTFR }), { kind: 'none' });
  assert.deepEqual(decideVersion({ offer, filmChoice: null, pref: null }), { kind: 'none' });
  assert.equal(resolvedVersion({ kind: 'none' }), null);
});

test('VERSION: VOSTFR préférée, pas de sous-titres français, VF présente → question', () => {
  const d = decideVersion({ offer: { vf: true, vo: true, fr: false, en: true }, filmChoice: null, pref: VOSTFR });
  assert.equal(d.kind, 'ask');
  assert.equal(d.title, "Ce film n'a pas de sous-titres français");
  assert.equal(d.body, 'La VO existe avec des sous-titres anglais.');
  assert.deepEqual(d.keep, { label: 'Continuer en VO, sous-titres anglais', version: VO_STEN });
  assert.deepEqual(d.other, { label: 'Passer en VF', version: VF });
});

test('VERSION: même cas sans aucun sous-titre → « Continuer en VO sans sous-titres »', () => {
  const d = decideVersion({ offer: { vf: true, vo: true, fr: false, en: false }, filmChoice: null, pref: VOSTFR });
  assert.equal(d.kind, 'ask');
  assert.equal(d.title, "Ce film n'a pas de sous-titres.");
  assert.equal(d.body, null);
  assert.deepEqual(d.keep, { label: 'Continuer en VO sans sous-titres', version: VO });
  assert.deepEqual(d.other, { label: 'Passer en VF', version: VF });
});

test('VERSION: sous-titres anglais demandés et absents → la question suit la langue demandée', () => {
  // Titre « anglais » ; l'autre langue (française) existe : on continue en VOSTFR.
  const withFr = decideVersion({ offer: { vf: true, vo: true, fr: true, en: false }, filmChoice: null, pref: VO_STEN });
  assert.equal(withFr.kind, 'ask');
  assert.equal(withFr.title, "Ce film n'a pas de sous-titres anglais");
  assert.equal(withFr.body, 'La VO existe avec des sous-titres français.');
  assert.deepEqual(withFr.keep, { label: 'Continuer en VOSTFR', version: VOSTFR });
  assert.deepEqual(withFr.other, { label: 'Passer en VF', version: VF });
  // Aucune langue : la même question que pour le français.
  const none = decideVersion({ offer: { vf: true, vo: true, fr: false, en: false }, filmChoice: null, pref: VO_STEN });
  assert.equal(none.kind, 'ask');
  assert.equal(none.title, "Ce film n'a pas de sous-titres.");
  assert.equal(none.body, null);
  assert.deepEqual(none.keep, { label: 'Continuer en VO sans sous-titres', version: VO });
});

test('VERSION: même cas sans VF → pas de question, VO jouée, note écrite', () => {
  const d = decideVersion({ offer: { vf: false, vo: true, fr: false, en: true }, filmChoice: null, pref: VOSTFR });
  assert.deepEqual(d, {
    kind: 'play',
    version: VO_STEN,
    note: 'VO, sous-titres anglais · sous-titres français indisponibles pour ce film',
  });
  // Sans aucun sous-titre non plus : la VO nue, la note dit ce qui manque.
  const bare = decideVersion({ offer: { vf: false, vo: true, fr: false, en: false }, filmChoice: null, pref: VOSTFR });
  assert.deepEqual(bare, { kind: 'play', version: VO, note: 'VO · sous-titres français indisponibles pour ce film' });
  // Sous-titres anglais demandés, seuls les français existent : VOSTFR, avec sa note.
  const en = decideVersion({ offer: { vf: false, vo: true, fr: true, en: false }, filmChoice: null, pref: VO_STEN });
  assert.deepEqual(en, { kind: 'play', version: VOSTFR, note: 'VOSTFR · sous-titres anglais indisponibles pour ce film' });
});

test('VERSION: VF préférée absente → défaut, « VOSTFR · VF indisponible pour ce film »', () => {
  const d = decideVersion({ offer: { vf: false, vo: true, fr: true, en: true }, filmChoice: null, pref: VF });
  assert.deepEqual(d, { kind: 'play', version: VOSTFR, note: 'VOSTFR · VF indisponible pour ce film' });
  // Le défaut est celui de la règle : sans sous-titres français, VO + anglais, puis VO ; le nom joué suit.
  assert.deepEqual(
    decideVersion({ offer: { vf: false, vo: true, fr: false, en: true }, filmChoice: null, pref: VF }),
    { kind: 'play', version: VO_STEN, note: 'VO, sous-titres anglais · VF indisponible pour ce film' },
  );
  assert.deepEqual(
    decideVersion({ offer: { vf: false, vo: true, fr: false, en: false }, filmChoice: VF, pref: VOSTFR }),
    { kind: 'play', version: VO, note: 'VO · VF indisponible pour ce film' },
  );
  // Une VF sous-titrée demandée sur un film sans VF : c'est encore la VF qui manque.
  assert.deepEqual(
    decideVersion({ offer: { vf: false, vo: true, fr: true, en: true }, filmChoice: null, pref: VF_ST }),
    { kind: 'play', version: VOSTFR, note: 'VOSTFR · VF indisponible pour ce film' },
  );
});

test('VERSION: VF sous-titrée préférée, pas de sous-titres français → VF sans question, note', () => {
  const d = decideVersion({ offer: { vf: true, vo: true, fr: false, en: true }, filmChoice: null, pref: VF_ST });
  assert.deepEqual(d, { kind: 'play', version: VF, note: 'VF · sous-titres français indisponibles pour ce film' });
  // « VF · sous-titres anglais » sans sous-titres anglais : même chose, la langue de la note suit la demande.
  const en = decideVersion({ offer: { vf: true, vo: true, fr: true, en: false }, filmChoice: null, pref: VF_EN });
  assert.deepEqual(en, { kind: 'play', version: VF, note: 'VF · sous-titres anglais indisponibles pour ce film' });
});

test('VERSION: choix périmé (film sans VO désormais) → VF avec « VF · VO indisponible pour ce film »', () => {
  const offer = { vf: true, vo: false, fr: true, en: false };
  assert.deepEqual(
    decideVersion({ offer, filmChoice: VO, pref: null }),
    { kind: 'play', version: VF, note: 'VF · VO indisponible pour ce film' },
  );
  // Quel que soit le couple VO demandé, et d'où qu'il vienne (préférence comprise).
  assert.deepEqual(
    decideVersion({ offer, filmChoice: null, pref: VOSTFR }),
    { kind: 'play', version: VF, note: 'VF · VO indisponible pour ce film' },
  );
  assert.deepEqual(
    decideVersion({ offer, filmChoice: VO_STEN, pref: VF }),
    { kind: 'play', version: VF, note: 'VF · VO indisponible pour ce film' },
  );
});

test('VERSION: la réponse à la question, rangée en choix du film, ne repose pas la question', () => {
  const offer = { vf: true, vo: true, fr: false, en: true };
  const asked = decideVersion({ offer, filmChoice: null, pref: VOSTFR });
  assert.equal(asked.kind, 'ask');
  // « Continuer en VO, sous-titres anglais » : le choix du film = keep.version, la préférence reste VOSTFR.
  assert.deepEqual(
    decideVersion({ offer, filmChoice: asked.keep.version, pref: VOSTFR }),
    { kind: 'play', version: VO_STEN, note: null },
  );
  // « Passer en VF ».
  assert.deepEqual(
    decideVersion({ offer, filmChoice: asked.other.version, pref: VOSTFR }),
    { kind: 'play', version: VF, note: null },
  );
  // La question n'est donc posée que tant que rien n'est choisi pour ce film.
  assert.equal(decideVersion({ offer, filmChoice: null, pref: VOSTFR }).kind, 'ask');
});

test('VERSION: ce qui joue se lit sur la décision : play → version, ask → ce qu\'on garde, none → rien', () => {
  assert.deepEqual(resolvedVersion({ kind: 'play', version: VO, note: null }), VO);
  const asked = decideVersion({ offer: { vf: true, vo: true, fr: false, en: true }, filmChoice: null, pref: VOSTFR });
  assert.deepEqual(resolvedVersion(asked), VO_STEN);
  assert.equal(resolvedVersion({ kind: 'none' }), null);
});

test('VERSION: après une panne, l\'autre version est le défaut calculé sans la piste en échec', () => {
  assert.deepEqual(otherVersion(FULL_OFFER, VF), VOSTFR);
  assert.deepEqual(otherVersion({ vf: true, vo: true, fr: false, en: true }, VF), VO_STEN);
  assert.deepEqual(otherVersion({ vf: true, vo: true, fr: false, en: false }, VF), VO);
  assert.deepEqual(otherVersion(FULL_OFFER, VOSTFR), VF);
  assert.deepEqual(otherVersion(FULL_OFFER, VO_STEN), VF);
  // Une seule piste : la panne ne laisse rien à essayer.
  assert.equal(otherVersion({ vf: true, vo: false, fr: true, en: true }, VF), null);
  assert.equal(otherVersion({ vf: false, vo: true, fr: true, en: true }, VOSTFR), null);
});

test('VERSION: noms et sous-libellés des six couples', () => {
  // Table des Global Constraints, « Noms exacts des versions ».
  const table = [
    [VF, 'VF', 'version française'],
    [VOSTFR, 'VOSTFR', 'version originale, sous-titres français'],
    [VO, 'VO', 'version originale, sans sous-titres'],
    [VF_ST, 'VF sous-titrée', 'version française, sous-titres français'],
    [VO_STEN, 'VO, sous-titres anglais', 'version originale, sous-titres anglais'],
    [VF_EN, 'VF · sous-titres anglais', 'version française, sous-titres anglais'],
  ];
  for (const [v, name, sub] of table) {
    assert.equal(versionName(v), name, name);
    assert.equal(versionSubLabel(v), sub, name);
  }
  // Tout couple a un libellé, et deux couples n'en partagent jamais un.
  assert.equal(new Set(SIX.map(versionName)).size, 6);
  assert.equal(new Set(SIX.map(versionSubLabel)).size, 6);
});

test('VERSION: lignes de la liste — absente écrite, « Autres versions », seule version', () => {
  const rows = versionRows({ offer: { vf: false, vo: true, fr: true, en: true }, current: VOSTFR, expanded: false, withAuto: false });
  assert.deepEqual(rows.map((r) => r.kind), ['absent', 'choice', 'choice', 'more']);
  assert.equal(rows[0].text, 'VF · indisponible pour ce film');
  assert.deepEqual(versionLine({ vf: false, vo: true, fr: false, en: false }, VO), { text: 'VO · seule version de ce film', openable: false });
});

test('VERSION: lignes de la liste — le détail des trois premières, la sélection suit le choix courant', () => {
  const rows = versionRows({ offer: FULL_OFFER, current: VOSTFR, expanded: false, withAuto: false });
  assert.deepEqual(rows, [
    { kind: 'choice', version: VF, name: 'VF', sub: 'version française', selected: false },
    { kind: 'choice', version: VOSTFR, name: 'VOSTFR', sub: 'version originale, sous-titres français', selected: true },
    { kind: 'choice', version: VO, name: 'VO', sub: 'version originale, sans sous-titres', selected: false },
    { kind: 'more' },
  ]);
  // Rien d'offert parmi les trois, ni parmi les deux rares : trois lignes écrites, pas de « Autres versions ».
  const bare = versionRows({ offer: { vf: false, vo: false, fr: false, en: false }, current: null, expanded: false, withAuto: false });
  assert.deepEqual(bare, [
    { kind: 'absent', text: 'VF · indisponible pour ce film' },
    { kind: 'absent', text: 'VOSTFR · indisponible pour ce film' },
    { kind: 'absent', text: 'VO · indisponible pour ce film' },
  ]);
});

test('VERSION: lignes de la liste — « Automatique » en tête du réglage du compte, choisie tant que rien n\'est réglé', () => {
  const noPref = versionRows({ offer: FULL_OFFER, current: null, expanded: false, withAuto: true });
  assert.deepEqual(noPref.map((r) => r.kind), ['auto', 'choice', 'choice', 'choice', 'more']);
  assert.deepEqual(noPref[0], { kind: 'auto', selected: true });
  assert.equal(noPref.slice(1, 4).every((r) => r.selected === false), true);
  const withPref = versionRows({ offer: FULL_OFFER, current: VO, expanded: false, withAuto: true });
  assert.deepEqual(withPref[0], { kind: 'auto', selected: false });
  assert.equal(withPref[3].selected, true);
  // Sans le réglage du compte, jamais de ligne « Automatique ».
  assert.equal(versionRows({ offer: FULL_OFFER, current: null, expanded: false, withAuto: false }).some((r) => r.kind === 'auto'), false);
});

test('VERSION: lignes de la liste — « Autres versions » les déplie ; la version courante rare reste visible', () => {
  const full = (extra) => versionRows({ offer: FULL_OFFER, current: VF, expanded: false, withAuto: false, ...extra });
  // Dépliée : les deux combinaisons rares en choix, plus de « Autres versions ».
  const open = full({ expanded: true });
  assert.deepEqual(open.map((r) => r.kind), ['choice', 'choice', 'choice', 'choice', 'choice']);
  assert.deepEqual(open[3].version, VF_ST);
  assert.equal(open[3].name, 'VF sous-titrée');
  assert.deepEqual(open[4].version, VO_STEN);
  assert.equal(open[4].sub, 'version originale, sous-titres anglais');
  // Repliée mais la version courante est l'une d'elles : elle se voit (et se montre cochée), sans bouton superflu.
  const onRare = full({ current: VO_STEN });
  assert.deepEqual(onRare.map((r) => r.kind), ['choice', 'choice', 'choice', 'choice', 'choice']);
  assert.equal(onRare[4].selected, true);
  // Une seule des deux est offerte : « Autres versions » existe, et déplié l'autre est écrite absente.
  const onlyEn = { vf: false, vo: true, fr: true, en: true };
  const folded = versionRows({ offer: onlyEn, current: VO, expanded: false, withAuto: false });
  assert.deepEqual(folded.map((r) => r.kind), ['absent', 'choice', 'choice', 'more']);
  const unfolded = versionRows({ offer: onlyEn, current: VO, expanded: true, withAuto: false });
  assert.deepEqual(unfolded.map((r) => r.kind), ['absent', 'choice', 'choice', 'absent', 'choice']);
  assert.equal(unfolded[3].text, 'VF sous-titrée · indisponible pour ce film');
  // Aucune des deux n'est offerte : pas de « Autres versions » qui n'ouvrirait rien.
  const none = versionRows({ offer: { vf: true, vo: false, fr: false, en: false }, current: VF, expanded: false, withAuto: false });
  assert.deepEqual(none.map((r) => r.kind), ['choice', 'absent', 'absent']);
});

test('VERSION: la ligne du panneau — version courante et chevron, ou seule version et rien à ouvrir', () => {
  assert.deepEqual(versionLine(FULL_OFFER, VF), { text: 'VF', openable: true });
  assert.deepEqual(versionLine(FULL_OFFER, VO_STEN), { text: 'VO, sous-titres anglais', openable: true });
  // Réglage du compte sans préférence : « Automatique ».
  assert.deepEqual(versionLine(FULL_OFFER, null), { text: 'Automatique', openable: true });
  // Deux couples jouables suffisent à ouvrir la liste.
  assert.deepEqual(versionLine({ vf: false, vo: true, fr: true, en: false }, VOSTFR), { text: 'VOSTFR', openable: true });
  // Un seul couple : son nom, la raison, pas de chevron — même sans choix courant lu.
  assert.deepEqual(versionLine({ vf: true, vo: false, fr: false, en: false }, VF), { text: 'VF · seule version de ce film', openable: false });
  assert.deepEqual(versionLine({ vf: false, vo: true, fr: false, en: false }, null), { text: 'VO · seule version de ce film', openable: false });
  // Aucune piste audio : la liste n'aurait rien à montrer, le chevron non plus.
  assert.equal(versionLine({ vf: false, vo: false, fr: true, en: true }, null).openable, false);
});

test('VERSION: touches V et T agissent chacune sur son axe', () => {
  // V : l'autre piste, les sous-titres gardés quand ils restent offerts.
  assert.deepEqual(nextAudio(FULL_OFFER, VF), VO);
  assert.deepEqual(nextAudio(FULL_OFFER, VO), VF);
  assert.deepEqual(nextAudio(FULL_OFFER, VOSTFR), VF_ST);
  assert.deepEqual(nextAudio(FULL_OFFER, VF_ST), VOSTFR);
  assert.deepEqual(nextAudio(FULL_OFFER, VO_STEN), VF_EN);
  // Sous-titres du couple de départ plus offerts : ils tombent plutôt que de proposer un couple injouable.
  assert.deepEqual(nextAudio({ vf: true, vo: true, fr: false, en: false }, { audio: 'vo', subtitle: 'fr' }), VF);
  // L'autre piste n'existe pas : rien ne change.
  assert.deepEqual(nextAudio({ vf: false, vo: true, fr: true, en: true }, VOSTFR), VOSTFR);
  assert.deepEqual(nextAudio({ vf: true, vo: false, fr: true, en: true }, VF), VF);

  // T : off → fr → en → off, sans toucher à la piste.
  assert.deepEqual(nextSubtitle(FULL_OFFER, VF), VF_ST);
  assert.deepEqual(nextSubtitle(FULL_OFFER, VF_ST), VF_EN);
  assert.deepEqual(nextSubtitle(FULL_OFFER, VF_EN), VF);
  assert.deepEqual(nextSubtitle(FULL_OFFER, VO), VOSTFR);
  assert.deepEqual(nextSubtitle(FULL_OFFER, VOSTFR), VO_STEN);
  assert.deepEqual(nextSubtitle(FULL_OFFER, VO_STEN), VO);
  // Les langues absentes sont sautées.
  const onlyEn = { vf: true, vo: true, fr: false, en: true };
  assert.deepEqual(nextSubtitle(onlyEn, VO), VO_STEN);
  assert.deepEqual(nextSubtitle(onlyEn, VO_STEN), VO);
  const onlyFr = { vf: true, vo: true, fr: true, en: false };
  assert.deepEqual(nextSubtitle(onlyFr, VO), VOSTFR);
  assert.deepEqual(nextSubtitle(onlyFr, VOSTFR), VO);
  // Aucune langue : T ne change rien.
  assert.deepEqual(nextSubtitle({ vf: true, vo: true, fr: false, en: false }, VF), VF);
});

test('VERSION: entrées illisibles → null ; choix des films rendus retirés', () => {
  assert.deepEqual(parseVersionChoice('vo', 'fr'), VOSTFR);
  for (const v of SIX) assert.deepEqual(parseVersionChoice(v.audio, v.subtitle), v);
  assert.equal(parseVersionChoice('xx', 'fr'), null);
  assert.equal(parseVersionChoice('vf', 'de'), null);
  assert.equal(parseVersionChoice('VF', 'off'), null, 'la casse compte : le serveur n\'écrit que du minuscule');
  assert.equal(parseVersionChoice(undefined, 'off'), null);
  assert.equal(parseVersionChoice('vf', undefined), null);
  assert.equal(parseVersionChoice(null, null), null);
  assert.equal(parseVersionChoice(1, 2), null);
  assert.equal(parseVersionChoice({}, []), null);

  const map = { 1: VF, 2: VO, 3: VOSTFR };
  const kept = prunedFilmVersions(map, [2, 3, 9]);
  assert.deepEqual(kept, { 2: VO, 3: VOSTFR });
  assert.deepEqual(map, { 1: VF, 2: VO, 3: VOSTFR }, 'la table d\'origine n\'est pas modifiée');
  assert.deepEqual(prunedFilmVersions(map, []), {});
  assert.deepEqual(prunedFilmVersions({}, [1, 2]), {});
  assert.notEqual(kept, map, 'un élagage rend une table neuve');
});

test('VERSION: rien à élaguer → la même table, pour qu\'une relecture ne change pas l\'identité', () => {
  const map = { 1: VF, 2: VO, 3: VOSTFR };
  assert.equal(prunedFilmVersions(map, [1, 2, 3]), map);
  assert.equal(prunedFilmVersions(map, [3, 9, 1, 2]), map, 'des locations sans choix ne comptent pas');
  const empty = {};
  assert.equal(prunedFilmVersions(empty, [1, 2]), empty);
  assert.deepEqual(map, { 1: VF, 2: VO, 3: VOSTFR }, 'jamais modifiée');
});

// Stockage de l'appareil abîmé (édité à la main, format d'une autre version) : une table illisible compte comme vide,
// une entrée illisible comme aucun choix — rien ne lève, ni dans fetchMe (qui conclurait à une déconnexion), ni à la
// décision de version.
const UNREADABLE_MAPS = [null, undefined, 'vo', 42, true, [], [VF, VO]];

test('VERSION: une table de choix illisible sur l\'appareil compte comme vide, sans lever', () => {
  for (const map of UNREADABLE_MAPS) {
    let read;
    assert.doesNotThrow(() => { read = readableFilmVersions(map); }, JSON.stringify(map));
    assert.deepEqual(read, {}, `${JSON.stringify(map)} → table vide`);
  }
  const map = { 4: VOSTFR };
  assert.equal(readableFilmVersions(map), map, 'une table lisible est rendue telle quelle');
});

test('VERSION: le choix retenu pour un film est le couple canonique, ou null s\'il est absent ou illisible', () => {
  // Relu du stockage (JSON) : un objet ordinaire et des clés en texte ; la décision reçoit le couple gelé.
  const stored = JSON.parse(JSON.stringify({ 42: VOSTFR, 7: VF }));
  assert.equal(filmChoiceIn(stored, 42), VOSTFR, 'le couple canonique (même objet)');
  assert.equal(filmChoiceIn(stored, 7), VF);
  assert.equal(filmChoiceIn(stored, 8), null, 'aucun choix pour ce film');
  for (const map of UNREADABLE_MAPS) {
    let read;
    assert.doesNotThrow(() => { read = filmChoiceIn(map, 42); }, JSON.stringify(map));
    assert.equal(read, null, `table ${JSON.stringify(map)}`);
  }
  for (const entry of ['vo', 5, null, true, [], {}, { audio: 'xx', subtitle: 'fr' }, { audio: 'vo' }, ['vo', 'fr']]) {
    let read;
    assert.doesNotThrow(() => { read = filmChoiceIn({ 42: entry }, 42); }, JSON.stringify(entry));
    assert.equal(read, null, `entrée ${JSON.stringify(entry)}`);
  }
});

// Les choix par film sont retenus sur l'appareil SANS compte : sans propriétaire, le visiteur suivant sur le même
// appareil (session de A échue sans déconnexion, puis B se connecte) jouerait un film loué par les deux dans la
// version choisie par A. La table porte donc son propriétaire ; elle n'est reprise que par lui.
test('VERSION: après une lecture du compte, ses choix pour ses films encore loués, jamais ceux d\'un autre compte', () => {
  const map = { 42: VO, 7: VOSTFR };
  // Même compte : élaguée aux locations actives ; rien à élaguer → la même table.
  assert.deepEqual(keptFilmVersions({ map, owner: 4, accountId: 4, activeFilmIds: [42] }), { 42: VO });
  assert.equal(keptFilmVersions({ map, owner: 4, accountId: 4, activeFilmIds: [42, 7] }), map);
  // Le scénario de la relecture : A (4) a choisi la VO du film 42 ; B (9), qui loue aussi le 42, ne l'hérite pas.
  assert.deepEqual(keptFilmVersions({ map, owner: 4, accountId: 9, activeFilmIds: [42, 7] }), {});
  // Sans propriétaire, ou un propriétaire illisible : la table n'est à personne, elle part.
  for (const owner of [null, undefined, '4', 0, NaN, {}]) {
    assert.deepEqual(keptFilmVersions({ map, owner, accountId: 4, activeFilmIds: [42, 7] }), {}, `propriétaire ${String(owner)}`);
  }
  // Une table illisible, même au bon propriétaire : vide, sans lever.
  for (const bad of UNREADABLE_MAPS) {
    let kept;
    assert.doesNotThrow(() => { kept = keptFilmVersions({ map: bad, owner: 4, accountId: 4, activeFilmIds: [42] }); }, JSON.stringify(bad));
    assert.deepEqual(kept, {}, JSON.stringify(bad));
  }
  assert.deepEqual(map, { 42: VO, 7: VOSTFR }, 'jamais modifiée');
});
