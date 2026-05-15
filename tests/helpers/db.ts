import { db } from '@/lib/db'

// Tables in dependency order (children before parents for FK CASCADE).
const TABLES = [
  'return_requests',
  'rentals',
  'reviews',
  'film_requests',
  'user_facts',
  'board_notes',
  'weekly_bonuses',
  'film_genres',
  'films',
  'genres',
  'users',
  // optional tables created via lib/db.ts migrations
  'cast_sessions',
  'push_subscriptions',
]

/**
 * Wipe every row from every table. Cheaper and safer than dropping schema
 * (the connection is a singleton — recreating it would orphan the module).
 */
export function resetDb(): void {
  db.pragma('foreign_keys = OFF')
  for (const t of TABLES) {
    try {
      db.prepare(`DELETE FROM ${t}`).run()
      db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(t)
    } catch {
      // table may not exist (migrations are lazy)
    }
  }
  db.pragma('foreign_keys = ON')
}

/**
 * Insert a film row directly — bypasses the admin route + TMDB fetch chain.
 * Returns the films.id (internal). Tests that need to rent or review need
 * a stocked, available film.
 */
export function seedFilm(opts: Partial<{
  tmdb_id: number
  title: string
  aisle: string
  is_available: number
  stock: number
}> = {}): number {
  const tmdb_id = opts.tmdb_id ?? Math.floor(Math.random() * 1_000_000)
  const title = opts.title ?? `Test Film ${tmdb_id}`
  const aisle = opts.aisle ?? 'action'
  const is_available = opts.is_available ?? 1
  const stock = opts.stock ?? 2

  const info = db
    .prepare(
      `INSERT INTO films (tmdb_id, title, aisle, is_available, stock)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(tmdb_id, title, aisle, is_available, stock)
  return info.lastInsertRowid as number
}
