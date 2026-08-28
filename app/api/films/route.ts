import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAllFilms, getAvailableFilmsList } from '@/lib/films';
import { getUserFromSession } from '@/lib/session';

export async function GET(request: NextRequest) {
    const includeAll = request.nextUrl.searchParams.get('all') === 'true';

    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    const availableOnly = includeAll && user?.is_admin ? false : true;

    // L'admin a besoin des colonnes internes (radarr_id, created_at pour le tri) ;
    // le public reçoit la projection de liste.
    const films = availableOnly ? getAvailableFilmsList() : getAllFilms(false);
    const response = NextResponse.json(films);
    // Public cache only for non-admin filtered list; admin sees all → no cache
    if (availableOnly) {
        response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=3600');
    } else {
        response.headers.set('Cache-Control', 'private, no-cache');
    }
    return response;
}
