import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { registerUser, usernameExists } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { passwordRuleError, usernameRuleError } from '@/src/utils/account-rules';

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

    // Mêmes règles que les formulaires (src/utils/account-rules.ts) : une seule définition.
    const ruleError = usernameRuleError(String(username)) ?? passwordRuleError(String(password));
    if (ruleError) {
        return NextResponse.json({ error: ruleError }, { status: 400 });
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
