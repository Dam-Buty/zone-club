import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { getFilmByTmdbId } from '@/lib/films';
import { byteRange } from '@/lib/trailer-source';
import { trailerFile } from '@/lib/trailers';

// Le fichier de la bande-annonce d'un film, une fois récupéré (voir ./status). Servi par plages
// d'octets : le lecteur vidéo en a besoin pour démarrer vite et pour avancer dans la vidéo.

export async function GET(
    request: NextRequest,
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

    const path = trailerFile(tmdbId);
    let size: number;
    try {
        size = (await stat(path)).size;
    } catch {
        return NextResponse.json({ error: 'Bande-annonce pas encore disponible' }, { status: 404 });
    }

    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
    const header = request.headers.get('range');
    if (header) {
        const range = byteRange(header, size);
        if (!range) {
            return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
        }
        const body = Readable.toWeb(createReadStream(path, range)) as ReadableStream<Uint8Array>;
        return new NextResponse(body, {
            status: 206,
            headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
        });
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new NextResponse(body, { headers: { ...headers, 'Content-Length': String(size) } });
}
