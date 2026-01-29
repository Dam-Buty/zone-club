# Admin TMDB Search + Film Deletion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manual TMDB ID input with a title search autocomplete, and add film deletion from the database.

**Architecture:** Add `searchMovies()` to the existing TMDB client, expose it via a new GET endpoint, wire it into the admin Svelte page with debounced input. Add `deleteFilm()` to films.ts and a DELETE endpoint. The schema already has ON DELETE CASCADE on foreign keys so no schema changes needed.

**Tech Stack:** SvelteKit, TypeScript, TMDB API, better-sqlite3

---

### Task 1: Add `searchMovies` to TMDB client

**Files:**
- Modify: `app/src/lib/server/tmdb.ts:58` (insert before `getMovie`)

**Step 1: Add the search function**

Add after line 38 (after `TmdbImages` interface), before `getMovie`:

```typescript
export interface TmdbSearchResult {
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    poster_path: string | null;
    overview: string;
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
    const data = await tmdbFetch<{ results: TmdbSearchResult[] }>('/search/movie', { query });
    return data.results;
}
```

**Step 2: Verify no type errors**

Run: `cd app && npx svelte-check --threshold error 2>&1 | tail -5`
Expected: no errors related to tmdb.ts

**Step 3: Commit**

```bash
git add app/src/lib/server/tmdb.ts
git commit -m "feat: add searchMovies to TMDB client"
```

---

### Task 2: Add TMDB search API endpoint

**Files:**
- Create: `app/src/routes/api/admin/tmdb/search/+server.ts`

**Step 1: Create the endpoint**

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMovies } from '$lib/server/tmdb';

