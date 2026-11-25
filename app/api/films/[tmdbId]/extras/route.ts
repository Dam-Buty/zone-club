import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { getFilmByTmdbId } from '@/lib/films';
import { getMovieForExtras } from '@/lib/tmdb';
import { parseMovieExtras, type FilmExtras } from '@/lib/tmdb-extras';

// Fiche détaillée de la borne : accroche, classification et sortie en France, pays, équipe, note
// des spectateurs — demandés à TMDB à la première ouverture de la fiche, puis
// gardés 30 jours (mémoire, puis disque, comme les jaquettes de /api/poster). Rien en base : pas de
// migration ni de rattrapage du catalogue.

const CACHE_DIR = process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const memory = new Map<number, { at: number; extras: FilmExtras }>();

function ok(extras: FilmExtras, cache: string) {
    return NextResponse.json(extras, { headers: { 'Cache-Control': 'public, max-age=86400', 'X-Extras-Cache': cache } });
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ tmdbId: string }> }
) {
    const tmdbId = parseInt((await params).tmdbId);
    if (isNaN(tmdbId)) {
        return NextResponse.json({ error: 'ID TMDB invalide' }, { status: 400 });
    }
    const film = getFilmByTmdbId(tmdbId);
    if (!film || !film.is_available) {
        return NextResponse.json({ error: 'Film non trouvé' }, { status: 404 });
    }

    const now = Date.now();
    const inMemory = memory.get(tmdbId);
    if (inMemory && now - inMemory.at < MAX_AGE_MS) return ok(inMemory.extras, 'MEMORY');

    const file = join(CACHE_DIR, `extras-${tmdbId}.json`);
    try {
        const info = await stat(file);
        if (now - info.mtimeMs < MAX_AGE_MS) {
            const extras = JSON.parse(await readFile(file, 'utf8')) as FilmExtras;
            memory.set(tmdbId, { at: info.mtimeMs, extras });
            return ok(extras, 'DISK');
        }
    } catch {
        // Pas encore en cache.
    }

    if (!process.env.TMDB_API_KEY) {
        return NextResponse.json({ error: 'TMDB non configuré' }, { status: 503 });
    }
    try {
        const extras = parseMovieExtras(await getMovieForExtras(tmdbId));
        memory.set(tmdbId, { at: now, extras });
        mkdir(CACHE_DIR, { recursive: true })
            .then(() => writeFile(file, JSON.stringify(extras)))
            .catch(() => {}); // un cache qui ne s'écrit pas ne fait pas échouer la fiche
        return ok(extras, 'MISS');
    } catch (error) {
        console.error('[extras] TMDB en échec pour', tmdbId, error);
        return NextResponse.json({ error: 'TMDB indisponible' }, { status: 502 });
    }
}
