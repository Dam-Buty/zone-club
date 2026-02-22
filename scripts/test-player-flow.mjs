#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, rm, symlink, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const PORT = Number(process.env.PLAYER_FLOW_PORT || 3317);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP_ROOT = path.join(ROOT, '.tmp', `player-flow-${Date.now()}`);
const DB_PATH = path.join(TMP_ROOT, 'zone.test.db');
const VF_MEDIA_PATH = path.join(TMP_ROOT, 'media-vf');
const VO_MEDIA_PATH = path.join(TMP_ROOT, 'media-vo');
const SYMLINKS_PATH = path.join(TMP_ROOT, 'symlinks');
const RELATIVE_VF_FILE = 'die-hard-test.web.mp4';

function resolveRootVideoPath() {
  const candidates = [
    process.env.ROOT_VIDEO_PATH,
    path.join(ROOT, 'Die.Hard.BluRay.1080p.x264.5.1.Judas.mp4'),
    path.join(ROOT, 'public', 'videoclubvideo.mp4'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Aucune video trouvee. Definis ROOT_VIDEO_PATH ou place un fichier a ${path.join(ROOT, 'Die.Hard.BluRay.1080p.x264.5.1.Judas.mp4')}`
  );
}

async function waitForServer(url, timeoutMs, onTimeoutDump) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  onTimeoutDump();
  throw new Error(`Serveur indisponible apres ${timeoutMs}ms sur ${url}`);
}

function parseSetCookie(rawSetCookie) {
  if (!rawSetCookie) return null;
  return rawSetCookie.split(';')[0];
}

async function main() {
  const rootVideoPath = resolveRootVideoPath();
  const rootVideoStat = await stat(rootVideoPath);

  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(VF_MEDIA_PATH, { recursive: true });
  await mkdir(VO_MEDIA_PATH, { recursive: true });
  await mkdir(SYMLINKS_PATH, { recursive: true });

  const vfSourcePath = path.join(VF_MEDIA_PATH, RELATIVE_VF_FILE);
  await symlink(rootVideoPath, vfSourcePath);

  const db = new Database(DB_PATH);
  const schema = readFileSync(path.join(ROOT, 'lib', 'schema.sql'), 'utf-8');
  db.exec(schema);

  const insertedFilm = db.prepare(`
    INSERT INTO films (
      tmdb_id, title, is_available, aisle, is_nouveaute,
      file_path_vf_transcoded
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(990001, 'Die Hard Test Flow', 1, 'action', 0, RELATIVE_VF_FILE);
  const filmId = Number(insertedFilm.lastInsertRowid);

  db.close();

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_PATH: DB_PATH,
    MEDIA_FILMS_VF_PATH: VF_MEDIA_PATH,
    MEDIA_FILMS_VO_PATH: VO_MEDIA_PATH,
    SYMLINKS_PATH,
    HMAC_SECRET: process.env.HMAC_SECRET || 'player-flow-test-secret',
    DOMAIN: process.env.DOMAIN || 'example.test',
    SUBDOMAIN: process.env.SUBDOMAIN || 'zone-app',
    STORAGE_SUBDOMAIN: process.env.STORAGE_SUBDOMAIN || 'zone-storage',
    PORT: String(PORT),
  };

  let outputBuffer = '';
  const server = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pushOutput = (chunk) => {
    outputBuffer += chunk.toString();
    if (outputBuffer.length > 16000) {
      outputBuffer = outputBuffer.slice(-16000);
    }
  };
  server.stdout.on('data', pushOutput);
  server.stderr.on('data', pushOutput);

  const stopServer = async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (server.exitCode === null) {
        server.kill('SIGKILL');
      }
    }
  };

  try {
    await waitForServer(`${BASE}/api/films`, 90000, () => {
      console.error('\n--- SERVER OUTPUT (tail) ---\n');
      console.error(outputBuffer);
      console.error('\n--- END SERVER OUTPUT ---\n');
    });

    let cookie = null;

    const api = async (endpoint, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (cookie) headers.set('Cookie', cookie);

      const res = await fetch(`${BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const setCookie = parseSetCookie(res.headers.get('set-cookie'));
      if (setCookie) cookie = setCookie;
      return res;
    };

    const username = `player_flow_${Date.now()}`;
    const password = 'testpass1234';

    const registerRes = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    assert.equal(registerRes.status, 200, 'Inscription utilisateur echouee');

    const rentRes = await api(`/api/rentals/${filmId}`, { method: 'POST' });
    assert.equal(rentRes.status, 200, 'Location echouee');
    const rentData = await rentRes.json();
    assert.ok(rentData?.rental, 'Location: payload rental manquant');

    const emporterRes = await api(`/api/rentals/${filmId}/viewing-mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'emporter' }),
    });
    assert.equal(emporterRes.status, 200, 'Passage en mode emporter echoue');
    const emporterData = await emporterRes.json();
    assert.equal(emporterData?.rental?.viewing_mode, 'emporter');

    const downloadRes = await api(`/api/rentals/${filmId}/download`);
    assert.equal(downloadRes.status, 200, 'Download emporter echoue');
    assert.equal(downloadRes.headers.get('content-type'), 'video/mp4');
    assert.ok(
      (downloadRes.headers.get('content-disposition') || '').includes('attachment'),
      'Le header content-disposition doit forcer le telechargement'
    );

    const downloadedLength = Number(downloadRes.headers.get('content-length') || 0);
    assert.equal(downloadedLength, rootVideoStat.size, 'Taille telechargee incorrecte');

    const reader = downloadRes.body?.getReader();
    assert.ok(reader, 'Body stream introuvable sur la reponse download');
    const firstChunk = await reader.read();
    assert.ok(firstChunk.value && firstChunk.value.length > 0, 'Le stream de download est vide');
    await reader.cancel();

    const surPlaceRes = await api(`/api/rentals/${filmId}/viewing-mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'sur_place' }),
    });
    assert.equal(surPlaceRes.status, 200, 'Passage en mode sur_place echoue');
    const surPlaceData = await surPlaceRes.json();
    assert.equal(surPlaceData?.rental?.viewing_mode, 'sur_place');

    const tvSource = readFileSync(path.join(ROOT, 'src/components/interior/InteractiveTVDisplay.tsx'), 'utf-8');
    assert.ok(
      tvSource.includes('openPlayer(filmId)'),
      'Flux TV assis: openPlayer(filmId) absent'
    );
    assert.ok(
      tvSource.includes('playVideo(selected.rental.filmId)'),
      'Flux TV assis: doit lancer via filmId et player global'
    );
    assert.ok(
      !tvSource.includes('playVideo(selected.rental.videoUrl)'),
      'Flux TV assis: ancien lancement direct videoUrl encore present'
    );

    const overlaySource = readFileSync(path.join(ROOT, 'src/components/videoclub/VHSCaseOverlay.tsx'), 'utf-8');
    assert.ok(
      overlaySource.includes('`/api/rentals/${film.id}/download`'),
      'Flux a emporter: endpoint download non branche dans la fiche VHS'
    );

    console.log('\n[OK] Player flow test termine');
    console.log(`[OK] Film de test: ${rootVideoPath}`);
    console.log(`[OK] Taille verifiee: ${downloadedLength} octets`);
    console.log(`[OK] filmId interne teste: ${filmId}`);
  } finally {
    await stopServer();
    await rm(TMP_ROOT, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n[FAIL] test-player-flow');
  console.error(err);
  process.exit(1);
});
