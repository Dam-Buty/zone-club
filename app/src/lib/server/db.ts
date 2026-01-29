import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || './zone.db';

export const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    recovery_phrase_hash TEXT NOT NULL,
    credits INTEGER DEFAULT 5,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Films table
CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id INTEGER UNIQUE NOT NULL,
    title TEXT NOT NULL,
    title_original TEXT,
    synopsis TEXT,
    release_year INTEGER,
    poster_url TEXT,
    backdrop_url TEXT,
    genres TEXT,
    directors TEXT,
    actors TEXT,
    runtime INTEGER,
    file_path_vf TEXT,
    file_path_vo TEXT,
    subtitle_path TEXT,
    radarr_vo_id INTEGER,
    radarr_vf_id INTEGER,
    is_available BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Genres table (rayons)
CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    tmdb_id INTEGER UNIQUE
);

-- Film-Genre relationship
CREATE TABLE IF NOT EXISTS film_genres (
    film_id INTEGER NOT NULL,
    genre_id INTEGER NOT NULL,
    PRIMARY KEY (film_id, genre_id),
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

-- Rentals table
CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    symlink_uuid TEXT NOT NULL,
    rented_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    rating_direction INTEGER NOT NULL CHECK(rating_direction BETWEEN 1 AND 5),
    rating_screenplay INTEGER NOT NULL CHECK(rating_screenplay BETWEEN 1 AND 5),
    rating_acting INTEGER NOT NULL CHECK(rating_acting BETWEEN 1 AND 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    UNIQUE(user_id, film_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_film ON rentals(film_id);
CREATE INDEX IF NOT EXISTS idx_rentals_active ON rentals(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_reviews_film ON reviews(film_id);
CREATE INDEX IF NOT EXISTS idx_films_available ON films(is_available);
CREATE INDEX IF NOT EXISTS idx_films_tmdb ON films(tmdb_id);
`;

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
