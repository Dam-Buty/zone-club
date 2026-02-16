import { NextRequest, NextResponse } from 'next/server';
import { getFilmsByGenre, getAllGenres } from '@/lib/films';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;

    const genres = getAllGenres();
    const genre = genres.find(g => g.slug === slug);

    if (!genre) {
        return NextResponse.json({ error: 'Genre non trouvé' }, { status: 404 });
    }

    const films = getFilmsByGenre(slug);

    const response = NextResponse.json({ genre, films });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return response;
}
