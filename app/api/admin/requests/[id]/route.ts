import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { updateRequestStatus } from '@/lib/requests';
import { addFilmFromTmdb } from '@/lib/films';
import { db } from '@/lib/db';
import { getUserFromSession } from '@/lib/session';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user?.is_admin) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const { id: idStr } = await params;
    const requestId = parseInt(idStr);
    const { status, admin_note } = await request.json();

    if (!['approved', 'rejected', 'added'].includes(status)) {
        return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });
    }

    if (status === 'added') {
        const filmRequest = db.prepare('SELECT * FROM film_requests WHERE id = ?').get(requestId) as any;
        if (!filmRequest) {
            return NextResponse.json({ error: 'Demande non trouvée' }, { status: 404 });
        }

        try {
            await addFilmFromTmdb(filmRequest.tmdb_id);
        } catch (err) {
            return NextResponse.json({ error: (err as Error).message }, { status: 400 });
        }
    }

    updateRequestStatus(requestId, status, admin_note);
    return NextResponse.json({ success: true });
}
