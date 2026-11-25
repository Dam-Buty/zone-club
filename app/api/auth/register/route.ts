import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { registerUser, usernameExists } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, forgiveAttempt, getRateLimitKey, tooManyAttempts } from '@/lib/rate-limit';
import { passwordRuleError, usernameRuleError } from '@/src/utils/account-rules';

export async function POST(request: NextRequest) {
    const rateLimitKey = getRateLimitKey(request, 'register');
    const retryAfter = checkRateLimit(rateLimitKey, 3, 15 * 60 * 1000);
    if (retryAfter !== null) {
        return NextResponse.json(
            { error: tooManyAttempts(retryAfter) },
            { status: 429 },
        );
    }

    // La limite de trois par quart d'heure vaut pour les comptes CRÉÉS. Un refus (pseudo déjà pris, règle non tenue)
    // ne mange pas un de ces trois essais — le visiteur se retrouvait bloqué avant d'avoir trouvé un pseudo libre — mais
    // les refus ont leur propre limite, plus large, pour qu'on ne sonde pas les pseudos à la chaîne.
    const refused = (error: string, init: { status: number }) => {
        forgiveAttempt(rateLimitKey);
        const refusalRetry = checkRateLimit(getRateLimitKey(request, 'register-refus'), 20, 15 * 60 * 1000);
        if (refusalRetry !== null) return NextResponse.json({ error: tooManyAttempts(refusalRetry) }, { status: 429 });
        return NextResponse.json({ error }, init);
    };

    const body = await request.json().catch(() => null);
    const rawUsername = body?.username;
    const password = body?.password;

    if (!rawUsername || !password || typeof rawUsername !== 'string' || typeof password !== 'string') {
        return refused('Pseudo et mot de passe requis', { status: 400 });
    }
    const username = rawUsername.trim();

    // Mêmes règles que les formulaires (src/utils/account-rules.ts) : une seule définition.
    const ruleError = usernameRuleError(username) ?? passwordRuleError(password);
    if (ruleError) {
        return refused(ruleError, { status: 400 });
    }

    if (usernameExists(username)) {
        return refused('Ce pseudo est déjà pris', { status: 409 });
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
