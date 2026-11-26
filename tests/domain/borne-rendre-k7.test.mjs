// Rendre une K7 depuis « Mon compte » de la borne (Rusmir, 25/11/2026 : « on doit pouvoir rendre un film sur la borne »).
// Avant, seule la fiche K7 du vidéoclub 3D savait rendre un film (VHSCaseOverlay, « RETOURNER LA K7 »).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const src = (p) => readText(path.join(process.cwd(), p));

test('RENDRE: chaque location en cours de « Mon compte » a « Rendre », qui demande avant de rendre', () => {
  const account = src('src/components/kiosk/KioskAccount.tsx');
  assert.match(account, /onClick=\{\(\) => askReturn\(row\)\}/, 'le bouton de la ligne pose la question');
  assert.match(account, /\{returningId === row\.filmId \? 'Retour…' : 'Rendre'\}/);
  assert.match(account, /primary: \{ label: 'Rendre', onPress: \(\) => void doReturn\(row\.filmId, onTv\) \}/, 'rendre seulement après « Rendre »');
  assert.match(account, /secondary: \{ label: 'Annuler', onPress: \(\) => onNotice\(null\) \}/);
  assert.match(account, /const result = await returnFilm\(filmId\);/, 'le même retour que la fiche K7 (store.returnFilm → POST /return)');
  assert.match(account, /void fetchMe\(\);/, 'l\'historique relu après le retour');
  assert.match(account, /\.\.\.returnDoneText\(result, onTv\)/, 'un message dans tous les cas, échec compris');
  assert.match(src('src/components/kiosk/KioskView.tsx'), /onNotice=\{setNotice\}\s*onLogout=/, 'les messages de la borne');
});

test('RENDRE: le délai du crédit affiché est celui du serveur (une seule règle)', () => {
  assert.match(src('src/components/kiosk/kiosk-account-logic.ts'), /import \{ isEarlyReturn \} from '\.\.\/\.\.\/utils\/rental-rules\.ts';/);
});
