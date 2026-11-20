import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserActiveRentals, getUserRentalHistory } from '@/lib/rentals';
import { getReviewEligibilityForUser, getUserReviews } from '@/lib/reviews';
import { getUserFromSession } from '@/lib/session';
import { canClaimWeeklyBonus } from '@/lib/bonus';
import { completeDueCastSessionsFor } from '@/lib/cast-sessions';
import { db } from '@/lib/db';
import { readVersionPref } from '@/lib/version-pref';
import type { VersionChoice } from '@/src/utils/version-choice';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Un film fini sur la TV pendant que le téléphone dormait : sa séance de Cast est échue, mais le vérificateur ne
    // passe que toutes les 60 s. Complétée ici, AVANT de lire les locations, le téléphone qui revient lit 100 % et
    // propose « BE KIND REWIND » au lieu de conclure à un arrêt. Une base en panne ne prive pas du profil.
    try {
        completeDueCastSessionsFor(user.id);
    } catch (err) {
        console.error('me: complétion des séances de Cast échues impossible', err);
    }

    const activeRentals = getUserActiveRentals(user.id);
    const rentalHistory = getUserRentalHistory(user.id);
    const reviews = getUserReviews(user.id);
    const weeklyBonus = canClaimWeeklyBonus(user.id);
    // « Mon compte » de la borne : ce que chaque film loué et pas encore critiqué permet.
    const reviewEligibility = getReviewEligibilityForUser(user.id);
    // La version préférée du compte ; illisible en base, elle vaut « Automatique » (null). Gardée : une erreur ici
    // rendrait 500, et `fetchMe` conclurait à une déconnexion.
    let versionPref: VersionChoice | null = null;
    try {
        versionPref = readVersionPref(db, user.id);
    } catch (err) {
        console.error('me: lecture de la version préférée impossible', err);
    }

    const response = NextResponse.json({
        user: {
            id: user.id,
            username: user.username,
            credits: user.credits,
            is_admin: user.is_admin,
            created_at: user.created_at,
            version_pref: versionPref
        },
        activeRentals,
        rentalHistory,
        reviews,
        weeklyBonus,
        reviewEligibility
    });
    // Auth-sensitive payload: never cache. The old `private, max-age=60` was
    // leaking session data after logout — the browser kept serving the cached
    // response for 60s, so the app stayed "logged in" client-side.
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
