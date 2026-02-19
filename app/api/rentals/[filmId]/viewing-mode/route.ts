import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setViewingMode } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);
    const { mode } = await request.json();

    if (mode !== 'sur_place' && mode !== 'emporter') {
        return NextResponse.json({ error: 'Mode invalide' }, { status: 400 });
    }

    try {
        const rental = setViewingMode(user.id, filmId, mode);
        return NextResponse.json({ rental });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
