import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteNote } from '@/lib/board';
import { getUserFromSession } from '@/lib/session';

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ noteId: string }> }
) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { noteId: noteIdStr } = await params;
    const noteId = parseInt(noteIdStr);

    if (isNaN(noteId)) {
        return NextResponse.json({ error: 'ID note invalide' }, { status: 400 });
    }

    try {
        deleteNote(noteId, user.id, !!user.is_admin);
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
