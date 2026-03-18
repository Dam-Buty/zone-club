/**
 * Audit UX + Compatibility + Mobile Fixes — Regression Tests
 *
 * Guards against reintroducing UX/compat issues fixed in audit-2026-03-17:
 *   U-01: Hardcoded localhost URL in AuthModal recovery flow
 *   U-03: Missing htmlFor/id and autoComplete on form inputs (accessibility)
 *   U-10: AuthModal not responsive on mobile (fixed width)
 *   C-02: Safari fullscreen missing webkit vendor prefixes
 *   MOBILE: currentScene/currentAisle not persisted (state loss on tab switch)
 *
 * Run: node --test tests/domain/audit-ux-compat.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

const ROOT = process.cwd();

// ===== U-01: No Hardcoded localhost URLs =====

test('U-01: AuthModal must NOT contain localhost URLs', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));
  assert.ok(
    !source.includes('localhost'),
    'AuthModal must use relative URLs, not hardcoded localhost'
  );
  assert.ok(
    !source.includes('127.0.0.1'),
    'AuthModal must not use hardcoded 127.0.0.1'
  );
});

test('U-01: recovery fetch must use relative URL /api/auth/recover', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));
  assert.ok(
    source.includes("fetch('/api/auth/recover'"),
    'Recovery endpoint must use relative URL /api/auth/recover'
  );
});

// ===== U-03: Form Accessibility =====

test('U-03: AuthModal must use useId() hook for form field IDs', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));
  assert.ok(
    source.includes("import") && source.includes('useId'),
    'Must import useId from React'
  );
  assert.ok(
    source.includes('useId()'),
    'Must call useId() to generate unique IDs'
  );
});

test('U-03: all form inputs must have htmlFor/id association', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));

  // Count labels with htmlFor vs labels without
  const labelsWithFor = (source.match(/htmlFor=/g) || []).length;
  const totalLabels = (source.match(/<label/g) || []).length;

  // All labels that wrap inputs should have htmlFor
  // (excludes labels used purely for display)
  assert.ok(
    labelsWithFor >= 9,
    `Expected at least 9 htmlFor attributes (login:2, register:3, recover:4), found ${labelsWithFor}`
  );
});

test('U-03: login form must have autoComplete attributes', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));

  // Extract login form block — use the Login Form comment as anchor
  const loginStart = source.indexOf('{/* Login Form */}');
  const loginEnd = source.indexOf('{/* Register Form */}');
  const loginBlock = source.slice(loginStart, loginEnd);

  assert.ok(
    loginBlock.includes('autoComplete="username"'),
    'Login username input must have autoComplete="username"'
  );
  assert.ok(
    loginBlock.includes('autoComplete="current-password"'),
    'Login password input must have autoComplete="current-password"'
  );
});

test('U-03: register form must have autoComplete attributes', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));

  const regStart = source.indexOf('{/* Register Form */}');
  const regEnd = source.indexOf('{/* Recover Form */}');
  const regBlock = source.slice(regStart, regEnd);

  assert.ok(
    regBlock.includes('autoComplete="username"'),
    'Register username input must have autoComplete="username"'
  );
  // Both password fields should use new-password
  const newPasswordCount = (regBlock.match(/autoComplete="new-password"/g) || []).length;
  assert.ok(
    newPasswordCount >= 2,
    `Register form must have autoComplete="new-password" on both password fields, found ${newPasswordCount}`
  );
});

test('U-03: recovery form must have autoComplete attributes', () => {
  const source = readText(path.join(ROOT, 'src/components/auth/AuthModal.tsx'));

  const recStart = source.indexOf('{/* Recover Form */}');
  const recEnd = source.indexOf('{/* Recovery Phrase Display */}');
  const recBlock = source.slice(recStart, recEnd);

  assert.ok(
    recBlock.includes('autoComplete="username"'),
    'Recovery username input must have autoComplete="username"'
  );
  const newPasswordCount = (recBlock.match(/autoComplete="new-password"/g) || []).length;
  assert.ok(
    newPasswordCount >= 2,
    `Recovery form must have autoComplete="new-password" on both password fields, found ${newPasswordCount}`
  );
});

// ===== U-10: Responsive AuthModal =====

test('U-10: AuthModal terminal must use responsive width (not fixed px)', () => {
  const css = readText(path.join(ROOT, 'src/components/auth/AuthModal.module.css'));

  // Must NOT have a plain fixed width like "width: 450px"
  // Must have min() or clamp() or max() for responsiveness
  const terminalBlock = css.slice(css.indexOf('.terminal'), css.indexOf('.header'));
  assert.ok(
    terminalBlock.includes('min(') || terminalBlock.includes('clamp(') || terminalBlock.includes('max('),
    'Terminal width must use min()/clamp()/max() for mobile responsiveness'
  );
  assert.ok(
    terminalBlock.includes('90vw'),
    'Terminal width must include vw unit for viewport-relative sizing'
  );
});

