import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recoverAccount } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, recoveryPhrase, newPassword } = await request.json();

    if (!username || !recoveryPhrase || !newPassword) {
        return json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    if (newPassword.length < 8) {
        return json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
    }

    const result = await recoverAccount(username, recoveryPhrase, newPassword);

    if (!result) {
        return json({ error: 'Pseudo ou passphrase incorrect' }, { status: 401 });
    }

    const token = createSessionToken(result.user.id);
    cookies.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return json({ user: result.user, newRecoveryPhrase: result.newRecoveryPhrase });
};
