import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { extendRental } from '@/lib/rentals';
import { getUserFromSession } from '@/lib/session';

export async function PATCH(
    _request: NextRequest,
    { params }: { params: Promise<{ filmId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { filmId: filmIdStr } = await params;
    const filmId = parseInt(filmIdStr);

    try {
        const rental = extendRental(user.id, filmId);
        return NextResponse.json({ rental });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
