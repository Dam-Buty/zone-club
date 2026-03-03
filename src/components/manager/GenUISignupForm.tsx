import { useState } from 'react';
import { useStore } from '../../store';
import styles from './ManagerChat.module.css';

export function GenUISignupForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'form' | 'loading' | 'passphrase' | 'done' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const register = useStore(s => s.register);
  const recoveryPhrase = useStore(s => s.recoveryPhrase);
  const clearRecoveryPhrase = useStore(s => s.clearRecoveryPhrase);
  const fetchMe = useStore(s => s.fetchMe);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    if (password !== confirm) {
      setErrorMsg('Les mots de passe ne correspondent pas');
      return;
    }
    setState('loading');
    setErrorMsg('');
    const ok = await register(username.trim(), password);
    if (ok) {
      setState('passphrase');
    } else {
      setErrorMsg(useStore.getState().authError || "Erreur d'inscription");
      setState('error');
    }
  };

  const handleCopy = async () => {
    if (recoveryPhrase) {
      await navigator.clipboard.writeText(recoveryPhrase);
      setCopied(true);
    }
  };

  const handleContinue = async () => {
    clearRecoveryPhrase();
    await fetchMe();
    setState('done');
  };

  if (state === 'done') {
    return (
      <div className={styles.genUICard}>
        <span className={styles.genUISuccess}>Inscription reussie !</span>
      </div>
    );
  }

  if (state === 'passphrase' && recoveryPhrase) {
    return (
      <div className={styles.genUICard}>
        <div className={styles.genUIAuthHeader}>Carte du club creee !</div>
        <div className={styles.genUIAuthForm}>
          <span className={styles.genUIPassphraseLabel}>
            Phrase de recuperation (a conserver) :
          </span>
          <code className={styles.genUIPassphrase}>{recoveryPhrase}</code>
          <div className={styles.genUIPassphraseActions}>
            <button className={styles.genUIButtonSecondary} onClick={handleCopy}>
              {copied ? 'Copie !' : 'Copier'}
            </button>
            <button className={styles.genUIButton} onClick={handleContinue}>
              Continuer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.genUICard}>
      <div className={styles.genUIAuthHeader}>Inscription</div>
      <form onSubmit={handleSubmit} className={styles.genUIAuthForm}>
        <input
          type="text"
          placeholder="Pseudo"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className={styles.genUIAuthInput}
          disabled={state === 'loading'}
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={styles.genUIAuthInput}
          disabled={state === 'loading'}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder="Confirmer le mot de passe"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className={styles.genUIAuthInput}
          disabled={state === 'loading'}
          autoComplete="new-password"
        />
        {errorMsg && <span className={styles.genUIError}>{errorMsg}</span>}
        <button
          type="submit"
          className={styles.genUIButton}
          disabled={state === 'loading' || !username.trim() || !password.trim() || !confirm.trim()}
        >
          {state === 'loading' ? 'Inscription...' : "S'inscrire"}
        </button>
      </form>
    </div>
  );
}
