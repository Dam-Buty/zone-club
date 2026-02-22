import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { getUserFromSession } from '@/lib/session';
import { getRentalDownloadSource } from '@/lib/rentals';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr, 10);
    if (Number.isNaN(filmId)) {
        return NextResponse.json({ error: 'ID film invalide' }, { status: 400 });
    }

    try {
        const source = await getRentalDownloadSource(user.id, filmId);
        const fileStats = await stat(source.absolutePath);
        const stream = createReadStream(source.absolutePath);
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

        return new NextResponse(body, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(fileStats.size),
                'Content-Disposition': `attachment; filename="${source.filename}"; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
                'Cache-Control': 'private, no-store',
            },
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
