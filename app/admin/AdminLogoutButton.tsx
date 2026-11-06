'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './AdminPage.module.css';

export function AdminLogoutButton() {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);

    const handleLogout = async () => {
        setSubmitting(true);
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } finally {
            setSubmitting(false);
            router.refresh();
        }
    };

    return (
        <button className={styles.ghostButton} type="button" onClick={handleLogout} disabled={submitting}>
            {submitting ? 'Déconnexion…' : 'Changer de compte'}
        </button>
    );
}
