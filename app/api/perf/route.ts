import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { parsePerfRun, PERF_MAX_BODY_BYTES } from '@/lib/perf-run-parse';
import { savePerfRun } from '@/lib/perf-runs';

// POST — une mesure d'entrée dans la boutique, envoyée par navigator.sendBeacon.
// Publique et anonyme : ni session, ni adresse IP stockée (l'IP ne sert qu'au limiteur
// de débit en mémoire). Le navigateur n'attend rien de la réponse.
// Une même entrée envoie jusqu'à cinq états successifs (voir perf-beacon.ts), d'où un
// plafond large : 120 envois par quart d'heure et par adresse.
export async function POST(request: NextRequest) {
    if (checkRateLimit(getRateLimitKey(request, 'perf'), 120, 15 * 60 * 1000) !== null) {
        return new NextResponse(null, { status: 429 });
    }

    const body = await request.text();
    if (body.length === 0 || body.length > PERF_MAX_BODY_BYTES) {
        return new NextResponse(null, { status: 413 });
    }

    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    const run = parsePerfRun(json);
    if (!run) return new NextResponse(null, { status: 400 });

    try {
        savePerfRun(run);
    } catch (err) {
        console.error('perf POST error:', err);
        return new NextResponse(null, { status: 500 });
    }
    return new NextResponse(null, { status: 204 });
}
