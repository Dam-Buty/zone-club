import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { registerUser, usernameExists } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
    const rateLimitKey = getRateLimitKey(request, 'register');
    const retryAfter = checkRateLimit(rateLimitKey, 3, 15 * 60 * 1000);
    if (retryAfter !== null) {
        return NextResponse.json(
            { error: `Trop de tentatives. Reessayez dans ${Math.ceil(retryAfter / 60)} minutes.` },
            { status: 429 },
        );
    }

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

    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return NextResponse.json({ error: 'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre' }, { status: 400 });
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
