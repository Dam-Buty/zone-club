// La version jouée d'un film — VF, VOSTFR, VO et leurs variantes —, décidée à UN seul endroit
// (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.1). La borne, le lecteur et la
// télécommande du Cast s'en servent tous : aucun autre code ne choisit « vf » d'office. Fonctions pures : aucun import
// de valeur, chargées telles quelles par Node dans les tests.

export type VersionAudio = 'vf' | 'vo';
export type VersionSubtitle = 'off' | 'fr' | 'en';
/** Un couple piste audio + sous-titres : la version que le visiteur voit, demande et reçoit. */
export interface VersionChoice { audio: VersionAudio; subtitle: VersionSubtitle }
/** Ce que la location offre : les deux pistes audio et les deux langues de sous-titres. */
export interface VersionOffer { vf: boolean; vo: boolean; fr: boolean; en: boolean }

// Les constantes sont gelées : elles sont rendues telles quelles par les décisions et partagées par tout le monde, une
// mutation chez un appelant les corromprait partout.
export const VF: VersionChoice = Object.freeze({ audio: 'vf', subtitle: 'off' });
export const VOSTFR: VersionChoice = Object.freeze({ audio: 'vo', subtitle: 'fr' });
export const VO: VersionChoice = Object.freeze({ audio: 'vo', subtitle: 'off' });
/** VF sous-titrée : piste française avec les sous-titres français (utile aux malentendants). */
export const VF_ST: VersionChoice = Object.freeze({ audio: 'vf', subtitle: 'fr' });
/** VO, sous-titres anglais. */
export const VO_STEN: VersionChoice = Object.freeze({ audio: 'vo', subtitle: 'en' });
/** Tout est offert : la liste du réglage « Version préférée » du compte, qui ne dépend d'aucun film. */
export const FULL_OFFER: VersionOffer = Object.freeze({ vf: true, vo: true, fr: true, en: true });

// Le sixième couple n'a ni nom ni ligne dans la liste : il n'existe que par la touche T du lecteur.
const VF_STEN: VersionChoice = Object.freeze({ audio: 'vf', subtitle: 'en' });

type VersionKey = `${VersionAudio}/${VersionSubtitle}`;

// Dans l'ordre de la liste : les trois noms connus, puis les trois combinaisons plus rares.
const COUPLES: readonly VersionChoice[] = [VF, VOSTFR, VO, VF_ST, VO_STEN, VF_STEN];

const BY_KEY: Record<VersionKey, VersionChoice> = {
  'vf/off': VF,
  'vo/fr': VOSTFR,
  'vo/off': VO,
  'vf/fr': VF_ST,
  'vo/en': VO_STEN,
  'vf/en': VF_STEN,
};

const LABELS: Record<VersionKey, { name: string; sub: string }> = {
  'vf/off': { name: 'VF', sub: 'version française' },
  'vo/fr': { name: 'VOSTFR', sub: 'version originale, sous-titres français' },
  'vo/off': { name: 'VO', sub: 'version originale, sans sous-titres' },
  'vf/fr': { name: 'VF sous-titrée', sub: 'version française, sous-titres français' },
  'vo/en': { name: 'VO, sous-titres anglais', sub: 'version originale, sous-titres anglais' },
  'vf/en': { name: 'VF · sous-titres anglais', sub: 'version française, sous-titres anglais' },
};

function keyOf(v: VersionChoice): VersionKey {
  return `${v.audio}/${v.subtitle}` as const;
}

/** Le couple canonique (gelé) de cette piste et de ces sous-titres. */
function couple(audio: VersionAudio, subtitle: VersionSubtitle): VersionChoice {
  return BY_KEY[`${audio}/${subtitle}` as const];
}

function audioOffered(offer: VersionOffer, audio: VersionAudio): boolean {
  return audio === 'vf' ? offer.vf : offer.vo;
}

/** « Sans sous-titres » est toujours possible ; une langue seulement si la location la porte. */
function subtitleOffered(offer: VersionOffer, subtitle: VersionSubtitle): boolean {
  if (subtitle === 'off') return true;
  return subtitle === 'fr' ? offer.fr : offer.en;
}

/**
 * Ce que la location offre, lu sur ses adresses de diffusion (`streaming_urls`). Pas de location lue, ou pas encore :
 * rien n'est offert. Une adresse vide n'est pas une adresse.
 */
