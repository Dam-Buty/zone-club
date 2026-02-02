<script lang="ts">
    import { invalidateAll } from '$app/navigation';

    let { data } = $props();
    let tmdbId = $state('');
    let adding = $state(false);
    let error = $state('');
    let success = $state('');

    async function addFilm() {
        if (!tmdbId) return;
        adding = true;
        error = '';
        success = '';
        try {
            const res = await fetch('/api/admin/films', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tmdb_id: parseInt(tmdbId) })
            });
            const result = await res.json();
            if (!res.ok) {
                error = result.error;
                return;
            }
            success = `Film "${result.film.title}" ajouté avec succès !`;
            tmdbId = '';
            invalidateAll();
        } catch {
            error = 'Erreur lors de l\'ajout';
        } finally {
            adding = false;
        }
    }

    async function toggleAvailability(filmId: number, currentlyAvailable: boolean) {
        await fetch(`/api/admin/films/${filmId}/availability`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ available: !currentlyAvailable })
        });
        invalidateAll();
    }
</script>

<svelte:head>
    <title>Administration - Zone Club</title>
</svelte:head>

<div class="container">
    <h1>Administration des films</h1>

    <section class="add-section">
        <h2>Ajouter un film</h2>
        <div class="add-form">
            <input type="number" class="input" placeholder="ID TMDB" bind:value={tmdbId} />
            <button class="btn btn-primary" onclick={addFilm} disabled={adding || !tmdbId}>
                {adding ? 'Ajout...' : 'Ajouter'}
            </button>
        </div>
        {#if error}<p class="error-message">{error}</p>{/if}
        {#if success}<p class="success-message">{success}</p>{/if}
        <p class="hint">Trouvez l'ID TMDB sur <a href="https://www.themoviedb.org" target="_blank">themoviedb.org</a></p>
    </section>

    <section>
        <h2>Catalogue ({data.films.length} films)</h2>
        <table class="films-table">
            <thead>
                <tr>
                    <th>Titre</th>
                    <th>Année</th>
                    <th>TMDB ID</th>
                    <th>Fichiers</th>
                    <th>Statut</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {#each data.films as film}
                    <tr>
                        <td>{film.title}</td>
                        <td>{film.release_year || '-'}</td>
                        <td>{film.tmdb_id}</td>
                        <td>
                            {#if film.file_path_vf || film.file_path_vo}
                                <span class="badge success">Prêt</span>
                            {:else}
                                <span class="badge warning">En attente</span>
                            {/if}
                        </td>
                        <td>
                            {#if film.is_available}
                                <span class="badge success">Disponible</span>
                            {:else}
                                <span class="badge muted">Masqué</span>
                            {/if}
                        </td>
                        <td>
                            <button class="btn btn-secondary btn-small" onclick={() => toggleAvailability(film.id, film.is_available)}>
                                {film.is_available ? 'Masquer' : 'Activer'}
                            </button>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </section>
</div>

<style>
    h1 { margin-bottom: 2rem; }
    section { margin-bottom: 3rem; }
    h2 { margin-bottom: 1rem; }
    .add-section { background: var(--bg-card); padding: 1.5rem; border-radius: var(--border-radius); }
    .add-form { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .add-form .input { max-width: 200px; }
    .hint { color: var(--text-muted); font-size: 0.85rem; }
    .hint a { color: var(--accent); }
    .films-table { width: 100%; border-collapse: collapse; background: var(--bg-card); border-radius: var(--border-radius); overflow: hidden; }
    .films-table th, .films-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--bg-secondary); }
    .films-table th { background: var(--bg-secondary); font-weight: 600; }
    .films-table tr:last-child td { border-bottom: none; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .badge.success { background: var(--success); color: white; }
    .badge.warning { background: var(--warning); color: black; }
    .badge.muted { background: var(--text-muted); color: white; }
    .btn-small { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
</style>
