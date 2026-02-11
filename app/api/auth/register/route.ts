import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { registerUser, usernameExists } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
    const { username, password } = await request.json();

    if (!username || !password) {
        return NextResponse.json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30) {
        return NextResponse.json({ error: 'Le pseudo doit faire entre 3 et 30 caractères' }, { status: 400 });
    }

    if (password.length < 8) {
        return NextResponse.json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
    }

    if (usernameExists(username)) {
        return NextResponse.json({ error: 'Ce pseudo est déjà pris' }, { status: 409 });
    }

    try {
        const { user, recoveryPhrase } = await registerUser(username, password);

        const token = createSessionToken(user.id);
        const cookieStore = await cookies();
        cookieStore.set('session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7
        });

        return NextResponse.json({ user, recoveryPhrase });
    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json({ error: 'Erreur lors de l\'inscription' }, { status: 500 });
    }
}
