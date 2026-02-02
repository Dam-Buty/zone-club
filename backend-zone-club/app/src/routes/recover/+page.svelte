<script lang="ts">
    import { goto } from '$app/navigation';

    let username = $state('');
    let recoveryPhrase = $state('');
    let newPassword = $state('');
    let confirmPassword = $state('');
    let error = $state('');
    let loading = $state(false);
    let newRecoveryPhrase = $state('');
    let showNewPhrase = $state(false);

    async function handleSubmit() {
        error = '';
        if (newPassword !== confirmPassword) {
            error = 'Les mots de passe ne correspondent pas';
            return;
        }
        loading = true;
        try {
            const res = await fetch('/api/auth/recover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, recoveryPhrase, newPassword })
            });
            const data = await res.json();
            if (!res.ok) {
                error = data.error;
                return;
            }
            newRecoveryPhrase = data.newRecoveryPhrase;
            showNewPhrase = true;
        } catch {
            error = 'Erreur lors de la récupération';
        } finally {
            loading = false;
        }
    }

    function copyPhrase() { navigator.clipboard.writeText(newRecoveryPhrase); }
    function continueToSite() { goto('/rayons'); }
</script>

<svelte:head>
    <title>Récupération - Zone Club</title>
</svelte:head>

<div class="container">
    <div class="auth-page">
        <div class="card auth-card">
            {#if showNewPhrase}
                <h1>Compte récupéré !</h1>
                <div class="recovery-section">
                    <p class="warning"><strong>Nouvelle passphrase !</strong> Votre ancienne passphrase n'est plus valide. Notez la nouvelle.</p>
                    <div class="passphrase-box">
                        <code>{newRecoveryPhrase}</code>
                        <button class="btn btn-secondary" onclick={copyPhrase}>Copier</button>
                    </div>
                    <button class="btn btn-primary full-width" onclick={continueToSite}>J'ai noté ma passphrase, continuer</button>
                </div>
            {:else}
                <h1>Récupération</h1>
                <p class="intro">Entrez votre pseudo et votre passphrase de récupération pour définir un nouveau mot de passe.</p>
                <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <div class="form-group">
                        <label class="label" for="username">Pseudo</label>
                        <input type="text" id="username" class="input" bind:value={username} required />
                    </div>
                    <div class="form-group">
                        <label class="label" for="recoveryPhrase">Passphrase de récupération</label>
                        <input type="text" id="recoveryPhrase" class="input" bind:value={recoveryPhrase} placeholder="plat-origine-qualificatif" required />
                    </div>
                    <div class="form-group">
                        <label class="label" for="newPassword">Nouveau mot de passe</label>
                        <input type="password" id="newPassword" class="input" bind:value={newPassword} minlength="8" required />
                    </div>
                    <div class="form-group">
                        <label class="label" for="confirmPassword">Confirmer le mot de passe</label>
                        <input type="password" id="confirmPassword" class="input" bind:value={confirmPassword} required />
                    </div>
                    {#if error}
                        <p class="error-message">{error}</p>
                    {/if}
                    <button type="submit" class="btn btn-primary full-width" disabled={loading}>
                        {loading ? 'Récupération...' : 'Récupérer mon compte'}
                    </button>
                </form>
                <div class="auth-links">
                    <a href="/login">Retour à la connexion</a>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .auth-page { display: flex; justify-content: center; padding: 2rem 0; }
    .auth-card { width: 100%; max-width: 450px; }
    h1 { text-align: center; margin-bottom: 1rem; }
    .intro { text-align: center; color: var(--text-secondary); margin-bottom: 2rem; }
    .form-group { margin-bottom: 1.5rem; }
    .full-width { width: 100%; justify-content: center; }
    .auth-links { margin-top: 1.5rem; text-align: center; }
    .recovery-section { text-align: center; }
    .warning { background: rgba(251, 191, 36, 0.1); border: 1px solid var(--warning); padding: 1rem; border-radius: var(--border-radius); margin-bottom: 1.5rem; }
    .passphrase-box { background: var(--bg-secondary); padding: 1.5rem; border-radius: var(--border-radius); margin-bottom: 1.5rem; }
    .passphrase-box code { display: block; font-size: 1.25rem; margin-bottom: 1rem; color: var(--accent); }
</style>
