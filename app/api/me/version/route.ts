import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { db } from '@/lib/db';
import { parseVersionPrefBody, writeVersionPref } from '@/lib/version-pref';

// PATCH — le réglage « Version préférée » de « Mon compte » (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.2) :
// le SEUL chemin qui écrit la préférence du compte. Corps : `{ audio, subtitle }`, ou deux null pour « Automatique ».
// Session requise ; un corps illisible ou une valeur inconnue est refusé sans rien écrire. La réponse dit ce qui est
// enregistré : le magasin ne change qu'après elle.
export async function PATCH(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    let json: unknown;
    try {
        json = await request.json();
    } catch {
        json = undefined;
    }
    const parsed = parseVersionPrefBody(json);
    if (!parsed.ok) return NextResponse.json({ error: 'Version inconnue' }, { status: 400 });

    try {
        writeVersionPref(db, user.id, parsed.pref);
    } catch (err) {
        console.error('me/version PATCH error:', err instanceof Error ? err.message : 'inconnue');
        return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
    }
    return NextResponse.json({ version_pref: parsed.pref });
}
