// Lecture des dates envoyées par le serveur.
//
// SQLite les stocke en UTC, sans fuseau : « 2026-11-18 18:00:56.106 ». Passée telle quelle à
// `new Date()`, une telle chaîne est prise pour une heure LOCALE (et certains navigateurs la
// refusent) : une location qui expire à 19:00, heure de Paris, s'affichait « jusqu'à 18:00 ».
//
// Module sans import : il est chargé tel quel par Node dans les tests.

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Millisecondes depuis l'époque, ou NaN si la valeur est absente ou illisible. */
export function parseServerDate(value: string | null | undefined): number {
  if (!value) return NaN;
  const iso = value.trim().replace(' ', 'T');
  return Date.parse(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
}
