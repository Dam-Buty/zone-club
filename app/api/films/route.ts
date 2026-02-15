import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAllFilms } from '@/lib/films';
import { getUserFromSession } from '@/lib/session';

export async function GET(request: NextRequest) {
    const includeAll = request.nextUrl.searchParams.get('all') === 'true';

    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    const availableOnly = includeAll && user?.is_admin ? false : true;

    const films = getAllFilms(availableOnly);
    const response = NextResponse.json(films);
    // Public cache only for non-admin filtered list; admin sees all → no cache
    if (availableOnly) {
        response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    } else {
        response.headers.set('Cache-Control', 'private, no-cache');
    }
    return response;
}
