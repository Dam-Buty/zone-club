// « À voir aussi » dans la fiche détaillée de la borne : les films de NOS rayons qui partagent le
// réalisateur, puis des acteurs, avec le film affiché. Les suggestions de TMDB ne tombaient sur
// aucun de nos films pour « Get Out » (0 sur 20, relevé le 17/11/2026) ; notre propre catalogue,
// lui, donne un autre film du même réalisateur pour 167 films sur 315, un acteur en commun pour 280.
// Module pur, testé : tests/domain/film-extras.test.mjs.

export interface RelatedSource {
  id: number;
  directors?: { tmdb_id: number }[] | null;
  actors?: { tmdb_id: number; name: string }[] | null;
}

export const RELATED_MAX = 6;

/**
 * Identifiants des films liés à `target` dans `all` : même réalisateur (dans l'ordre de `all`),
 * puis acteurs en commun (le plus d'acteurs partagés d'abord, avec leurs noms). Un film déjà « du
 * même réalisateur » n'est pas répété ; six films au plus par rangée.
 */
export function relatedFilmIds(
  target: RelatedSource,
  all: RelatedSource[],
): { sameDirector: number[]; sameCast: { id: number; names: string[] }[] } {
  const directors = new Set((target.directors ?? []).map((d) => d.tmdb_id));
  const cast = new Map((target.actors ?? []).map((a) => [a.tmdb_id, a.name] as const));
  const sameDirector = all
    .filter((f) => f.id !== target.id && (f.directors ?? []).some((d) => directors.has(d.tmdb_id)))
    .map((f) => f.id)
    .slice(0, RELATED_MAX);
  const taken = new Set(sameDirector);
  const sameCast = all
    .filter((f) => f.id !== target.id && !taken.has(f.id))
    .map((f) => ({
      id: f.id,
      names: [...new Set((f.actors ?? []).filter((a) => cast.has(a.tmdb_id)).map((a) => cast.get(a.tmdb_id) as string))],
    }))
    .filter((r) => r.names.length > 0)
    .sort((a, b) => b.names.length - a.names.length)
    .slice(0, RELATED_MAX);
  return { sameDirector, sameCast };
}
