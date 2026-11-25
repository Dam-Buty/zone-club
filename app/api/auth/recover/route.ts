import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { recoverAccount } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, getRateLimitKey, tooManyAttempts } from '@/lib/rate-limit';
import { passwordRuleError } from '@/src/utils/account-rules';

export async function POST(request: NextRequest) {
    const rateLimitKey = getRateLimitKey(request, 'recover');
    const retryAfter = checkRateLimit(rateLimitKey, 3, 60 * 60 * 1000); // 3 attempts per hour
    if (retryAfter !== null) {
        return NextResponse.json(
            { error: tooManyAttempts(retryAfter) },
            { status: 429 },
        );
    }

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim() : body?.username;
    const recoveryPhrase = body?.recoveryPhrase;
    const newPassword = body?.newPassword;

    if (!username || !recoveryPhrase || !newPassword || typeof username !== 'string' || typeof recoveryPhrase !== 'string' || typeof newPassword !== 'string') {
        return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    // Même règle qu'à l'inscription (src/utils/account-rules.ts) : la récupération n'exigeait que
    // 8 caractères et laissait poser un mot de passe que l'inscription aurait refusé.
    const ruleError = passwordRuleError(String(newPassword));
    if (ruleError) {
        return NextResponse.json({ error: ruleError }, { status: 400 });
    }

    const result = await recoverAccount(username, recoveryPhrase, newPassword);

    if (!result) {
        return NextResponse.json({ error: 'Pseudo ou phrase de récupération incorrects' }, { status: 401 });
    }

    const token = createSessionToken(result.user.id);
    const cookieStore = await cookies();
    cookieStore.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return NextResponse.json({ user: result.user, newRecoveryPhrase: result.newRecoveryPhrase });
}
