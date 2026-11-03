'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '../../src/store';
import { apiFilmToFilm } from '../../src/api';
import type { Rental } from '../../src/types';
import {
    DEFAULT_FILTERS,
    coverageOf,
    filterAdminFilms,
    hasEn,
    hasFr,
    hasVf,
    hasVo,
    type AdminFilmFilters,
    type AdminFilmRow,
    type AudioFilter,
    type AvailabilityFilter,
    type SubtitleFilter,
} from './types';
import styles from './AdminPage.module.css';

// Le player est le composant réel du vidéoclub. On le charge à l'ouverture pour
// ne pas embarquer tout le SDK Cast et les effets VHS dans la première visite.
const VHSPlayer = dynamic(
    () => import('../../src/components/player/VHSPlayer').then(module => ({ default: module.VHSPlayer })),
    { ssr: false },
);

interface AdminPageClientProps {
    username: string;
}

const STATUS_LABELS: Record<string, string> = {
    done: 'prêt',
    pending: 'en attente',
    error: 'erreur',
    qc_failed: 'QC échoué',
    rejected_release: 'release rejetée',
    transcoding_remote: 'encodage',
};

function statusClass(status: string | null): string {
    if (status === 'done') return styles.statusDone;
    if (status === 'pending' || status === 'transcoding_remote') return styles.statusPending;
    return styles.statusError;
}

function labelOf(value: string): string {
    return STATUS_LABELS[value] ?? value;
}

