<script lang="ts">
    import { goto } from '$app/navigation';

    let username = $state('');
    let password = $state('');
    let confirmPassword = $state('');
    let error = $state('');
    let loading = $state(false);
    let recoveryPhrase = $state('');
    let showRecovery = $state(false);

    async function handleSubmit() {
        error = '';

        if (password !== confirmPassword) {
            error = 'Les mots de passe ne correspondent pas';
            return;
        }

        loading = true;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                error = data.error;
                return;
            }

            recoveryPhrase = data.recoveryPhrase;
            showRecovery = true;
        } catch {
            error = 'Erreur lors de l\'inscription';
        } finally {
            loading = false;
        }
    }

    function copyPhrase() {
        navigator.clipboard.writeText(recoveryPhrase);
    }

    function continueToSite() {
        goto('/rayons');
    }
</script>

<svelte:head>
    <title>Inscription - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            {#if showRecovery}
                <h1>Bienvenue !</h1>
                <div class="recovery-section">
                    <p class="warning">
                        <strong>Important !</strong> Notez votre passphrase de récupération. Elle ne sera plus jamais affichée.
                    </p>
                    <div class="passphrase-box">
                        <code>{recoveryPhrase}</code>
                        <button class="btn btn-secondary" onclick={copyPhrase}>Copier</button>
                    </div>
                    <p class="hint">Cette passphrase vous permettra de récupérer votre compte si vous oubliez votre mot de passe.</p>
                    <button class="btn btn-primary full-width" onclick={continueToSite}>J'ai noté ma passphrase, continuer</button>
                </div>
            {:else}
                <h1>Inscription</h1>
                <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <div class="form-group">
                        <label class="label" for="username">Pseudo</label>
                        <input type="text" id="username" class="input" bind:value={username} minlength="3" maxlength="30" required />
                    </div>
                    <div class="form-group">
                        <label class="label" for="password">Mot de passe</label>
                        <input type="password" id="password" class="input" bind:value={password} minlength="8" required />
                    </div>
                    <div class="form-group">
                        <label class="label" for="confirmPassword">Confirmer le mot de passe</label>
                        <input type="password" id="confirmPassword" class="input" bind:value={confirmPassword} required />
                    </div>
                    {#if error}
                        <p class="error-message">{error}</p>
                    {/if}
                    <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                        {loading ? 'Inscription...' : 'S\'inscrire'}
                    </button>
                </form>
                <div class="auth-links">
                    <a href="/login">Déjà inscrit ?</a>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .auth-page { display: flex; justify-content: center; padding: 2rem 0; }
    .auth-card { width: 100%; max-width: 450px; }
    h1 { text-align: center; margin-bottom: 2rem; }
    .form-group { margin-bottom: 1.5rem; }
    .full-width { width: 100%; justify-content: center; }
    .auth-links { margin-top: 1.5rem; text-align: center; }
    .recovery-section { text-align: center; }
    .warning { background: rgba(251, 191, 36, 0.1); border: 1px solid var(--warning); padding: 1rem; border-radius: var(--border-radius); margin-bottom: 1.5rem; }
    .passphrase-box { background: var(--bg-secondary); padding: 1.5rem; border-radius: var(--border-radius); margin-bottom: 1rem; }
    .passphrase-box code { display: block; font-size: 1.25rem; margin-bottom: 1rem; color: var(--accent); word-break: break-all; }
    .hint { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
</style>
