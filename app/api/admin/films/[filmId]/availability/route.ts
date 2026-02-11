import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setFilmAvailability } from '@/lib/films';
import { getUserFromSession } from '@/lib/session';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);
    const { available } = await request.json();

    setFilmAvailability(filmId, available);
    return NextResponse.json({ success: true });
}
