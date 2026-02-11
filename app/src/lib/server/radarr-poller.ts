import { db } from './db';
import { radarrVO, radarrVF } from './radarr';
import { getFilmById, updateFilmPaths, setFilmAvailability } from './films';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

let started = false;

// Radarr paths are absolute from its root folder (e.g. /movies/Title (Year)/file.mkv)
// We need the relative path from the root folder for symlink creation
function stripRootFolder(absolutePath: string): string {
	return absolutePath.replace(/^\/movies\//, '');
}

interface PendingFilm {
	id: number;
	title: string;
	radarr_vo_id: number | null;
	radarr_vf_id: number | null;
	file_path_vo: string | null;
	file_path_vf: string | null;
	is_available: number;
}

function getPendingFilms(): PendingFilm[] {
	return db.prepare(`
		SELECT id, title, radarr_vo_id, radarr_vf_id, file_path_vo, file_path_vf, is_available
		FROM films
		WHERE (radarr_vo_id IS NOT NULL AND file_path_vo IS NULL)
		   OR (radarr_vf_id IS NOT NULL AND file_path_vf IS NULL)
	`).all() as PendingFilm[];
}

async function pollRadarrStatus(): Promise<void> {
	const pending = getPendingFilms();
	if (pending.length === 0) return;

	for (const film of pending) {
		try {
			if (film.radarr_vo_id && !film.file_path_vo) {
				const status = await radarrVO.getMovieStatus(film.radarr_vo_id);
				if (status.hasFile && status.movieFile?.path) {
					updateFilmPaths(film.id, { file_path_vo: stripRootFolder(status.movieFile.path) });
				}
			}

			if (film.radarr_vf_id && !film.file_path_vf) {
				const status = await radarrVF.getMovieStatus(film.radarr_vf_id);
				if (status.hasFile && status.movieFile?.path) {
					updateFilmPaths(film.id, { file_path_vf: stripRootFolder(status.movieFile.path) });
				}
			}

			// Re-read to check current state after updates
			const updated = getFilmById(film.id);
			if (updated && !updated.is_available && (updated.file_path_vo || updated.file_path_vf)) {
				setFilmAvailability(film.id, true);
				console.log(`[radarr-poller] Film activé: "${updated.title}"`);
			}
		} catch (error) {
			console.error(`[radarr-poller] Erreur pour "${film.title}":`, error);
		}
	}
}

export function startRadarrPoller(): void {
	if (started) return;
	started = true;
	console.log('[radarr-poller] Démarré (intervalle: 2min)');
	pollRadarrStatus();
	setInterval(pollRadarrStatus, POLL_INTERVAL);
}
