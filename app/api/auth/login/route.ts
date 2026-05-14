import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { loginUser } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
    // IP-keyed bucket — defends against a single host hammering the endpoint.
    const ipKey = getRateLimitKey(request, 'login');
    const ipRetryAfter = checkRateLimit(ipKey, 5, 15 * 60 * 1000);
    if (ipRetryAfter !== null) {
        return NextResponse.json(
            { error: `Trop de tentatives. Reessayez dans ${Math.ceil(ipRetryAfter / 60)} minutes.` },
            { status: 429 },
        );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
        return NextResponse.json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    // Per-username bucket — defends against credential stuffing with rotated
    // IPs targeting a single account. Slightly more permissive window than
    // IP bucket since a legitimate user retyping their password should not
    // be locked out as easily.
    const usernameKey = `login:user:${username.toLowerCase()}`;
    const userRetryAfter = checkRateLimit(usernameKey, 10, 60 * 60 * 1000);
    if (userRetryAfter !== null) {
        return NextResponse.json(
            { error: `Trop de tentatives sur ce compte. Reessayez dans ${Math.ceil(userRetryAfter / 60)} minutes.` },
            { status: 429 },
        );
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