export function AdminPageClient({ username }: AdminPageClientProps) {
    const [films, setFilms] = useState<AdminFilmRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<AdminFilmFilters>(DEFAULT_FILTERS);
    const [previewingId, setPreviewingId] = useState<number | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const openPreviewPlayer = useStore(state => state.openPreviewPlayer);
    const isPlayerOpen = useStore(state => state.isPlayerOpen);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const response = await fetch('/api/films?all=true', { credentials: 'include' });
                const data = await response.json().catch(() => null);

                if (!response.ok) {
                    throw new Error(data?.error || 'Impossible de charger le catalogue');
                }

                if (!cancelled) setFilms(Array.isArray(data) ? data : []);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur de chargement');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    // Si on quitte /admin alors qu'une preview est ouverte, ne pas laisser
    // `isPlayerOpen` + `previewRental` dans le store global : le vidéoclub
    // principal afficherait le player par-dessus sa propre scène.
    useEffect(() => () => {
        const state = useStore.getState();
        if (state.previewRental) state.closePlayer();
    }, []);

    const aisles = useMemo(
        () => Array.from(new Set(films.map(film => film.aisle ?? 'none'))).sort((a, b) => a.localeCompare(b, 'fr')),
        [films],
    );
    const languages = useMemo(
        () => Array.from(new Set(films.map(film => film.original_language ?? 'none'))).sort(),
        [films],
    );
    const statuses = useMemo(
        () => Array.from(new Set(films.map(film => film.transcode_status ?? 'none'))).sort(),
        [films],
    );

    const filteredFilms = useMemo(() => filterAdminFilms(films, filters), [films, filters]);
    const allCoverage = useMemo(() => coverageOf(films), [films]);
    const filteredCoverage = useMemo(() => coverageOf(filteredFilms), [filteredFilms]);

    const updateFilter = <K extends keyof AdminFilmFilters>(key: K, value: AdminFilmFilters[K]) => {
        setFilters(current => ({ ...current, [key]: value }));
    };

    const toggleSort = (sortBy: AdminFilmFilters['sortBy']) => {
        setFilters(current => (
            current.sortBy === sortBy
                ? { ...current, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' }
                : { ...current, sortBy, sortDir: 'asc' }
        ));
    };

    const sortMarker = (sortBy: AdminFilmFilters['sortBy']) => (
        filters.sortBy === sortBy ? (filters.sortDir === 'asc' ? ' ▲' : ' ▼') : ''
    );

    const play = async (film: AdminFilmRow) => {
        setPreviewError(null);
        setPreviewingId(film.id);

        try {
            const response = await fetch(`/api/admin/preview/${film.id}`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'Impossible de préparer la lecture');
            }

            const streamingUrls = data.streaming_urls as Rental['streamingUrls'];
            const rental: Rental = {
                filmId: film.id,
                rentedAt: Date.now(),
                // Assez loin pour que le compteur de location ne clignote pas
                // pendant un test ; aucune ligne `rentals` n'est créée.
                expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                videoUrl: streamingUrls?.vf || streamingUrls?.vo || '',
                streamingUrls,
                watchProgress: 0,
                watchPosition: 0,
                watchCompletedAt: null,
                extensionUsed: false,
                rewindClaimed: false,
                viewingMode: null,
            };

            openPreviewPlayer(apiFilmToFilm(film), rental);
        } catch (err) {
            setPreviewError(err instanceof Error ? err.message : 'Erreur de lecture');
        } finally {
            setPreviewingId(null);
        }
    };

    return (
        <main className={styles.shell}>
            <div className={styles.inner}>
                <header className={styles.header}>
                    <div>
                        <h1 className={styles.title}>Admin · test des pistes</h1>
                        <p className={styles.subtitle}>
                            Catalogue complet, filtres sous-titres / audio, puis lecture dans le player
                            du vidéoclub. Aucune location, aucun crédit, aucun historique n&apos;est créé.
                        </p>
                    </div>
                    <div className={styles.headerActions}>
                        <span className={styles.userChip}>{username} · admin</span>
                        <a className={styles.ghostButton} href="/">
                            Vidéoclub
                        </a>
                    </div>
                </header>

                <div className={styles.stats}>
                    <div className={styles.stat}>
                        <span className={styles.statLabel}>Films chargés</span>
                        <span className={styles.statValue}>{allCoverage.total}</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.statLabel}>Sous-titres FR</span>
                        <span className={`${styles.statValue} ${styles.statValueAccent}`}>
                            {allCoverage.fr} · {allCoverage.frPct} %
                        </span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.statLabel}>Sous-titres EN</span>
                        <span className={`${styles.statValue} ${styles.statValueAccent}`}>
                            {allCoverage.en} · {allCoverage.enPct} %
                        </span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.statLabel}>Résultats filtrés</span>
                        <span className={styles.statValue}>{filteredCoverage.total}</span>
                    </div>
                </div>

                <section className={styles.filters}>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Recherche</span>
                        <input
                            className={styles.input}
                            value={filters.search}
                            onChange={event => updateFilter('search', event.target.value)}
                            placeholder="Titre, titre original ou TMDB id"
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Rayon</span>
                        <select
                            className={styles.select}
                            value={filters.aisle}
                            onChange={event => updateFilter('aisle', event.target.value)}
                        >
                            <option value="all">Tous</option>
                            {aisles.map(aisle => (
                                <option key={aisle} value={aisle}>
                                    {aisle === 'none' ? 'Sans rayon' : aisle}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Langue originale</span>
                        <select
                            className={styles.select}
                            value={filters.language}
                            onChange={event => updateFilter('language', event.target.value)}
                        >
                            <option value="all">Toutes</option>
                            {languages.map(language => (
                                <option key={language} value={language}>
                                    {language === 'none' ? 'Inconnue' : language}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Audio</span>
                        <select
                            className={styles.select}
                            value={filters.audio}
                            onChange={event => updateFilter('audio', event.target.value as AudioFilter)}
                        >
                            <option value="all">Peu importe</option>
                            <option value="both">VF + VO</option>
                            <option value="vf-only">VF seule</option>
                            <option value="vo-only">VO seule</option>
                            <option value="none">Aucune</option>
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Sous-titres</span>
                        <select
                            className={styles.select}
                            value={filters.subtitles}
                            onChange={event => updateFilter('subtitles', event.target.value as SubtitleFilter)}
                        >
                            <option value="all">Peu importe</option>
                            <option value="both">FR + EN</option>
                            <option value="fr-only">FR seul</option>
                            <option value="en-only">EN seul</option>
                            <option value="none">Aucun</option>
                            <option value="no-fr">Sans FR</option>
                            <option value="no-en">Sans EN</option>
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Statut</span>
                        <select
                            className={styles.select}
                            value={filters.status}
                            onChange={event => updateFilter('status', event.target.value)}
                        >
                            <option value="all">Tous</option>
                            {statuses.map(status => (
                                <option key={status} value={status}>
                                    {status === 'none' ? 'Sans statut' : labelOf(status)}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Visibilité</span>
                        <select
                            className={styles.select}
                            value={filters.availability}
                            onChange={event => updateFilter('availability', event.target.value as AvailabilityFilter)}
                        >
                            <option value="all">Toutes</option>
                            <option value="available">Disponibles</option>
                            <option value="hidden">Masqués</option>
                        </select>
                    </label>

                    <div className={styles.field} style={{ justifyContent: 'flex-end' }}>
                        <span className={styles.fieldLabel}>&nbsp;</span>
                        <button
                            className={styles.ghostButton}
                            type="button"
                            onClick={() => setFilters(DEFAULT_FILTERS)}
                        >
                            Réinitialiser
                        </button>
                    </div>
                </section>

                <div className={styles.filterFooter}>
                    <span>
                        <strong>{filteredCoverage.total}</strong> film(s) · STFR <strong>{filteredCoverage.fr}</strong>
                        {' '}· STEN <strong>{filteredCoverage.en}</strong>
                    </span>
                    <span>Clique sur « Tester » pour ouvrir le player du vidéoclub.</span>
                </div>

                {error && <div className={styles.error}>{error}</div>}
                {previewError && <div className={styles.error}>{previewError}</div>}

                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th aria-label="Affiche" />
                                <th>
                                    <button className={styles.sortButton} type="button" onClick={() => toggleSort('title')}>
                                        Film{sortMarker('title')}
                                    </button>
                                </th>
                                <th className={styles.hideMobile}>
                                    <button className={styles.sortButton} type="button" onClick={() => toggleSort('year')}>
                                        Année{sortMarker('year')}
                                    </button>
                                </th>
                                <th className={styles.hideMobile}>
                                    <button className={styles.sortButton} type="button" onClick={() => toggleSort('aisle')}>
                                        Rayon{sortMarker('aisle')}
                                    </button>
                                </th>
                                <th>
                                    <button className={styles.sortButton} type="button" onClick={() => toggleSort('language')}>
                                        Langue{sortMarker('language')}
                                    </button>
                                </th>
                                <th>Audio</th>
                                <th>Sous-titres</th>
                                <th>
                                    <button className={styles.sortButton} type="button" onClick={() => toggleSort('status')}>
                                        Statut{sortMarker('status')}
                                    </button>
                                </th>
                                <th aria-label="Lecture" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td className={styles.empty} colSpan={9}>Chargement du catalogue…</td>
                                </tr>
                            ) : filteredFilms.length === 0 ? (
                                <tr>
                                    <td className={styles.empty} colSpan={9}>Aucun film ne correspond aux filtres.</td>
                                </tr>
                            ) : filteredFilms.map(film => (
                                <tr key={film.id}>
                                    <td className={styles.posterCell}>
                                        {film.poster_url
                                            ? <img className={styles.poster} src={film.poster_url} alt="" loading="lazy" />
                                            : <div className={styles.posterFallback}>—</div>}
                                    </td>
                                    <td>
                                        <span className={styles.filmTitle}>{film.title}</span>
                                        <span className={styles.filmMeta}>
                                            TMDB {film.tmdb_id}
                                            {film.title_original && film.title_original !== film.title
                                                ? ` · ${film.title_original}`
                                                : ''}
                                        </span>
                                    </td>
                                    <td className={styles.hideMobile}>{film.release_year ?? '—'}</td>
                                    <td className={styles.hideMobile}>{film.aisle ?? '—'}</td>
                                    <td><span className={styles.mono}>{film.original_language || '—'}</span></td>
                                    <td>
                                        <div className={styles.badges}>
                                            <span className={`${styles.badge} ${hasVf(film) ? styles.badgeOn : styles.badgeOff}`}>VF</span>
                                            <span className={`${styles.badge} ${hasVo(film) ? styles.badgeOn : styles.badgeOff}`}>VO</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className={styles.badges}>
                                            <span className={`${styles.badge} ${hasFr(film) ? styles.badgeOn : styles.badgeOff}`}>FR</span>
                                            <span className={`${styles.badge} ${hasEn(film) ? styles.badgeOn : styles.badgeOff}`}>EN</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={statusClass(film.transcode_status)}>
                                            {film.transcode_status ? labelOf(film.transcode_status) : '—'}
                                        </span>
                                    </td>
                                    <td className={styles.playCell}>
                                        <button
                                            className={styles.playButton}
                                            type="button"
                                            onClick={() => play(film)}
                                            disabled={previewingId === film.id}
                                        >
                                            {previewingId === film.id ? 'Préparation…' : '▶ Tester'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {isPlayerOpen && <VHSPlayer />}
        </main>
    );
}