export function versionOffer(
  urls: { vf: string | null; vo: string | null; subtitles: string | null; subtitles_en: string | null } | null | undefined,
): VersionOffer {
  const has = (url: string | null | undefined): boolean => typeof url === 'string' && url.length > 0;
  return { vf: has(urls?.vf), vo: has(urls?.vo), fr: has(urls?.subtitles), en: has(urls?.subtitles_en) };
}

/** Même couple ? Deux « rien de choisi » (null) sont le même état. */
export function sameVersion(a: VersionChoice | null, b: VersionChoice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.audio === b.audio && a.subtitle === b.subtitle;
}

/** Le couple est jouable : sa piste audio ET ses sous-titres sont offerts (on compte par couple, pas par piste). */
export function isOffered(offer: VersionOffer, v: VersionChoice): boolean {
  return audioOffered(offer, v.audio) && subtitleOffered(offer, v.subtitle);
}

/** Tous les couples jouables, dans l'ordre : VF, VOSTFR, VO, puis les combinaisons plus rares. */
export function offeredVersions(offer: VersionOffer): VersionChoice[] {
  return COUPLES.filter((v) => isOffered(offer, v));
}

/** Une piste et des sous-titres lus ailleurs (serveur, stockage) : le couple, ou null si l'un des deux est illisible. */
export function parseVersionChoice(audio: unknown, subtitle: unknown): VersionChoice | null {
  if (audio !== 'vf' && audio !== 'vo') return null;
  if (subtitle !== 'off' && subtitle !== 'fr' && subtitle !== 'en') return null;
  return couple(audio, subtitle);
}

/** Le nom affiché : « VF », « VOSTFR », « VO », « VF sous-titrée »… */
export function versionName(v: VersionChoice): string {
  return LABELS[keyOf(v)].name;
}

/** Le sous-libellé sous le nom : « version originale, sous-titres français »… */
export function versionSubLabel(v: VersionChoice): string {
  return LABELS[keyOf(v)].sub;
}

/** Sans rien de demandé : VF ; sinon VOSTFR ; sinon VO + sous-titres anglais ; sinon VO ; null sans piste audio. */
export function defaultVersion(offer: VersionOffer): VersionChoice | null {
  if (offer.vf) return VF;
  if (!offer.vo) return null;
  if (offer.fr) return VOSTFR;
  if (offer.en) return VO_STEN;
  return VO;
}

/** Après une panne de `failed` : le défaut, calculé comme si sa piste audio n'existait pas (null s'il n'en reste pas). */
export function otherVersion(offer: VersionOffer, failed: VersionChoice): VersionChoice | null {
  return defaultVersion({ ...offer, vf: offer.vf && failed.audio !== 'vf', vo: offer.vo && failed.audio !== 'vo' });
}

export type VersionDecision =
  | { kind: 'none' }
  | { kind: 'play'; version: VersionChoice; note: string | null }
  | { kind: 'ask'; title: string; body: string | null; keep: { label: string; version: VersionChoice }; other: { label: string; version: VersionChoice } };

function play(version: VersionChoice, note: string | null): VersionDecision {
  return { kind: 'play', version, note };
}

/**
 * Ce qui joue. Demandé = le choix fait pour CE film, sinon la version préférée du compte ; rien de demandé → le
 * défaut, sans note. Demandé et offert → joué, sans note. Sinon :
 * - piste VF absente → le défaut ; piste VO absente → VF — avec une note qui l'écrit (jamais de substitution muette) ;
 * - sous-titres absents sur la VO : si la VF existe, la question (`ask`) ; sans VF il n'y a rien à choisir, la VO
 *   joue avec une note ;
 * - sous-titres absents sur la VF : la VF sans sous-titres, avec une note ;
 * - aucune piste audio : `none`.
 * La réponse à la question se range en choix du film (`keep.version` / `other.version`) : la même décision, rejouée, la
 * résout alors en `play` sans note.
 */