// ===== C-02: Safari Fullscreen =====

test('C-02: VHSPlayer must handle webkit fullscreen prefix', () => {
  const source = readText(path.join(ROOT, 'src/components/player/VHSPlayer.tsx'));
  assert.ok(
    source.includes('webkitRequestFullscreen'),
    'Must handle webkitRequestFullscreen for Safari'
  );
  assert.ok(
    source.includes('webkitExitFullscreen'),
    'Must handle webkitExitFullscreen for Safari'
  );
  assert.ok(
    source.includes('webkitFullscreenElement'),
    'Must check webkitFullscreenElement for Safari'
  );
});

test('C-02: fullscreen toggle must check both standard and webkit APIs', () => {
  const source = readText(path.join(ROOT, 'src/components/player/VHSPlayer.tsx'));

  // Find the fullscreen case block
  const fCaseStart = source.indexOf("case 'f':");
  const fCaseEnd = source.indexOf('break;', fCaseStart);
  const fBlock = source.slice(fCaseStart, fCaseEnd);

  // Must check both standard and webkit for entering fullscreen
  assert.ok(
    fBlock.includes('document.fullscreenElement') && fBlock.includes('webkitFullscreenElement'),
    'Must check both document.fullscreenElement and webkitFullscreenElement'
  );

  // Must call both standard and webkit for exiting fullscreen
  assert.ok(
    fBlock.includes('document.exitFullscreen') || fBlock.includes('exitFullscreen'),
    'Must handle standard exitFullscreen'
  );
  assert.ok(
    fBlock.includes('webkitExitFullscreen'),
    'Must handle webkit exitFullscreen'
  );
});

// ===== MOBILE: State Persistence =====

test('MOBILE: store must persist currentScene in partialize config', () => {
  const source = readText(path.join(ROOT, 'src/store/index.ts'));
  const partializeStart = source.indexOf('partialize:');
  const partializeEnd = source.indexOf('})', partializeStart);
  const partializeBlock = source.slice(partializeStart, partializeEnd);

  assert.ok(
    partializeBlock.includes('currentScene'),
    'partialize must include currentScene — prevents mobile tab-switch resetting to exterior'
  );
});

test('MOBILE: store must persist currentAisle in partialize config', () => {
  const source = readText(path.join(ROOT, 'src/store/index.ts'));
  const partializeStart = source.indexOf('partialize:');
  const partializeEnd = source.indexOf('})', partializeStart);
  const partializeBlock = source.slice(partializeStart, partializeEnd);

  assert.ok(
    partializeBlock.includes('currentAisle'),
    'partialize must include currentAisle — preserves user navigation on mobile'
  );
});

test('MOBILE: store must NOT persist transient UI state in partialize', () => {
  const source = readText(path.join(ROOT, 'src/store/index.ts'));
  const partializeStart = source.indexOf('partialize:');
  const partializeEnd = source.indexOf('})', partializeStart);
  const partializeBlock = source.slice(partializeStart, partializeEnd);

  const transientFields = [
    'selectedFilmId',
    'isPlayerOpen',
    'isTerminalOpen',
    'isVHSCaseOpen',
    'isSitting',
    'isSceneReady',
    'tutorialStep',
    'pointerLockRequested',
  ];

  for (const field of transientFields) {
    assert.ok(
      !partializeBlock.includes(field),
      `partialize must NOT persist transient field "${field}" — it requires coherent 3D state`
    );
  }
});

test('MOBILE: store persistence name must be videoclub-storage', () => {
  const source = readText(path.join(ROOT, 'src/store/index.ts'));
  assert.ok(
    source.includes("name: 'videoclub-storage'"),
    'Zustand persist storage key must be "videoclub-storage"'
  );
});

// ===== Cross-cutting: No localhost/hardcoded URLs anywhere in frontend =====

test('CROSS: no hardcoded localhost URLs in API client', () => {
  const source = readText(path.join(ROOT, 'src/api/index.ts'));
  assert.ok(
    !source.includes('localhost'),
    'API client must not contain hardcoded localhost URLs'
  );
  assert.ok(
    !source.includes('127.0.0.1'),
    'API client must not contain hardcoded 127.0.0.1'
  );
});

test('CROSS: API_BASE must be empty string (same-origin)', () => {
  const source = readText(path.join(ROOT, 'src/api/index.ts'));
  assert.ok(
    source.includes("API_BASE = ''") || source.includes('API_BASE = ""'),
    'API_BASE must be empty string for same-origin requests'
  );
});
