-- Migration 001: Gamification system
-- Rentals: watch tracking, extension, rewind, viewing mode
-- Films: sub-genre for hybrid aisle system
-- Weekly bonuses: credit bonus tracking

-- Rentals: watch tracking + extension + rewind + viewing mode
ALTER TABLE rentals ADD COLUMN watch_progress INTEGER DEFAULT 0;
ALTER TABLE rentals ADD COLUMN watch_completed_at TEXT DEFAULT NULL;
ALTER TABLE rentals ADD COLUMN extension_used INTEGER DEFAULT 0;
ALTER TABLE rentals ADD COLUMN rewind_claimed INTEGER DEFAULT 0;
ALTER TABLE rentals ADD COLUMN suggestion_film_id INTEGER DEFAULT NULL;
ALTER TABLE rentals ADD COLUMN viewing_mode TEXT DEFAULT NULL;

-- Films: sub-genre for hybrid aisle system
ALTER TABLE films ADD COLUMN sub_genre TEXT DEFAULT NULL;

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