export function decideVersion(i: { offer: VersionOffer; filmChoice: VersionChoice | null; pref: VersionChoice | null }): VersionDecision {
  const fallback = defaultVersion(i.offer);
  if (fallback === null) return { kind: 'none' };
  const wanted = i.filmChoice ?? i.pref;
  if (wanted === null) return play(fallback, null);
  if (isOffered(i.offer, wanted)) return play(wanted, null);

  if (!audioOffered(i.offer, wanted.audio)) {
    // Une piste manque, donc l'autre existe (un défaut a été trouvé).
    if (wanted.audio === 'vf') return play(fallback, `${versionName(fallback)} · VF indisponible pour ce film`);
    return play(VF, `${versionName(VF)} · VO indisponible pour ce film`);
  }

  // La piste existe, pas les sous-titres demandés (« sans sous-titres » est toujours offert : c'est une langue).
  const language = wanted.subtitle === 'fr' ? 'français' : 'anglais';
  if (wanted.audio === 'vf') return play(VF, `${versionName(VF)} · sous-titres ${language} indisponibles pour ce film`);

  const otherSubtitle = wanted.subtitle === 'fr' ? 'en' : 'fr';
  const otherLanguage = otherSubtitle === 'fr' ? 'français' : 'anglais';
  const hasOther = subtitleOffered(i.offer, otherSubtitle);
  const keep = couple('vo', hasOther ? otherSubtitle : 'off');
  if (!i.offer.vf) return play(keep, `${versionName(keep)} · sous-titres ${language} indisponibles pour ce film`);
  return {
    kind: 'ask',
    title: hasOther ? `Ce film n'a pas de sous-titres ${language}` : "Ce film n'a pas de sous-titres.",
    body: hasOther ? `La VO existe avec des sous-titres ${otherLanguage}.` : null,
    keep: { label: hasOther ? `Continuer en ${versionName(keep)}` : 'Continuer en VO sans sous-titres', version: keep },
    other: { label: 'Passer en VF', version: VF },
  };
}

/** La version qui joue d'après la décision : `play` → sa version ; `ask` → celle qu'on garde par défaut ; `none` → rien. */
export function resolvedVersion(d: VersionDecision): VersionChoice | null {
  if (d.kind === 'play') return d.version;
  if (d.kind === 'ask') return d.keep.version;
  return null;
}

export type VersionRow =
  | { kind: 'auto'; selected: boolean }
  | { kind: 'choice'; version: VersionChoice; name: string; sub: string; selected: boolean }
  | { kind: 'absent'; text: string }
  | { kind: 'more' };

function versionRow(offer: VersionOffer, current: VersionChoice | null, v: VersionChoice): VersionRow {
  const name = versionName(v);
  // Une version absente n'est jamais un bouton : une ligne de texte avec sa raison (règle « aucun bouton grisé »).
  if (!isOffered(offer, v)) return { kind: 'absent', text: `${name} · indisponible pour ce film` };
  return { kind: 'choice', version: v, name, sub: versionSubLabel(v), selected: sameVersion(current, v) };
}

/**
 * Les lignes de la liste « Version », la même partout. « Automatique » en tête quand le réglage du compte la demande
 * (choisie tant que `current` est null) ; puis VF, VOSTFR, VO — une ligne de choix si offerte, sinon sa raison écrite ;
 * puis les deux combinaisons plus rares (VF sous-titrée, VO + sous-titres anglais) : derrière « Autres versions » (`more`,
 * seulement si l'une d'elles est offerte) tant que la liste n'est pas dépliée, en lignes dès qu'elle l'est — ou dès que
 * la version courante est l'une d'elles, pour qu'on la voie cochée (le bouton n'a plus rien à ouvrir alors).
 */
export function versionRows(i: { offer: VersionOffer; current: VersionChoice | null; expanded: boolean; withAuto: boolean }): VersionRow[] {
  const rows: VersionRow[] = [];
  if (i.withAuto) rows.push({ kind: 'auto', selected: i.current === null });
  for (const v of [VF, VOSTFR, VO]) rows.push(versionRow(i.offer, i.current, v));
  const rare = [VF_ST, VO_STEN];
  if (i.expanded || rare.some((v) => sameVersion(v, i.current))) {
    for (const v of rare) rows.push(versionRow(i.offer, i.current, v));
  } else if (rare.some((v) => isOffered(i.offer, v))) {
    rows.push({ kind: 'more' });
  }
  return rows;
}

/**
 * La ligne « Version » du panneau : le nom de la version courante (« Automatique » quand aucune n'est réglée) et si un
 * appui ouvre la liste. Un film qui n'offre qu'un seul couple le dit et n'a rien à ouvrir.
 */
