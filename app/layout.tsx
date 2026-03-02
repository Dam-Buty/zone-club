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
                <meta name="theme-color" content="#000000" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="Zone Club" />
                <link rel="manifest" href="/manifest.json" />
                <link rel="icon" href="/logo-icone.png" />
                <link rel="apple-touch-icon" href="/icons/icon-192.png" />
                {/* Preload critical assets for interior scene (start download before JS requests them) */}
                <link rel="preload" href="/textures/env/indoor_night.hdr" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/models/vhs_cassette_tape.glb" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/models/shelf.glb" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/basis/basis_transcoder.wasm" as="fetch" crossOrigin="anonymous" />
                {/* Preload PBR textures (wall + wood) — downloaded at HTML parse time instead of component mount */}
                <link rel="preload" href="/textures/wall/color.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wall/normal.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wall/roughness.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wall/ao.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wood/color.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wood/normal.ktx2" as="fetch" crossOrigin="anonymous" />
                <link rel="preload" href="/textures/wood/roughness.ktx2" as="fetch" crossOrigin="anonymous" />
                {/* Prefetch non-critical but useful models */}
                <link rel="prefetch" href="/models/rick.glb" />
            </head>
            <body>{children}</body>
        </html>
    );
}
