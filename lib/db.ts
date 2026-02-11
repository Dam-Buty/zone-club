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

export default db;
