import { useState } from 'react';
import { useStore } from '../../store';
import styles from './ManagerChat.module.css';

export function GenUISigninForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'form' | 'loading' | 'success' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const login = useStore(s => s.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setState('loading');
    setErrorMsg('');
    const ok = await login(username.trim(), password);
    if (ok) {
      setState('success');
    } else {
      setErrorMsg('Pseudo ou mot de passe incorrect');
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <div className={styles.genUICard}>
        <span className={styles.genUISuccess}>Connecte !</span>
      </div>
    );
  }

  return (
    <div className={styles.genUICard}>
      <div className={styles.genUIAuthHeader}>Connexion</div>
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
          autoComplete="current-password"
        />
        {errorMsg && <span className={styles.genUIError}>{errorMsg}</span>}
        <button
          type="submit"
          className={styles.genUIButton}
          disabled={state === 'loading' || !username.trim() || !password.trim()}
        >
          {state === 'loading' ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
