import { useState, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import styles from './AuthModal.module.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: 'login' | 'register' | 'recover';
}

type AuthMode = 'login' | 'register' | 'recover' | 'recovery-phrase';

export function AuthModal({ isOpen, onClose, onSuccess, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [newRecoveryPhrase, setNewRecoveryPhrase] = useState('');
  const [copied, setCopied] = useState(false);

  const formId = useId();
  const login = useStore(state => state.login);
  const register = useStore(state => state.register);
  const isLoading = useStore(state => state.isLoading);
  const authError = useStore(state => state.authError);
  const registeredPhrase = useStore(state => state.recoveryPhrase);
  const clearAuthError = useStore(state => state.clearAuthError);
  const clearRecoveryPhrase = useStore(state => state.clearRecoveryPhrase);

  const resetForm = useCallback(() => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRecoveryPhrase('');
    setNewRecoveryPhrase('');
    setCopied(false);
    clearAuthError();
  }, [clearAuthError]);

  const handleClose = useCallback(() => {
    resetForm();
    setMode('login');
    clearRecoveryPhrase();
    onClose();
  }, [resetForm, clearRecoveryPhrase, onClose]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();

    const success = await login(username, password);
    if (success) {
      resetForm();
      onSuccess?.();
      onClose();
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();

    if (password !== confirmPassword) {
      return;
    }

    const success = await register(username, password);
    if (success) {
      setMode('recovery-phrase');
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();

    if (password !== confirmPassword) {
      return;
    }

    try {
      const response = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, recoveryPhrase, newPassword: password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur de recuperation');
      }

      setNewRecoveryPhrase(data.newRecoveryPhrase);
      setMode('recovery-phrase');
    } catch (error) {
      console.error('Recovery error:', error);
    }
  };

  const handleCopyPhrase = () => {
    const phrase = registeredPhrase || newRecoveryPhrase;
    if (phrase) {
      navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleContinue = () => {
    clearRecoveryPhrase();
    resetForm();
    setMode('login');
    onSuccess?.();
    onClose();
  };

  const switchMode = (newMode: AuthMode) => {
    resetForm();
    setMode(newMode);
  };

  if (!isOpen) return null;

  const content = (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.terminal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          {mode === 'login' && 'CONNEXION'}
          {mode === 'register' && 'INSCRIPTION'}
          {mode === 'recover' && 'RECUPERATION'}
          {mode === 'recovery-phrase' && 'PASSPHRASE'}
          <span className={styles.cursor} />
        </div>

        <div className={styles.content}>
          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-login-user`} className={styles.label}>PSEUDO</label>
                <input
                  id={`${formId}-login-user`}
                  type="text"
                  className={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-login-pass`} className={styles.label}>MOT DE PASSE</label>
                <input
                  id={`${formId}-login-pass`}
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  minLength={8}
                />
              </div>

              {authError && <p className={styles.error}>{authError}</p>}

              <button type="submit" className={styles.submitButton} disabled={isLoading}>
                {isLoading ? 'CONNEXION...' : 'SE CONNECTER'}
              </button>

              <div className={styles.links}>
                <button type="button" className={styles.link} onClick={() => switchMode('recover')}>
                  Mot de passe oublie ?
                </button>
                <button type="button" className={styles.link} onClick={() => switchMode('register')}>
                  Pas encore inscrit ?
                </button>
              </div>
            </form>
          )}

          {/* Register Form */}
          {mode === 'register' && (
            <form onSubmit={handleRegister}>
              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-reg-user`} className={styles.label}>PSEUDO</label>
                <input
                  id={`${formId}-reg-user`}
                  type="text"
                  className={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-reg-pass`} className={styles.label}>MOT DE PASSE</label>
                <input
                  id={`${formId}-reg-pass`}
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-reg-confirm`} className={styles.label}>CONFIRMER LE MOT DE PASSE</label>
                <input
                  id={`${formId}-reg-confirm`}
                  type="password"
                  className={styles.input}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {password !== confirmPassword && confirmPassword && (
                <p className={styles.error}>Les mots de passe ne correspondent pas</p>
              )}

              {authError && <p className={styles.error}>{authError}</p>}

              <button
                type="submit"
                className={styles.submitButton}
                disabled={isLoading || password !== confirmPassword}
              >
                {isLoading ? 'INSCRIPTION...' : "S'INSCRIRE"}
              </button>

              <div className={styles.links}>
                <button type="button" className={styles.link} onClick={() => switchMode('login')}>
                  Deja inscrit ?
                </button>
              </div>
            </form>
          )}

          {/* Recover Form */}
          {mode === 'recover' && (
            <form onSubmit={handleRecover}>
              <p className={styles.intro}>
                Entrez votre pseudo et votre passphrase de recuperation pour definir un nouveau mot de passe.
              </p>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-rec-user`} className={styles.label}>PSEUDO</label>
                <input
                  id={`${formId}-rec-user`}
                  type="text"
                  className={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-rec-phrase`} className={styles.label}>PASSPHRASE DE RECUPERATION</label>
                <input
                  id={`${formId}-rec-phrase`}
                  type="text"
                  className={styles.input}
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  placeholder="plat-origine-qualificatif"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-rec-pass`} className={styles.label}>NOUVEAU MOT DE PASSE</label>
                <input
                  id={`${formId}-rec-pass`}
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor={`${formId}-rec-confirm`} className={styles.label}>CONFIRMER LE MOT DE PASSE</label>
                <input
                  id={`${formId}-rec-confirm`}
                  type="password"
                  className={styles.input}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {password !== confirmPassword && confirmPassword && (
                <p className={styles.error}>Les mots de passe ne correspondent pas</p>
              )}

              {authError && <p className={styles.error}>{authError}</p>}

              <button
                type="submit"
                className={styles.submitButton}
                disabled={isLoading || password !== confirmPassword}
              >
                {isLoading ? 'RECUPERATION...' : 'RECUPERER MON COMPTE'}
              </button>

              <div className={styles.links}>
                <button type="button" className={styles.link} onClick={() => switchMode('login')}>
                  Retour a la connexion
                </button>
              </div>
            </form>
          )}

          {/* Recovery Phrase Display */}
          {mode === 'recovery-phrase' && (
            <div className={styles.recoverySection}>
              <div className={styles.warning}>
                <strong>IMPORTANT !</strong>
                <p>
                  {newRecoveryPhrase
                    ? "Votre ancienne passphrase n'est plus valide. Notez la nouvelle."
                    : 'Notez votre passphrase de recuperation. Elle ne sera plus jamais affichee.'}
                </p>
              </div>

              <div className={styles.passphraseBox}>
                <code className={styles.passphrase}>{registeredPhrase || newRecoveryPhrase}</code>
                <button type="button" className={styles.copyButton} onClick={handleCopyPhrase}>
                  {copied ? 'COPIE !' : 'COPIER'}
                </button>
              </div>

              <p className={styles.hint}>
                Cette passphrase vous permettra de recuperer votre compte si vous oubliez votre mot de passe.
              </p>

              <button type="button" className={styles.submitButton} onClick={handleContinue}>
                J'AI NOTE MA PASSPHRASE, CONTINUER
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          [ESC] Fermer | ZONE CLUB v1.0
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
