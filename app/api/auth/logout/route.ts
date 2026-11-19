import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { endAllCastSessions } from '@/lib/cast-sessions';

export async function POST() {
    const cookieStore = await cookies();
    // Les séances de Cast du visiteur sont closes AVANT d'effacer le cookie : le DELETE que le téléphone envoie en
    // arrêtant la TV peut arriver après lui (401), l'onglet a pu être fermé, la déconnexion venir d'un autre appareil.
    // Sans cela, le vérificateur passerait la location à 100 % à l'heure de fin estimée d'un film arrêté. Une base en
    // panne n'empêche pas de se déconnecter.
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (user) {
        try {
            endAllCastSessions(user.id);
        } catch (err) {
            console.error('logout: clôture des séances de Cast impossible', err);
        }
    }
    // cookieStore.delete() emits a Set-Cookie without HttpOnly/SameSite, which
    // Chromium refuses to match against the original session cookie (set with
    // HttpOnly + SameSite=lax at login/register). Result: the session cookie
    // survives the logout in the browser. Setting an empty value with the same
    // attributes + maxAge=0 forces removal across all browsers.
    cookieStore.set('session', '', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        expires: new Date(0),
    });
    return NextResponse.json({ success: true });
}
