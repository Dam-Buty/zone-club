#!/run/current-system/sw/bin/bash
DB="${DATABASE_PATH:-zone.db}"
watch -n 5 "sqlite3 -header -column $DB \"
SELECT title, transcode_status AS status,
       printf('%.1f%%', transcode_progress) AS progress,
       transcode_error AS error
FROM films
WHERE transcode_status IS NOT NULL AND transcode_progress > 0 AND transcode_progress < 100
ORDER BY transcode_progress ASC;
\""
