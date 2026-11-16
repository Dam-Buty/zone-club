// Règles d'un compte — une seule définition, pour le serveur (routes d'inscription et de
// récupération) et pour les deux formulaires (fenêtre du vidéoclub, borne).
//
// Elles vivaient en trois exemplaires qui avaient divergé. L'inscription étant limitée à
// 3 essais par quart d'heure, un visiteur découvrait les règles un refus à la fois et pouvait
// se retrouver bloqué avant d'avoir trouvé un mot de passe accepté. Les formulaires disent
// désormais le refus AVANT d'envoyer, avec les mots du serveur.
//
// Module sans import : il est chargé tel quel par Node dans les tests et par les routes.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 8;

/** Refus du pseudo, ou `null` s'il convient. */
export function usernameRuleError(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Le pseudo doit faire entre ${USERNAME_MIN} et ${USERNAME_MAX} caractères`;
  }
  return null;
}

/** Refus du mot de passe, ou `null` s'il convient. */
export function passwordRuleError(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre';
  }
  return null;
}

export type AccountFormMode = 'login' | 'register' | 'recover';

/**
 * Premier refus d'un formulaire de compte, ou `null` s'il peut partir.
 *
 * À la connexion, seule la présence des champs est vérifiée : un compte ancien peut porter un
 * pseudo ou un mot de passe d'avant les règles, et c'est au serveur de juger.
 */
export function accountFormError(
  mode: AccountFormMode,
  f: { username: string; password: string; confirm: string; phrase: string },
): string | null {
  const username = f.username.trim();
  if (!username) return 'Saisissez votre pseudo.';
  if (mode === 'register') {
    const refusal = usernameRuleError(username);
    if (refusal) return `${refusal}.`;
  }
  if (mode === 'recover' && !f.phrase.trim()) return 'Saisissez votre phrase de récupération.';
  if (!f.password) return 'Saisissez votre mot de passe.';
  if (mode !== 'login') {
    const refusal = passwordRuleError(f.password);
    if (refusal) return `${refusal}.`;
    if (f.confirm !== f.password) return 'Les deux mots de passe ne sont pas identiques.';
  }
  return null;
}
