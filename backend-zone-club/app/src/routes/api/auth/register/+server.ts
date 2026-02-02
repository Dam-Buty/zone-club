import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registerUser, usernameExists } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30) {
        return json({ error: 'Le pseudo doit faire entre 3 et 30 caractères' }, { status: 400 });
    }

    if (password.length < 8) {
        return json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
    }

    if (usernameExists(username)) {
        return json({ error: 'Ce pseudo est déjà pris' }, { status: 409 });
    }

    try {
        const { user, recoveryPhrase } = await registerUser(username, password);

        const token = createSessionToken(user.id);
        cookies.set('session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        return json({ user, recoveryPhrase });
    } catch (error) {
        console.error('Registration error:', error);
        return json({ error: 'Erreur lors de l\'inscription' }, { status: 500 });
    }
};
