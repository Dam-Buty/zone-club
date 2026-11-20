import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { db } from '@/lib/db';
import { clampDays, recentPlaybackFailures, summarizePlaybackFailures, withoutVisitor } from '@/lib/playback-failures';

// GET — les lectures en échec : le résumé par film, version (piste audio) et lieu (appareil ou télé) sur les `days`
// derniers jours (30 par défaut, 1 à 365), puis les dernières traces brutes. Réservé à l'administrateur : 403 sinon.
// Les traces ne portent jamais le visiteur (`withoutVisitor`) ni, bien sûr, d'adresse de fichier : la table n'en a pas.
export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    // `|| 30` : un « days » absent, vide ou illisible vaut 30 ; la borne est celle du module qui lit la table.
    const days = clampDays(Number(request.nextUrl.searchParams.get('days') ?? 30) || 30);
    const groups = summarizePlaybackFailures(db, days);
    const recent = withoutVisitor(recentPlaybackFailures(db, 50));

    return NextResponse.json({ days, groups, recent });
}
