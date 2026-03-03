import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAllNotes, createNote, getBoardCapacity } from '@/lib/board';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const notes = getAllNotes();
    const capacity = getBoardCapacity();
    return NextResponse.json({ notes, capacity });
}

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { content, color, grid_row, grid_col } = await request.json();

    try {
        const note = createNote(user.id, content, color || 'yellow', grid_row, grid_col);
        return NextResponse.json({ note });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
