import type { Film } from '../types'

// Minuscules, sans accents ; apostrophes (droite ou typographique), traits d'union, ponctuation et espaces en trop
// deviennent un seul espace : « bout de l'enfer » trouve « Voyage au bout de l’enfer », « le  mans » trouve « Le Mans ».
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Sans aucun espace : « spiderman » trouve « Spider-Man ».
const compact = (s: string): string => s.replace(/ /g, '')

export function searchFilms(films: Film[], query: string): Film[] {
  const q = normalize(query)
  if (!q) return []
  const exact: Film[] = []
  const startsWith: Film[] = []
  const includes: Film[] = []
  for (const f of films) {
    const t = normalize(f.title)
    if (t === q) exact.push(f)
    else if (t.startsWith(q)) startsWith.push(f)
    else if (t.includes(q) || compact(t).includes(compact(q))) includes.push(f)
  }
  return [...exact, ...startsWith, ...includes].slice(0, 10)
}
