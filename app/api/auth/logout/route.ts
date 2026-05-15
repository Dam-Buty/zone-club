import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    const cookieStore = await cookies();
    // cookieStore.delete() emits a Set-Cookie without HttpOnly/SameSite, which
    // Chromium refuses to match against the original session cookie (set with
    // HttpOnly + SameSite=lax at login/register). Result: the session cookie
    // survives the logout in the browser. Setting an empty value with the same
    // attributes + maxAge=0 forces removal across all browsers.
    cookieStore.set('session', '', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        expires: new Date(0),
    });
    return NextResponse.json({ success: true });
}
