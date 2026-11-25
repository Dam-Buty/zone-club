// L'angle de vue de la dalle de la borne d'après l'orientation du téléphone : sorti de kiosk-logic.ts
// (budget de taille des fichiers). Pur et sans import, testé dans tests/domain/kiosk-logic.test.mjs.

export type ViewingAngle = { washOut: number; darken: number; warm: number; cool: number; reflectX: number; reflectY: number };

/**
 * En deçà, tenir le téléphone ne change rien ; au-delà de ANGLE_FULL, l'effet est entier. En degrés.
 * 35° au départ ; 60° depuis le 17/11/2026 (Rusmir : « plus d'angle réaliste, le mouvement est trop
 * restreint ») : une TN change dès qu'on la penche et continue de changer bien au-delà de 30°.
 */
const ANGLE_DEAD = 4;
const ANGLE_FULL = 60;

/**
 * Ce que l'angle de vue fait à une dalle TN, d'après l'écart d'inclinaison du téléphone avec sa
 * position « de face » (degrés ; `dBeta` : avant/arrière, positif quand le haut vient vers soi ;
 * `dGamma` : de côté). Vue d'en dessus, l'image se délave ; vue d'en dessous, elle s'assombrit
 * (une TN y tend vers le négatif, qu'on ne peut pas simuler sans filtre) ; de côté, la teinte
 * glisse. Le reflet, lui, glisse sur la vitre. Chaque valeur va de 0 à 1 (de -1 à 1 pour le reflet).
 */
export function viewingAngle(dBeta: number, dGamma: number): ViewingAngle {
  if (!Number.isFinite(dBeta) || !Number.isFinite(dGamma)) return { washOut: 0, darken: 0, warm: 0, cool: 0, reflectX: 0, reflectY: 0 };
  const ramp = (deg: number) => {
    const a = Math.abs(deg);
    return a <= ANGLE_DEAD ? 0 : Math.min(1, (a - ANGLE_DEAD) / (ANGLE_FULL - ANGLE_DEAD));
  };
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const v = ramp(dBeta);
  const h = ramp(dGamma);
  return {
    washOut: dBeta > 0 ? v : 0,
    darken: dBeta < 0 ? v : 0,
    warm: dGamma > 0 ? h : 0,
    cool: dGamma < 0 ? h : 0,
    reflectX: clamp(dGamma / ANGLE_FULL) + 0,
    reflectY: clamp(dBeta / ANGLE_FULL) + 0,
  };
}

/** Direction du regard dans le repère du monde (vecteur unitaire, de l'écran vers l'œil). */
export type EyeDirection = readonly [number, number, number];

/**
 * Sous quel angle on regarde l'écran, d'après l'orientation du téléphone (`deviceorientation`, en
 * degrés). L'œil est supposé là où pointait l'écran (sa position « de face »), et cette position suit
 * lentement la façon dont on tient le téléphone (constante de temps `tauMs`) : un geste rapide se
 * voit ; une façon durable de le tenir redevient « de face ». Rend la nouvelle position de l'œil et
 * l'écart, en degrés, à donner à viewingAngle (`dBeta` : haut de l'écran vers soi ; `dGamma` : de côté).
 *
 * Le calcul passe par l'orientation complète (la matrice Rz(alpha)·Rx(beta)·Ry(gamma) de la norme),
 * jamais par les angles un à un : autour de beta = 90° (téléphone droit, ou au-dessus du visage dans
 * le canapé), Chrome fait basculer gamma de -90° à +90° et beta de 100° à 80° pour un geste lent de
 * quelques degrés. Suivre chaque angle séparément envoyait alors le reflet d'un bord à l'autre
 * (Rusmir, 25/11/2026). L'orientation, elle, ne saute pas.
 */
export function followView(eye: EyeDirection | null, alpha: number | null, beta: number, gamma: number, dtMs: number, tauMs = 8000): { eye: EyeDirection; dBeta: number; dGamma: number } {
  const rad = Math.PI / 180;
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return { eye: eye ?? [0, 0, 1], dBeta: 0, dGamma: 0 };
  const a = (Number.isFinite(alpha) ? (alpha as number) : 0) * rad;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(beta * rad), sb = Math.sin(beta * rad), cg = Math.cos(gamma * rad), sg = Math.sin(gamma * rad);
  // Rz(alpha)·Rx(beta)·Ry(gamma), appareil → monde, rangée par lignes.
  const r = [
    ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
    sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
    -cb * sg, sb, cb * cg,
  ];
  // Où pointe l'écran (son axe z), et l'œil qui le suit lentement.
  const n: EyeDirection = [r[2], r[5], r[8]];
  let next: EyeDirection = n;
  if (eye) {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
    const v = [eye[0] + (n[0] - eye[0]) * k, eye[1] + (n[1] - eye[1]) * k, eye[2] + (n[2] - eye[2]) * k];
    const len = Math.hypot(v[0], v[1], v[2]);
    next = len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : n;
  }
  // L'œil vu depuis le téléphone (transposée de la matrice).
  const dx = r[0] * next[0] + r[3] * next[1] + r[6] * next[2];
  const dy = r[1] * next[0] + r[4] * next[1] + r[7] * next[2];
  const dz = r[2] * next[0] + r[5] * next[1] + r[8] * next[2];
  return { eye: next, dBeta: Math.atan2(dy, dz) / rad + 0, dGamma: Math.atan2(-dx, dz) / rad + 0 };
}
