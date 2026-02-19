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
    aisle TEXT,
    is_nouveaute BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT FALSE,
    transcode_status TEXT DEFAULT NULL,
    transcode_progress REAL DEFAULT 0,
    transcode_error TEXT DEFAULT NULL,
    file_path_vo_transcoded TEXT DEFAULT NULL,
    file_path_vf_transcoded TEXT DEFAULT NULL,
    sub_genre TEXT DEFAULT NULL,
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
    watch_progress INTEGER DEFAULT 0,
    watch_completed_at TEXT DEFAULT NULL,
    extension_used INTEGER DEFAULT 0,
    rewind_claimed INTEGER DEFAULT 0,
    suggestion_film_id INTEGER DEFAULT NULL,
    viewing_mode TEXT DEFAULT NULL,
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

-- Film requests table (user suggestions)
CREATE TABLE IF NOT EXISTS film_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'added')),
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(tmdb_id)
);

-- Weekly bonus tracking
CREATE TABLE IF NOT EXISTS weekly_bonuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credits_awarded INTEGER NOT NULL,
    week_number TEXT NOT NULL,
    claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_bonuses_user_week ON weekly_bonuses(user_id, week_number);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_film ON rentals(film_id);
CREATE INDEX IF NOT EXISTS idx_rentals_active ON rentals(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_reviews_film ON reviews(film_id);
CREATE INDEX IF NOT EXISTS idx_films_available ON films(is_available);
CREATE INDEX IF NOT EXISTS idx_films_tmdb ON films(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_film_requests_status ON film_requests(status);
CREATE INDEX IF NOT EXISTS idx_film_requests_tmdb ON film_requests(tmdb_id);