export function versionLine(offer: VersionOffer, current: VersionChoice | null): { text: string; openable: boolean } {
  const offered = offeredVersions(offer);
  if (offered.length === 1) return { text: `${versionName(offered[0])} · seule version de ce film`, openable: false };
  return { text: current === null ? 'Automatique' : versionName(current), openable: offered.length > 1 };
}

/** Touche V : l'autre piste audio, si elle existe ; les sous-titres sont gardés tant qu'ils restent offerts. */
export function nextAudio(offer: VersionOffer, v: VersionChoice): VersionChoice {
  const audio: VersionAudio = v.audio === 'vf' ? 'vo' : 'vf';
  if (!audioOffered(offer, audio)) return v;
  return couple(audio, subtitleOffered(offer, v.subtitle) ? v.subtitle : 'off');
}

const SUBTITLE_CYCLE: readonly VersionSubtitle[] = ['off', 'fr', 'en'];

/** Touche T : off → fr → en → off, les langues présentes seulement ; la piste audio ne change pas. */
export function nextSubtitle(offer: VersionOffer, v: VersionChoice): VersionChoice {
  const from = SUBTITLE_CYCLE.indexOf(v.subtitle);
  for (let step = 1; step <= SUBTITLE_CYCLE.length; step += 1) {
    const subtitle = SUBTITLE_CYCLE[(from + step) % SUBTITLE_CYCLE.length];
    if (subtitleOffered(offer, subtitle)) return couple(v.audio, subtitle);
  }
  return v;
}

/**
 * Les choix par film dont la location est finie sont oubliés : ne restent que ceux des films encore loués. Rien à
 * oublier → la même table (une relecture du compte ne change pas son identité).
 */
export function prunedFilmVersions(map: Record<number, VersionChoice>, activeFilmIds: readonly number[]): Record<number, VersionChoice> {
  const active = new Set(activeFilmIds);
  const keys = Object.keys(map);
  const kept: Record<number, VersionChoice> = {};
  for (const key of keys) {
    const filmId = Number(key);
    if (active.has(filmId)) kept[filmId] = map[filmId];
  }
  return Object.keys(kept).length === keys.length ? map : kept;
}

/** La table des choix telle que l'appareil la rend : un objet ordinaire, sinon (stockage abîmé) une table vide. */
export function readableFilmVersions(map: unknown): Record<number, VersionChoice> {
  return typeof map === 'object' && map !== null && !Array.isArray(map) ? (map as Record<number, VersionChoice>) : {};
}

/** Le choix retenu sur l'appareil pour ce film : le couple canonique, ou null (aucun, ou illisible). Ne lève jamais. */
export function filmChoiceIn(map: unknown, filmId: number): VersionChoice | null {
  const stored: unknown = readableFilmVersions(map)[filmId];
  if (typeof stored !== 'object' || stored === null) return null;
  const { audio, subtitle } = stored as { audio?: unknown; subtitle?: unknown };
  return parseVersionChoice(audio, subtitle);
}

/**
 * Les choix à garder quand le compte `accountId` vient d'être lu. La table est retenue sur l'appareil, pas sur le
 * compte : elle porte son propriétaire (`owner`), et seul lui la reprend — sinon le visiteur suivant sur le même
 * appareil hériterait des choix du précédent pour un film qu'ils louent tous deux. Une table d'un autre compte, sans
 * propriétaire ou illisible repart vide ; celle du compte est élaguée aux films encore loués.
 */
export function keptFilmVersions(i: { map: unknown; owner: unknown; accountId: number; activeFilmIds: readonly number[] }): Record<number, VersionChoice> {
  if (i.owner !== i.accountId) return {};
  return prunedFilmVersions(readableFilmVersions(i.map), i.activeFilmIds);
}

/**
 * La lecture du compte (`fetchMe`) vient d'échouer : la version préférée reste-t-elle ? Seul un 401 dit que le visiteur
 * n'est plus connecté — sa préférence part avec lui. Une panne réseau ou une erreur du serveur la gardent : le lecteur
 * relit le compte à chaque ouverture, et la version retombait sinon sur le défaut en plein film, sans aucune note.
 * `failedStatus` : le statut HTTP de l'échec, null sans réponse (réseau).
 */
export function keepsVersionPref(failedStatus: number | null): boolean {
  return failedStatus !== 401;
}