export const GET: RequestHandler = async ({ url, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const query = url.searchParams.get('q') || '';
    if (query.length < 2) {
        return json({ results: [] });
    }

    const results = await searchMovies(query);
    return json({
        results: results.slice(0, 10).map(r => ({
            id: r.id,
            title: r.title,
            release_date: r.release_date
        }))
    });
};
```

**Step 2: Verify no type errors**

Run: `cd app && npx svelte-check --threshold error 2>&1 | tail -5`
Expected: no errors

**Step 3: Commit**

```bash
git add app/src/routes/api/admin/tmdb/search/+server.ts
git commit -m "feat: add TMDB search API endpoint for admin"
```

---

### Task 3: Add `deleteFilm` to films module

**Files:**
- Modify: `app/src/lib/server/films.ts:161` (after `setFilmAvailability`)

**Step 1: Add deleteFilm function**

Add after `setFilmAvailability` (line 161):

```typescript
export function deleteFilm(filmId: number): void {
    db.prepare('DELETE FROM films WHERE id = ?').run(filmId);
}
```

The schema has `ON DELETE CASCADE` on `film_genres`, `rentals`, and `reviews` foreign keys, so related rows are cleaned up automatically.

**Step 2: Verify no type errors**

Run: `cd app && npx svelte-check --threshold error 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add app/src/lib/server/films.ts
git commit -m "feat: add deleteFilm function"
```

---

### Task 4: Add DELETE endpoint for films

**Files:**
- Modify: `app/src/routes/api/admin/films/[filmId]/availability/+server.ts` — NO, this is the availability endpoint
- Create: `app/src/routes/api/admin/films/[filmId]/+server.ts`

**Step 1: Create the endpoint**

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteFilm } from '$lib/server/films';

export const DELETE: RequestHandler = async ({ params, locals }) => {
    if (!locals.user?.is_admin) {
        return json({ error: 'Non autorisé' }, { status: 403 });
    }

    const filmId = parseInt(params.filmId);
    deleteFilm(filmId);
    return json({ success: true });
};
```

**Step 2: Verify no type errors**

Run: `cd app && npx svelte-check --threshold error 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add app/src/routes/api/admin/films/[filmId]/+server.ts
git commit -m "feat: add DELETE endpoint for films"
```

---

### Task 5: Update admin page with search and delete UI

**Files:**
- Modify: `app/src/routes/admin/films/+page.svelte` (full rewrite of script + template)

**Step 1: Replace the full page content**

```svelte
<script lang="ts">
    import { invalidateAll } from '$app/navigation';

    let { data } = $props();
    let query = $state('');
    let searchResults = $state<{ id: number; title: string; release_date: string }[]>([]);
    let searching = $state(false);
    let adding = $state(false);
    let error = $state('');
    let success = $state('');
    let debounceTimer: ReturnType<typeof setTimeout>;

    function onInput() {
        clearTimeout(debounceTimer);
        searchResults = [];
        if (query.length < 2) return;
        searching = true;
        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/admin/tmdb/search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                searchResults = data.results;
            } catch {
                searchResults = [];
            } finally {
                searching = false;
            }
        }, 300);
    }

    async function selectFilm(tmdbId: number) {
        adding = true;
        error = '';
        success = '';
        try {
            const res = await fetch('/api/admin/films', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tmdb_id: tmdbId })
            });
            const result = await res.json();
            if (!res.ok) {
                error = result.error;
                return;
            }
            success = `Film "${result.film.title}" ajouté avec succès !`;
            query = '';
            searchResults = [];
            invalidateAll();
        } catch {
            error = "Erreur lors de l'ajout";
        } finally {
            adding = false;
        }
    }

    async function deleteFilmAction(filmId: number, title: string) {
        if (!confirm(`Supprimer "${title}" du catalogue ?`)) return;
        try {
            const res = await fetch(`/api/admin/films/${filmId}`, { method: 'DELETE' });
            if (!res.ok) {
                error = 'Erreur lors de la suppression';
                return;
            }
            success = `"${title}" supprimé du catalogue`;
            invalidateAll();
        } catch {
            error = 'Erreur lors de la suppression';
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
        <div class="search-box">
            <input
                type="text"
                class="input"
                placeholder="Rechercher un film..."
                bind:value={query}
                oninput={onInput}
                disabled={adding}
            />
            {#if searching}
                <p class="hint">Recherche...</p>
            {/if}
        </div>
        {#if searchResults.length > 0}
            <ul class="search-results">
                {#each searchResults as result}
                    <li>
                        <button
                            class="search-result-btn"
                            onclick={() => selectFilm(result.id)}
                            disabled={adding}
                        >
                            {result.title}
                            {#if result.release_date}
                                <span class="year">({result.release_date.split('-')[0]})</span>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
        {#if adding}<p class="hint">Ajout en cours...</p>{/if}
        {#if error}<p class="error-message">{error}</p>{/if}
        {#if success}<p class="success-message">{success}</p>{/if}
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
                        <td class="actions">
                            <button class="btn btn-secondary btn-small" onclick={() => toggleAvailability(film.id, film.is_available)}>
                                {film.is_available ? 'Masquer' : 'Activer'}
                            </button>
                            <button class="btn btn-danger btn-small" onclick={() => deleteFilmAction(film.id, film.title)}>
                                Supprimer
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
    .search-box { margin-bottom: 0.5rem; }
    .search-box .input { width: 100%; max-width: 400px; }
    .hint { color: var(--text-muted); font-size: 0.85rem; }
    .search-results {
        list-style: none;
        padding: 0;
        margin: 0 0 1rem 0;
        max-width: 400px;
        border: 1px solid var(--bg-secondary);
        border-radius: var(--border-radius);
        max-height: 300px;
        overflow-y: auto;
    }
    .search-result-btn {
        width: 100%;
        text-align: left;
        padding: 0.6rem 1rem;
        background: none;
        border: none;
        border-bottom: 1px solid var(--bg-secondary);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.95rem;
    }
    .search-result-btn:hover { background: var(--bg-secondary); }
    .search-result-btn:disabled { opacity: 0.5; cursor: wait; }
    .search-results li:last-child .search-result-btn { border-bottom: none; }
    .year { color: var(--text-muted); }
    .films-table { width: 100%; border-collapse: collapse; background: var(--bg-card); border-radius: var(--border-radius); overflow: hidden; }
    .films-table th, .films-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--bg-secondary); }
    .films-table th { background: var(--bg-secondary); font-weight: 600; }
    .films-table tr:last-child td { border-bottom: none; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .badge.success { background: var(--success); color: white; }
    .badge.warning { background: var(--warning); color: black; }
    .badge.muted { background: var(--text-muted); color: white; }
    .actions { display: flex; gap: 0.5rem; }
    .btn-small { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .btn-danger { background: #dc3545; color: white; border: none; border-radius: var(--border-radius); cursor: pointer; }
    .btn-danger:hover { background: #c82333; }
</style>
```

**Step 2: Verify no type errors**

Run: `cd app && npx svelte-check --threshold error 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add app/src/routes/admin/films/+page.svelte
git commit -m "feat: admin search by title + delete films"
```
