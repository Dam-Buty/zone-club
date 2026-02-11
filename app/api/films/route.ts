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
    return NextResponse.json(films);
}
