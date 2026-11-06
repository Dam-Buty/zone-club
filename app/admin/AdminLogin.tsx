'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './AdminPage.module.css';

/**
 * Formulaire de connexion de la page admin.
 *
 * On poste directement sur `/api/auth/login` plutôt que de passer par le store
 * Zustand : le store vit dans l'application 3D, alors que cette page est un
 * point d'entrée autonome. Le cookie de session est le même, et le rafraîchissement
 * du Server Component relit `is_admin` côté serveur.
 */
export function AdminLogin() {
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'Connexion impossible');
            }

            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Connexion impossible');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className={styles.gate}>
            <div className={styles.card}>
                <h1 className={styles.cardTitle}>Zone Club · Admin</h1>
                <p className={styles.cardText}>
                    Accès réservé aux comptes administrateurs. Connecte-toi pour
                    lister les films et tester les pistes audio / sous-titres.
                </p>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Pseudo</span>
                        <input
                            className={styles.input}
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            autoComplete="username"
                            autoFocus
                            required
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Mot de passe</span>
                        <input
                            className={styles.input}
                            type="password"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </label>

                    {error && <div className={styles.formError}>{error}</div>}

                    <button className={styles.formButton} type="submit" disabled={submitting}>
                        {submitting ? 'Connexion…' : 'Entrer'}
                    </button>
                </form>

                <Link className={styles.backLink} href="/">
                    ← Retour au vidéoclub
                </Link>
            </div>
        </main>
    );
}
