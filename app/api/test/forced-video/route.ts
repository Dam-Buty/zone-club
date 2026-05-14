import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';

function parseRange(range: string, totalSize: number): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return null;

    const startStr = match[1];
    const endStr = match[2];

    let start = startStr ? Number(startStr) : 0;
    let end = endStr ? Number(endStr) : totalSize - 1;

    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    if (start > end) return null;
    if (start < 0) start = 0;
    if (end >= totalSize) end = totalSize - 1;

    return { start, end };
}

export async function GET(request: NextRequest) {
    // Auth gate — previously this route streamed an arbitrary video file to
    // anyone hitting it. Require a valid session OR (admin) for prod safety.
    // FORCED_RENTAL_FILE_PATH is a dev/staging convenience; we still let
    // authenticated users use it (the original intent), but no longer anon.
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const forcedPath = process.env.FORCED_RENTAL_FILE_PATH;
    if (!forcedPath) {
        return NextResponse.json(
            { error: 'FORCED_RENTAL_FILE_PATH non configuré' },
            { status: 404 }
        );
    }

    let fileSize = 0;
    try {
        fileSize = (await stat(forcedPath)).size;
    } catch {
        return NextResponse.json(
            { error: 'Fichier forcé introuvable' },
            { status: 404 }
        );
    }

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
        const parsed = parseRange(rangeHeader, fileSize);
        if (!parsed) {
            return new NextResponse(null, {
                status: 416,
                headers: {
                    'Content-Range': `bytes */${fileSize}`,
                    'Accept-Ranges': 'bytes',
                },
            });
        }

        const { start, end } = parsed;
        const stream = createReadStream(forcedPath, { start, end });
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

        return new NextResponse(body, {
            status: 206,
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(end - start + 1),
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'private, no-store',
            },
        });
    }

    const stream = createReadStream(forcedPath);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return new NextResponse(body, {
        headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(fileSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, no-store',
        },
    });
}
