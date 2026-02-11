import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { loginUser } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
    const { username, password } = await request.json();

    if (!username || !password) {
        return NextResponse.json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    const user = await loginUser(username, password);

    if (!user) {
        return NextResponse.json({ error: 'Pseudo ou mot de passe incorrect' }, { status: 401 });
    }

    const token = createSessionToken(user.id);
    const cookieStore = await cookies();
    cookieStore.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return NextResponse.json({ user });
}
