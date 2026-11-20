'use client';

import { useEffect, useState } from 'react';
import { failureDateLabel, failurePlaceLabel, failureVersionLabel, type PlaybackFailureGroup } from './types';
import styles from './AdminPage.module.css';

// Les jours que la section demande. Le texte du vide (« Aucun échec sur 30 jours. ») reprend ceux de la réponse : la route
// borne la demande, c'est elle qui dit sur combien de jours elle a lu.
const REQUESTED_DAYS = 30;

interface FailuresData {
    days: number;
    groups: PlaybackFailureGroup[];
}

// Les lectures en échec des visiteurs (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md) :
// une ligne par film, version et lieu. C'est la liste de ce qu'il faut regarder en premier — un film dont la VF ne
// démarre sur personne se voit ici, pas dans les journaux. Le visiteur n'y paraît jamais : la route ne l'envoie pas.
export function PlaybackFailures() {
    const [data, setData] = useState<FailuresData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const response = await fetch(
                    `/api/admin/playback-failures?days=${REQUESTED_DAYS}`,
                    { credentials: 'include' },
                );
                const body = await response.json().catch(() => null);

                if (!response.ok) {
                    throw new Error(body?.error || 'Impossible de charger les lectures en échec');
                }
                if (!body || !Array.isArray(body.groups)) {
                    throw new Error('Réponse illisible pour les lectures en échec');
                }

                if (!cancelled) setData({ days: Number(body.days) || REQUESTED_DAYS, groups: body.groups });
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur de chargement');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    return (
        <section className={styles.failures} aria-labelledby="playback-failures-title">
            <h2 id="playback-failures-title" className={styles.sectionTitle}>Lectures en échec</h2>
            <p className={styles.sectionHint}>
                Un film qui ne démarre pas pour un visiteur, une ligne par film, version et lieu.
                Le plus récent d&apos;abord.
            </p>

            {error ? (
                <div className={styles.error}>{error}</div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Film</th>
                                <th>Version</th>
                                <th>Lieu</th>
                                <th className={styles.numberCell}>Échecs</th>
                                <th>Dernier échec</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading || !data ? (
                                <tr>
                                    <td className={styles.empty} colSpan={5}>Chargement des lectures en échec…</td>
                                </tr>
                            ) : data.groups.length === 0 ? (
                                <tr>
                                    <td className={styles.empty} colSpan={5}>Aucun échec sur {data.days} jours.</td>
                                </tr>
                            ) : data.groups.map(group => (
                                <tr key={`${group.film_id}-${group.audio}-${group.place}`}>
                                    <td>
                                        <span className={styles.filmTitle}>{group.title ?? `Film n° ${group.film_id}`}</span>
                                    </td>
                                    <td>
                                        <span className={`${styles.badge} ${styles.badgeOn}`}>{failureVersionLabel(group.audio)}</span>
                                    </td>
                                    <td>{failurePlaceLabel(group.place)}</td>
                                    <td className={styles.numberCell}>
                                        <span className={styles.statusError}>{group.failures}</span>
                                    </td>
                                    <td className={styles.dateCell}>{failureDateLabel(group.last_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
