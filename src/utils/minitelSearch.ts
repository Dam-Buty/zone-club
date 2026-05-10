import type { Film } from '../types'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

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
    else if (t.includes(q)) includes.push(f)
  }
  return [...exact, ...startsWith, ...includes].slice(0, 10)
}
