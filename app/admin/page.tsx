import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/session';
import { AdminLogin } from './AdminLogin';
import { AdminLogoutButton } from './AdminLogoutButton';
import { AdminClientLoader } from './AdminClientLoader';
import styles from './AdminPage.module.css';

export const metadata: Metadata = {
    title: 'Zone Club · Admin',
    robots: { index: false, follow: false },
};

// `getUserFromSession` lit la DB : aucune raison de prérendre cette page au build.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    const cookieStore = await cookies();
    const user = getUserFromSession(cookieStore.get('session')?.value);

    if (!user) return <AdminLogin />;

    if (!user.is_admin) {
        return (
            <main className={styles.gate}>
                <div className={styles.card}>
                    <h1 className={styles.cardTitle}>Accès refusé</h1>
                    <p className={styles.cardText}>
                        Le compte <strong>{user.username}</strong> n&apos;est pas administrateur.
                        Cette page est réservée aux comptes flaggés <code>is_admin</code>.
                    </p>
                    <div className={styles.form}>
                        <AdminLogoutButton />
                        <Link className={styles.backLink} href="/">
                            ← Retour au vidéoclub
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    return <AdminClientLoader username={user.username} />;
}
