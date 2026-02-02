const RADARR_URL = process.env.RADARR_URL || 'http://radarr:7878';
const RADARR_API_KEY = process.env.RADARR_API_KEY;

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

async function radarrFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${RADARR_URL}/api/v3${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'X-Api-Key': RADARR_API_KEY || '',
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

export async function getRootFolders(): Promise<RadarrRootFolder[]> {
    return radarrFetch<RadarrRootFolder[]>('/rootfolder');
}

export async function getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    return radarrFetch<RadarrQualityProfile[]>('/qualityprofile');
}

export async function getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
    const movies = await radarrFetch<RadarrMovie[]>(`/movie?tmdbId=${tmdbId}`);
    return movies[0] || null;
}

export async function addMovie(tmdbId: number, title: string): Promise<RadarrMovie> {
    const [rootFolders, qualityProfiles] = await Promise.all([
        getRootFolders(),
        getQualityProfiles()
    ]);

    const rootFolder = rootFolders[0];
    const qualityProfile = qualityProfiles[0];

    if (!rootFolder || !qualityProfile) {
        throw new Error('Radarr not configured: missing root folder or quality profile');
    }

    // Lookup movie in TMDB via Radarr
    const lookupResults = await radarrFetch<any[]>(`/movie/lookup?term=tmdb:${tmdbId}`);

    if (lookupResults.length === 0) {
        throw new Error(`Movie not found in TMDB: ${tmdbId}`);
    }

    const movieData = lookupResults[0];

    const payload = {
        ...movieData,
        rootFolderPath: rootFolder.path,
        qualityProfileId: qualityProfile.id,
        monitored: true,
        addOptions: {
            searchForMovie: true
        }
    };

    return radarrFetch<RadarrMovie>('/movie', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function getMovieStatus(radarrId: number): Promise<RadarrMovie> {
    return radarrFetch<RadarrMovie>(`/movie/${radarrId}`);
}

export async function searchMovie(radarrId: number): Promise<void> {
    await radarrFetch('/command', {
        method: 'POST',
        body: JSON.stringify({
            name: 'MoviesSearch',
            movieIds: [radarrId]
        })
    });
}
