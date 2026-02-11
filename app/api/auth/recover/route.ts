import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { recoverAccount } from '@/lib/auth';
import { createSessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
    const { username, recoveryPhrase, newPassword } = await request.json();

    if (!username || !recoveryPhrase || !newPassword) {
        return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    if (newPassword.length < 8) {
        return NextResponse.json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
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
