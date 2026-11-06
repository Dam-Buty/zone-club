'use client';

import dynamic from 'next/dynamic';

/**
 * Le store vidéoclub et le player touchent `document` au chargement du module
 * (textures, Cast…). Le Server Component ne peut donc pas les prérendre : on
 * charge la page admin uniquement côté navigateur, comme `src/App`.
 */
const AdminPageClient = dynamic(
    () => import('./AdminPageClient').then(module => ({ default: module.AdminPageClient })),
    {
        ssr: false,
        loading: () => (
            <main style={{ position: 'fixed', inset: 0, background: '#050508', color: '#8ffffb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
                Chargement…
            </main>
        ),
    },
);

export function AdminClientLoader({ username }: { username: string }) {
    return <AdminPageClient username={username} />;
}
