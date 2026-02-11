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
            </head>
            <body>{children}</body>
        </html>
    );
}
