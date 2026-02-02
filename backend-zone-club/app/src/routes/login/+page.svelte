<script lang="ts">
    import { goto } from '$app/navigation';

    let username = $state('');
    let password = $state('');
    let error = $state('');
    let loading = $state(false);

    async function handleSubmit() {
        error = '';
        loading = true;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                error = data.error;
                return;
            }

            goto('/rayons');
        } catch {
            error = 'Erreur de connexion';
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Connexion - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            <h1>Connexion</h1>

            <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <div class="form-group">
                    <label class="label" for="username">Pseudo</label>
                    <input type="text" id="username" class="input" bind:value={username} required />
                </div>

                <div class="form-group">
                    <label class="label" for="password">Mot de passe</label>
                    <input type="password" id="password" class="input" bind:value={password} required />
                </div>

                {#if error}
                    <p class="error-message">{error}</p>
                {/if}

                <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                    {loading ? 'Connexion...' : 'Se connecter'}
                </button>
            </form>

            <div class="auth-links">
                <a href="/recover">Mot de passe oublié ?</a>
                <a href="/register">Pas encore inscrit ?</a>
            </div>
        </div>
    </div>
</div>

<style>
    .auth-page { display: flex; justify-content: center; padding: 2rem 0; }
    .auth-card { width: 100%; max-width: 400px; }
    h1 { text-align: center; margin-bottom: 2rem; }
    .form-group { margin-bottom: 1.5rem; }
    .full-width { width: 100%; justify-content: center; }
    .auth-links { margin-top: 1.5rem; text-align: center; display: flex; flex-direction: column; gap: 0.5rem; }
</style>
