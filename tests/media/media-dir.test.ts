import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaDirFromMoviePath, sanitizeDirName } from '../../lib/media/media-dir.ts';

test('extrait le dossier Radarr du chemin du fichier film', () => {
    assert.equal(mediaDirFromMoviePath('/movies/Interstellar (2014)/Interstellar.2014.mkv'), 'Interstellar (2014)');
    assert.equal(mediaDirFromMoviePath('Blade Runner (1982)/br.mkv'), 'Blade Runner (1982)');
});

test('sanitize retire les caractères hostiles au FS mais garde () espaces', () => {
    assert.equal(sanitizeDirName('Amélie (2001)'), 'Amélie (2001)');
    assert.equal(sanitizeDirName('A/B:C*?'), 'A_B_C__');
});
