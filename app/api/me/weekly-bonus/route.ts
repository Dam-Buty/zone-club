import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { claimWeeklyBonus, canClaimWeeklyBonus } from '@/lib/bonus';
import { getUserFromSession } from '@/lib/session';

export async function GET() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const status = canClaimWeeklyBonus(user.id);
    return NextResponse.json(status);
}

export async function POST() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    try {
        const result = claimWeeklyBonus(user.id);
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
}
