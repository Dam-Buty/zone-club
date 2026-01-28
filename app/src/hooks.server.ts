import type { Handle } from '@sveltejs/kit';
import { getUserFromSession } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
    const sessionToken = event.cookies.get('session');
    event.locals.user = getUserFromSession(sessionToken);

    return resolve(event);
};
