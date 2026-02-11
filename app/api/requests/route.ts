import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createFilmRequest, getUserRequests } from '@/lib/requests';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const requests = getUserRequests(user.id);
    return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { tmdb_id, title, poster_url } = await request.json();

    if (!tmdb_id || !title) {
        return NextResponse.json({ error: 'tmdb_id et title requis' }, { status: 400 });
    }

    try {
        const filmRequest = createFilmRequest(
            user.id,
            tmdb_id,
            title,
            poster_url || null
        );
        return NextResponse.json({ request: filmRequest });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
