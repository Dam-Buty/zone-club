<script lang="ts">
    import '../app.css';
    import type { LayoutData } from './$types';

    let { data, children } = $props();

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    }
</script>

<header>
    <nav class="container">
        <a href="/" class="logo">Zone Club</a>

        <div class="nav-links">
            {#if data.user}
                <a href="/rayons">Rayons</a>
                <a href="/compte">Mon compte</a>
                <span class="credits">{data.user.credits} crédit{data.user.credits !== 1 ? 's' : ''}</span>
                {#if data.user.is_admin}
                    <a href="/admin/films">Admin</a>
                {/if}
                <button class="btn-logout" onclick={logout}>Déconnexion</button>
            {:else}
                <a href="/login">Connexion</a>
                <a href="/register">Inscription</a>
            {/if}
        </div>
    </nav>
</header>

<main>
    {@render children()}
</main>

<footer>
    <div class="container">
        <p>Zone Club - Votre vidéoclub en ligne</p>
    </div>
</footer>

<style>
    header {
        background: var(--bg-secondary);
        padding: 1rem 0;
        position: sticky;
        top: 0;
        z-index: 100;
    }

    nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .logo {
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--accent);
    }

    .nav-links {
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }

    .credits {
        background: var(--accent);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.9rem;
    }

    .btn-logout {
        background: none;
        border: 1px solid var(--text-muted);
        color: var(--text-secondary);
        padding: 0.5rem 1rem;
        border-radius: var(--border-radius);
        font-size: 0.9rem;
    }

    .btn-logout:hover {
        border-color: var(--accent);
        color: var(--accent);
    }

    main {
        min-height: calc(100vh - 140px);
        padding: 2rem 0;
    }

    footer {
        background: var(--bg-secondary);
        padding: 1.5rem 0;
        text-align: center;
        color: var(--text-muted);
    }
</style>
