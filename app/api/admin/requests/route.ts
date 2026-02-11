import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilmRequests } from '@/lib/requests';
import { getUserFromSession } from '@/lib/session';

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const status = request.nextUrl.searchParams.get('status') || undefined;
    const requests = getFilmRequests(status);
    return NextResponse.json(requests);
}
