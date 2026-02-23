import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

const dbPath = process.env.DATABASE_PATH || './zone.db';

export const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrate: rename radarr_id to radarr_vo_id/radarr_vf_id if old column exists
try {
    const columns = db.prepare("PRAGMA table_info(films)").all() as { name: string }[];
    const hasOldColumn = columns.some(c => c.name === 'radarr_id');
    const hasNewColumn = columns.some(c => c.name === 'radarr_vo_id');
    if (hasOldColumn && !hasNewColumn) {
        db.exec('ALTER TABLE films ADD COLUMN radarr_vo_id INTEGER');
        db.exec('ALTER TABLE films ADD COLUMN radarr_vf_id INTEGER');
        db.exec('UPDATE films SET radarr_vo_id = radarr_id');
    }
} catch {
    // Migration already done or not needed
}

// Migrate: add aisle and is_nouveaute columns
try {
    const columns = db.prepare("PRAGMA table_info(films)").all() as { name: string }[];
    if (!columns.some(c => c.name === 'aisle')) {
        db.exec('ALTER TABLE films ADD COLUMN aisle TEXT');
    }
    if (!columns.some(c => c.name === 'is_nouveaute')) {
        db.exec('ALTER TABLE films ADD COLUMN is_nouveaute BOOLEAN DEFAULT FALSE');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_films_aisle ON films(aisle)');
} catch {
    // Migration already done or not needed
}

// Migrate: add transcode columns
const transcodeMigrations = [
  'ALTER TABLE films ADD COLUMN transcode_status TEXT DEFAULT NULL',
  'ALTER TABLE films ADD COLUMN transcode_progress REAL DEFAULT 0',
  'ALTER TABLE films ADD COLUMN transcode_error TEXT DEFAULT NULL',
  'ALTER TABLE films ADD COLUMN file_path_vo_transcoded TEXT DEFAULT NULL',
  'ALTER TABLE films ADD COLUMN file_path_vf_transcoded TEXT DEFAULT NULL',
];

for (const sql of transcodeMigrations) {
  try { db.exec(sql); } catch {}
}

// Migrate: gamification system (watch tracking, extension, rewind, weekly bonus)
const gamificationMigrations = [
  'ALTER TABLE rentals ADD COLUMN watch_progress INTEGER DEFAULT 0',
  'ALTER TABLE rentals ADD COLUMN watch_completed_at TEXT DEFAULT NULL',
  'ALTER TABLE rentals ADD COLUMN extension_used INTEGER DEFAULT 0',
  'ALTER TABLE rentals ADD COLUMN rewind_claimed INTEGER DEFAULT 0',
  'ALTER TABLE rentals ADD COLUMN suggestion_film_id INTEGER DEFAULT NULL',
  'ALTER TABLE rentals ADD COLUMN viewing_mode TEXT DEFAULT NULL',
  'ALTER TABLE films ADD COLUMN sub_genre TEXT DEFAULT NULL',
];

for (const sql of gamificationMigrations) {
  try { db.exec(sql); } catch {}
}

// Weekly bonuses table (safe with IF NOT EXISTS)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_bonuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credits_awarded INTEGER NOT NULL,
      week_number TEXT NOT NULL,
      claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_bonuses_user_week ON weekly_bonuses(user_id, week_number)');
} catch {}

// Migrate: multi-copy rental system (stock, returned_early, return_requests)
const multiCopyMigrations = [
  'ALTER TABLE films ADD COLUMN stock INTEGER DEFAULT 2',
  'ALTER TABLE rentals ADD COLUMN returned_early INTEGER DEFAULT 0',
];

for (const sql of multiCopyMigrations) {
  try { db.exec(sql); } catch {}
}

// Set stock based on aisle (only on first migration)
try {
  const columns = db.prepare("PRAGMA table_info(films)").all() as { name: string }[];
  if (columns.some(c => c.name === 'stock')) {
    // Ensure default stock values by aisle
    db.exec("UPDATE films SET stock = 3 WHERE is_nouveaute = 1 AND stock = 2");
    db.exec("UPDATE films SET stock = 1 WHERE aisle = 'classiques' AND stock = 2");
    db.exec("UPDATE films SET stock = 1 WHERE aisle = 'bizarre' AND stock = 2");
  }
} catch {}

// Return requests table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS return_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      film_id INTEGER NOT NULL,
      requester_id INTEGER NOT NULL,
      rental_id INTEGER NOT NULL,
      message TEXT DEFAULT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'acknowledged', 'dismissed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_return_requests_rental ON return_requests(rental_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_return_requests_film ON return_requests(film_id)');
} catch {}

// Chat sessions table (safe with IF NOT EXISTS in schema.sql, but migration for existing DBs)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      raw_messages TEXT NOT NULL DEFAULT '[]',
      summary TEXT DEFAULT NULL,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id)');
} catch {}

export default db;
