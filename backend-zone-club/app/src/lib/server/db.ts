import Database from 'better-sqlite3';
import schema from './schema.sql?raw';

const dbPath = process.env.DATABASE_PATH || './zone.db';

export const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema (inlined by Vite at build time)
db.exec(schema);

export default db;
