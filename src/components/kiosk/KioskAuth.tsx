import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../../store';
import api from '../../api';
import { accountFormError } from '../../utils/account-rules';
import type { KioskAuthMode } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// Connexion, inscription et récupération du compte, dans la charte de la borne. Mêmes trois
// parcours que la fenêtre du vidéoclub, mais ici tout refus est dit : des mots de passe
// différents ou une récupération refusée par le serveur n'échouent plus en silence.
//
// La phrase de récupération vit dans le magasin (`recoveryPhrase`) jusqu'à ce que le visiteur
// confirme l'avoir notée : la borne la réaffiche tant que ce n'est pas fait, même si ce panneau
// a été fermé entre-temps.

interface KioskAuthProps {
  initialMode?: KioskAuthMode;
  /** Le visiteur est connecté (et a noté sa phrase s'il vient de la recevoir). */
  onDone: () => void;
  onCancel: () => void;
}

const COPY: Record<KioskAuthMode, { title: string; submit: string }> = {
  login: { title: 'Connexion', submit: 'Se connecter' },
  register: { title: 'Créer un compte', submit: 'Créer mon compte' },
  recover: { title: 'Récupérer mon compte', submit: 'Changer le mot de passe' },
};

export function KioskAuth({ initialMode = 'login', onDone, onCancel }: KioskAuthProps) {
  const fieldId = useId();
  const [mode, setMode] = useState<KioskAuthMode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phrase, setPhrase] = useState('');
  // Refus du formulaire lui-même, ou du serveur pour la récupération (qui ne passe pas par le magasin).
  const [formError, setFormError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const phraseRef = useRef<HTMLElement>(null);

  const login = useStore((state) => state.login);
  const register = useStore((state) => state.register);
  const fetchMe = useStore((state) => state.fetchMe);
  const isLoading = useStore((state) => state.isLoading);
  const authError = useStore((state) => state.authError);
  const clearAuthError = useStore((state) => state.clearAuthError);
  const pendingPhrase = useStore((state) => state.recoveryPhrase);
  const clearRecoveryPhrase = useStore((state) => state.clearRecoveryPhrase);

  const busy = isLoading || recovering;

  // Un refus resté d'une tentative précédente n'a rien à faire sur un panneau qui s'ouvre.
  useEffect(() => {
    clearAuthError();
  }, [clearAuthError]);

  const switchMode = (next: KioskAuthMode) => {
    clearAuthError();
    setFormError(null);
    setPassword('');
    setConfirm('');
    setPhrase('');
    setMode(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    clearAuthError();
    const refusal = accountFormError(mode, { username, password, confirm, phrase });
    setFormError(refusal);
    if (refusal) return;

    const name = username.trim();
    if (mode === 'login') {
      if (await login(name, password)) onDone();
      return;
    }
    if (mode === 'register') {
      // En cas de succès le magasin reçoit la phrase : l'écran final s'affiche de lui-même.
      await register(name, password);
      return;
    }
    setRecovering(true);
    try {
      const { newRecoveryPhrase } = await api.auth.recover(name, phrase.trim(), password);
      useStore.setState({ recoveryPhrase: newRecoveryPhrase });
      await fetchMe();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Récupération impossible.');
    } finally {
      setRecovering(false);
    }
  };

  const copyPhrase = () => {
    if (!pendingPhrase) return;
    const selectPhrase = () => {
      // Repli quand le presse-papiers est refusé : la phrase est sélectionnée, prête à être copiée à la main.
      const node = phraseRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      setCopyState('selected');
    };
    try {
      navigator.clipboard.writeText(pendingPhrase).then(() => setCopyState('copied'), selectPhrase);
    } catch {
      selectPhrase();
    }
  };

  const acknowledgePhrase = () => {
    clearRecoveryPhrase();
    onDone();
  };

  // ----- Écran final : la phrase de récupération -----
  if (pendingPhrase) {
    return (
      <div className={styles.kAuth}>
        <h2 className={styles.kAuthTitle}>Votre phrase de récupération</h2>
        <code ref={phraseRef} className={styles.kAuthPhrase}>{pendingPhrase}</code>
        <p className={styles.kAuthText}>
          Notez-la : elle seule permet de retrouver votre compte si vous oubliez votre mot de passe.
        </p>
        <div className={styles.kAuthLinks}>
          <button type="button" className={styles.kAuthLink} onClick={copyPhrase}>
            {copyState === 'copied' ? 'Copiée' : copyState === 'selected' ? 'Sélectionnée : copiez-la' : 'Copier'}
          </button>
        </div>
        <button type="button" className={styles.kAuthSubmit} onClick={acknowledgePhrase}>
          J'ai noté ma phrase
        </button>
      </div>
    );
  }

  const shownError = formError ?? authError;
  const passwordAutoComplete = mode === 'login' ? 'current-password' : 'new-password';

  return (
    <div className={styles.kAuth}>
      <button type="button" className={styles.kAuthBack} onClick={onCancel}>
        Retour
      </button>
      <h2 className={styles.kAuthTitle}>{COPY[mode].title}</h2>

      <form noValidate onSubmit={submit}>
        <label className={styles.kField} htmlFor={`${fieldId}-user`}>
          <span className={styles.kFieldLabel}>Pseudo</span>
          <input
            id={`${fieldId}-user`}
            className={styles.kInput}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            autoFocus
          />
        </label>

        {mode === 'recover' && (
          <label className={styles.kField} htmlFor={`${fieldId}-phrase`}>
            <span className={styles.kFieldLabel}>Phrase de récupération</span>
            <input
              id={`${fieldId}-phrase`}
              className={styles.kInput}
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        )}

        <label className={styles.kField} htmlFor={`${fieldId}-pass`}>
          <span className={styles.kFieldLabel}>{mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'}</span>
          <input
            id={`${fieldId}-pass`}
            className={styles.kInput}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={passwordAutoComplete}
          />
        </label>

        {mode !== 'login' && (
          <label className={styles.kField} htmlFor={`${fieldId}-confirm`}>
            <span className={styles.kFieldLabel}>Confirmation du mot de passe</span>
            <input
              id={`${fieldId}-confirm`}
              className={styles.kInput}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}

        {shownError && (
          <p className={styles.kAuthError} role="alert">
            {shownError}
          </p>
        )}

        {/* Jamais grisé : pendant l'appel il le dit, et l'appui est ignoré. */}
        <button type="submit" className={styles.kAuthSubmit} aria-busy={busy}>
          {busy ? 'Un instant…' : COPY[mode].submit}
        </button>
      </form>

      <div className={styles.kAuthLinks}>
        {mode === 'login' && (
          <>
            <button type="button" className={styles.kAuthLink} onClick={() => switchMode('register')}>
              Créer un compte
            </button>
            <button type="button" className={styles.kAuthLink} onClick={() => switchMode('recover')}>
              Mot de passe oublié
            </button>
          </>
        )}
        {mode === 'register' && (
          <button type="button" className={styles.kAuthLink} onClick={() => switchMode('login')}>
            J'ai déjà un compte
          </button>
        )}
        {mode === 'recover' && (
          <button type="button" className={styles.kAuthLink} onClick={() => switchMode('login')}>
            Retour à la connexion
          </button>
        )}
      </div>
    </div>
  );
}
