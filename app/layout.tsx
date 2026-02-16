import type { Metadata } from 'next';
import '../src/index.css';

export const metadata: Metadata = {
    title: 'Zone Club',
    description: 'Vidéoclub en ligne — expérience 3D immersive',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="fr">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
                {/* Preload critical assets for interior scene (start download before JS requests them) */}
                <link rel="preload" href="/textures/env/indoor_night.hdr" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/models/vhs_cassette_tape.glb" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/basis/basis_transcoder.wasm" as="fetch" crossOrigin="anonymous" />
                {/* Prefetch non-critical but useful models */}
                <link rel="prefetch" href="/models/rick.glb" />
            </head>
            <body>{children}</body>
        </html>
    );
}
