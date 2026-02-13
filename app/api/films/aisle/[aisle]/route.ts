import { NextRequest, NextResponse } from 'next/server';
import { getFilmsByAisle, getNouveautes } from '@/lib/films';

const VALID_AISLES = ['action', 'horreur', 'sf', 'comedie', 'classiques', 'bizarre'];

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ aisle: string }> }
) {
    const { aisle } = await params;

    if (aisle === 'nouveautes') {
        const films = getNouveautes();
        return NextResponse.json({ aisle, films });
    }

    if (!VALID_AISLES.includes(aisle)) {
        return NextResponse.json({ error: 'Allée invalide' }, { status: 400 });
    }

    const films = getFilmsByAisle(aisle);
    return NextResponse.json({ aisle, films });
}
