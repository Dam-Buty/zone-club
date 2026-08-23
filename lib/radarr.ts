export interface RadarrMovie {
    id: number;
    title: string;
    tmdbId: number;
    path: string;
    hasFile: boolean;
    movieFile?: {
        path: string;
        relativePath: string;
    };
}

export interface RadarrRootFolder {
    id: number;
    path: string;
}

export interface RadarrQueueItem {
    id: number;
    movieId: number;
    title: string;
    downloadId?: string;
    status: string;
    trackedDownloadState?: string;
    trackedDownloadStatus?: string;
    statusMessages?: { title?: string; messages?: string[] }[];
    errorMessage?: string;
}

export interface RadarrQualityProfile {
    id: number;
    name: string;
}

class RadarrClient {
    constructor(
        private url: string,
        private apiKey: string
    ) {}

    async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.url}/api/v3${endpoint}`;

        const response = await fetch(url, {
            ...options,
            signal: options.signal ?? AbortSignal.timeout(15000),
            headers: {
                'X-Api-Key': this.apiKey,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Radarr API error: ${response.status} - ${text}`);
        }

        return response.json();
    }

    async getRootFolders(): Promise<RadarrRootFolder[]> {
        return this.fetch<RadarrRootFolder[]>('/rootfolder');
    }

    async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
        return this.fetch<RadarrQualityProfile[]>('/qualityprofile');
    }

    async getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
        const movies = await this.fetch<RadarrMovie[]>(`/movie?tmdbId=${tmdbId}`);
        return movies[0] || null;
    }

    async addMovie(tmdbId: number, title: string, qualityProfileId?: number): Promise<RadarrMovie> {
        // Check if movie already exists in Radarr
        const existing = await this.getMovieByTmdbId(tmdbId);
        if (existing) {
            // Trigger a new search if needed
            await this.searchMovie(existing.id);
            return existing;
        }

        const rootFolders = await this.getRootFolders();
        const rootFolder = rootFolders[0];

        if (!rootFolder) {
            throw new Error('Radarr not configured: missing root folder');
        }

        const lookupResults = await this.fetch<any[]>(`/movie/lookup?term=tmdb:${tmdbId}`);

        if (lookupResults.length === 0) {
            throw new Error(`Movie not found in TMDB: ${tmdbId}`);
        }

        const movieData = lookupResults[0];

        const payload = {
            ...movieData,
            rootFolderPath: rootFolder.path,
            qualityProfileId: qualityProfileId ?? parseInt(process.env.RADARR_QUALITY_PROFILE_ID || '7', 10),
            monitored: true,
            addOptions: {
                searchForMovie: true
            }
        };

        return this.fetch<RadarrMovie>('/movie', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async getMovieStatus(radarrId: number): Promise<RadarrMovie> {
        return this.fetch<RadarrMovie>(`/movie/${radarrId}`);
    }

    async searchMovie(radarrId: number): Promise<void> {
        await this.fetch('/command', {
            method: 'POST',
            body: JSON.stringify({
                name: 'MoviesSearch',
                movieIds: [radarrId]
            })
        });
    }

    async getMovieFiles(radarrId: number): Promise<{ id: number; relativePath?: string }[]> {
        return this.fetch<{ id: number; relativePath?: string }[]>(`/moviefile?movieId=${radarrId}`);
    }

    // DELETE ne renvoie pas de JSON → on court-circuite this.fetch (qui parse).
    async deleteMovieFile(movieFileId: number): Promise<void> {
        const res = await fetch(`${this.url}/api/v3/moviefile/${movieFileId}`, {
            method: 'DELETE',
            headers: { 'X-Api-Key': this.apiKey },
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok && res.status !== 404) {
            throw new Error(`Radarr deleteMovieFile ${res.status}: ${await res.text()}`);
        }
    }

    async getQueue(): Promise<RadarrQueueItem[]> {
        const page = await this.fetch<{ records: RadarrQueueItem[] }>('/queue?pageSize=200');
        return page.records || [];
    }

    async removeQueueItem(queueId: number, blocklist: boolean): Promise<void> {
        const res = await fetch(
            `${this.url}/api/v3/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`,
            { method: 'DELETE', headers: { 'X-Api-Key': this.apiKey }, signal: AbortSignal.timeout(30000) }
        );
        if (!res.ok && res.status !== 404) {
            throw new Error(`Radarr removeQueueItem ${res.status}: ${await res.text()}`);
        }
    }

    async getMovieHistory(radarrId: number): Promise<{ id: number; eventType: string; sourceTitle?: string }[]> {
        return this.fetch<{ id: number; eventType: string; sourceTitle?: string }[]>(`/history/movie?movieId=${radarrId}`);
    }

    // Marque le grab comme échoué : Radarr blackliste la release (elle ne sera plus
    // reproposée) et relance une recherche si le film est monitored.
    async markHistoryFailed(historyId: number): Promise<void> {
        const res = await fetch(`${this.url}/api/v3/history/failed/${historyId}`, {
            method: 'POST',
            headers: { 'X-Api-Key': this.apiKey },
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error(`Radarr markHistoryFailed ${res.status}: ${await res.text()}`);
    }

    async setMonitored(radarrId: number, monitored: boolean): Promise<void> {
        const movie = await this.fetch<any>(`/movie/${radarrId}`);
        await this.fetch(`/movie/${radarrId}`, {
            method: 'PUT',
            body: JSON.stringify({ ...movie, monitored })
        });
    }
}

function requireEnv(name: string, fallback?: string): string {
    const val = process.env[name];
    if (val) return val;
    if (fallback !== undefined) return fallback;
    if (process.env.NODE_ENV === 'production') {
        throw new Error(`${name} environment variable is required in production`);
    }
    return '';
}

export const radarr = new RadarrClient(
    requireEnv('RADARR_URL', 'http://radarr:7878'),
    requireEnv('RADARR_API_KEY')
);

export async function addMovie(tmdbId: number, title: string, qualityProfileId?: number): Promise<{ id: number }> {
    const movie = await radarr.addMovie(tmdbId, title, qualityProfileId);
    return { id: movie.id };
}

export async function getMovieStatus(radarrId: number): Promise<RadarrMovie> {
    return radarr.getMovieStatus(radarrId);
}

export async function searchMovie(radarrId: number): Promise<void> {
    return radarr.searchMovie(radarrId);
}

export async function setMonitored(radarrId: number, monitored: boolean): Promise<void> {
    return radarr.setMonitored(radarrId, monitored);
}

// Rejette la release actuellement importée pour ce film : supprime le fichier,
// blackliste le grab correspondant, et relance une recherche.
// Retourne le titre de la release rejetée (pour les logs), ou null si rien à rejeter.
export async function rejectCurrentRelease(radarrId: number): Promise<string | null> {
    const files = await radarr.getMovieFiles(radarrId);
    for (const f of files) {
        await radarr.deleteMovieFile(f.id);
    }

    const history = await radarr.getMovieHistory(radarrId);
    // Le plus récent `grabbed` correspond à la release qu'on vient de juger.
    const grab = history.find(h => h.eventType === 'grabbed');
    if (grab) await radarr.markHistoryFailed(grab.id);

    // On s'assure seulement que le film est monitored. PAS de searchMovie ici :
    // `autoRedownloadFailed` est actif côté Radarr, qui relance donc sa propre
    // recherche après markHistoryFailed. Un appel explicite en plus faisait courir
    // les deux en parallèle — observé le 23/08 sur Interstellar, où deux
    // téléchargements de 24 Go de la même release ont démarré à 5 s d'intervalle.
    await radarr.setMonitored(radarrId, true);

    return grab?.sourceTitle ?? null;
}

export async function getQueue(): Promise<RadarrQueueItem[]> {
    return radarr.getQueue();
}

export async function removeQueueItem(queueId: number, blocklist: boolean): Promise<void> {
    return radarr.removeQueueItem(queueId, blocklist);
}
