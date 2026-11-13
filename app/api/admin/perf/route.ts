import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { recentPerfRuns, summarizePerfRuns } from '@/lib/perf-runs';

// GET — mesures de terrain agrégées par appareil et par build.
// ?days=30 (fenêtre) · ?automated=1 (inclure les passes pilotées) · ?recent=50 (dernières lignes brutes)
export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const days = Number(params.get('days') ?? 30) || 30;
    const recent = Number(params.get('recent') ?? 0) || 0;
    const summary = summarizePerfRuns(days, params.get('automated') === '1');

    return NextResponse.json({ days, ...summary, recent: recent > 0 ? recentPerfRuns(recent) : undefined });
}
