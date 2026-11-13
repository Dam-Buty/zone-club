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
                {/* VT323 — CRT-style monospace used by the minitel canvas. Preconnect
                    so the woff2 is in-flight before the minitel screen is opened. */}
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet" />
                {/* La devanture est la première chose à l'écran : ses images partent avant les
                    préchargements de l'intérieur. Les media reprennent useIsMobile (pointeur
                    grossier OU largeur <= 768px = mobile). crossOrigin sur les deux images desktop :
                    THREE.TextureLoader les demande en anonymous, sans ça le préchargement ne sert pas. */}
                <link rel="preload" as="image" href="/storefront.jpeg" crossOrigin="anonymous" fetchPriority="high" media="(pointer: fine) and (min-width: 769px), (pointer: none) and (min-width: 769px)" />
                <link rel="preload" as="image" href="/storefront-mask.png" crossOrigin="anonymous" fetchPriority="high" media="(pointer: fine) and (min-width: 769px), (pointer: none) and (min-width: 769px)" />
                <link rel="preload" as="image" href="/storefront-mobile.webp" type="image/webp" fetchPriority="high" media="(pointer: coarse), (max-width: 768px)" />
                {/* Pas de préchargement de l'intérieur ici : HDR, KTX2 et GLB (plus de 20 Mo) partaient
                    au parse du HTML, devant le code de la devanture. Ils partent maintenant quand elle
                    est affichée — src/utils/interior-preload-gate.ts, asset-preload.ts et les
                    useGLTF.preload des modules de l'intérieur. */}
            </head>
            <body>{children}</body>
        </html>
    );
}
