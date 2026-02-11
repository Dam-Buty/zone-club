import { NextResponse } from 'next/server';
import { getGenresWithFilmCount } from '@/lib/films';

export async function GET() {
    const genres = getGenresWithFilmCount();
    return NextResponse.json(genres);
}
