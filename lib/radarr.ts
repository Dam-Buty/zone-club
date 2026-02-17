interface RadarrMovie {
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

interface RadarrRootFolder {
    id: number;
    path: string;
}

interface RadarrQualityProfile {
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

    async addMovie(tmdbId: number, title: string): Promise<RadarrMovie> {
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
            qualityProfileId: 6,
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
}

export const radarrVO = new RadarrClient(
    process.env.RADARR_VO_URL || 'http://radarr-vo:7878',
    process.env.RADARR_VO_API_KEY || ''
);

export const radarrVF = new RadarrClient(
    process.env.RADARR_VF_URL || 'http://radarr-vf:7878',
    process.env.RADARR_VF_API_KEY || ''
);

export async function addMovie(tmdbId: number, title: string): Promise<{ vo: RadarrMovie; vf: RadarrMovie }> {
    const [vo, vf] = await Promise.all([
        radarrVO.addMovie(tmdbId, title),
        radarrVF.addMovie(tmdbId, title)
    ]);
    return { vo, vf };
}

export async function getMovieStatus(radarrId: number, instance: 'vo' | 'vf'): Promise<RadarrMovie> {
    const client = instance === 'vo' ? radarrVO : radarrVF;
    return client.getMovieStatus(radarrId);
}

export async function searchMovie(radarrId: number, instance: 'vo' | 'vf'): Promise<void> {
    const client = instance === 'vo' ? radarrVO : radarrVF;
    return client.searchMovie(radarrId);
}
