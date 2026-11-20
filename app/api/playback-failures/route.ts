import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { briefBrowser, parsePlaybackFailure, PLAYBACK_FAILURE_MAX_BODY_BYTES } from '@/lib/playback-failure-parse';
import { savePlaybackFailure } from '@/lib/playback-failures';

// POST — le navigateur dit qu'un film ne démarre pas : quel film, quelle version, où (appareil ou télé), quel
// genre d'échec, où en était la lecture. Le navigateur est lu ICI, sur l'en-tête User-Agent, pas dans le corps.
// Session requise. Rien d'une adresse de diffusion n'est lu ni journalisé : le corps n'est jamais écrit dans un
// journal, et seuls les champs nommés par parsePlaybackFailure traversent. Le client n'attend rien de la réponse.
export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return new NextResponse(null, { status: 401 });

    // Un visiteur dont le film ne démarre pas réessaie : un plafond large, mais un plafond.
    if (checkRateLimit(getRateLimitKey(request, 'playback-failure'), 30, 15 * 60 * 1000) !== null) {
        return new NextResponse(null, { status: 429 });
    }

    // La taille annoncée est refusée avant de lire quoi que ce soit ; celle qui est lue est mesurée en octets.
    if (Number(request.headers.get('content-length')) > PLAYBACK_FAILURE_MAX_BODY_BYTES) {
        return new NextResponse(null, { status: 413 });
    }
    const body = await request.text();
    if (body.length === 0 || Buffer.byteLength(body, 'utf8') > PLAYBACK_FAILURE_MAX_BODY_BYTES) {
        return new NextResponse(null, { status: 413 });
    }

    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    const parsed = parsePlaybackFailure(json);
    if (!parsed) return new NextResponse(null, { status: 400 });

    try {
        savePlaybackFailure(db, { ...parsed, userId: user.id, browser: briefBrowser(request.headers.get('user-agent')) });
    } catch (err) {
        // Le message seulement : jamais le corps reçu.
        console.error('playback-failures POST error:', err instanceof Error ? err.message : 'inconnue');
        return new NextResponse(null, { status: 500 });
    }
    return new NextResponse(null, { status: 204 });
}
