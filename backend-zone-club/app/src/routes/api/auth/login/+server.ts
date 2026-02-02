import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loginUser } from '$lib/server/auth';
import { createSessionToken } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ error: 'Pseudo et mot de passe requis' }, { status: 400 });
    }

    const user = await loginUser(username, password);

    if (!user) {
        return json({ error: 'Pseudo ou mot de passe incorrect' }, { status: 401 });
    }

    const token = createSessionToken(user.id);
    cookies.set('session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });

    return json({ user });
};
