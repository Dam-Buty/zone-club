import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { recoverAccount } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { passwordRuleError } from '@/src/utils/account-rules';

export async function POST(request: NextRequest) {
    const rateLimitKey = getRateLimitKey(request, 'recover');
    const retryAfter = checkRateLimit(rateLimitKey, 3, 60 * 60 * 1000); // 3 attempts per hour
    if (retryAfter !== null) {
        return NextResponse.json(
            { error: `Trop de tentatives. Reessayez dans ${Math.ceil(retryAfter / 60)} minutes.` },
            { status: 429 },
        );
    }

    const { username, recoveryPhrase, newPassword } = await request.json();

    if (!username || !recoveryPhrase || !newPassword) {
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
        return NextResponse.json({ error: 'Pseudo ou passphrase incorrect' }, { status: 401 });
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
