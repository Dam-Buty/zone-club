import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Une version marquée illisible (`npm run media:check -- --mark`) dans une vraie location : lib/rentals.ts exécuté sur
// une base en mémoire, avec des fichiers et des liens dans un dossier temporaire
// (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 6, et correctifs A et B de la tâche 9).
// Les liens d'une location couvrent tous les fichiers transcodés ; l'adresse d'une version marquée est masquée par le
// drapeau, relu à chaque lecture — une version démarquée pendant la location se lance aussitôt —, et le
// téléchargement ne sert jamais une version marquée.

// Node charge les .ts de lib/ tels quels, mais pas leurs imports relatifs sans extension : ce crochet essaie `.ts` puis
// `/index.ts`. lib/radarr.ts (propriétés de paramètre de constructeur) ne se charge pas sans transformation : il est
// remplacé par un module dont rien ici ne se sert.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './radarr' && context.parentURL?.endsWith('/lib/films.ts')) {
      return { url: 'data:text/javascript,export const addMovie = () => { throw new Error("Radarr hors test"); };', shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) throw err;
      for (const suffix of ['.ts', '/index.ts']) {
        try { return nextResolve(specifier + suffix, context); } catch { /* suivant */ }
      }
      throw err;
    }
  },
});

const TMP = mkdtempSync(path.join(tmpdir(), 'zone-locations-'));
const MEDIA = path.join(TMP, 'films');
const LINKS = path.join(TMP, 'liens');
mkdirSync(path.join(MEDIA, 'Film (2001)'), { recursive: true });
mkdirSync(LINKS);
writeFileSync(path.join(MEDIA, 'Film (2001)', 'vf.mp4'), 'vf');
writeFileSync(path.join(MEDIA, 'Film (2001)', 'vo.mp4'), 'vo');
// Lus au chargement des modules : posés avant l'import.
Object.assign(process.env, { DATABASE_PATH: ':memory:', MEDIA_FILMS_PATH: MEDIA, SYMLINKS_PATH: LINKS });
delete process.env.FORCED_RENTAL_VIDEO_URL;
delete process.env.FORCED_RENTAL_FILE_PATH;
const R = await import('../../lib/rentals.ts');
const { db } = await import('../../lib/db.ts');
after(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
const user = (credits = 5) => Number(db.prepare(
  "INSERT INTO users (username, password_hash, recovery_phrase_hash, credits) VALUES (?, 'x', 'y', ?)",
).run(`client-${++seq}`, credits).lastInsertRowid);
const film = ({ vf = 0, vo = 0 } = {}) => Number(db.prepare(`
  INSERT INTO films (tmdb_id, title, is_available, runtime, release_year,
                     file_path_vf_transcoded, file_path_vo_transcoded, vf_unplayable, vo_unplayable)
  VALUES (?, ?, 1, 156, 1968, 'Film (2001)/vf.mp4', 'Film (2001)/vo.mp4', ?, ?)
`).run(1000 + ++seq, `Film ${seq}`, vf, vo).lastInsertRowid);
const mark = (id, vf, vo) => db.prepare('UPDATE films SET vf_unplayable = ?, vo_unplayable = ? WHERE id = ?').run(vf, vo, id);
const credits = (u) => db.prepare('SELECT credits FROM users WHERE id = ?').get(u).credits;
// Les adresses sont le secret d'une location : seulement des booléens dans les messages.
const addressOf = (url, file) => typeof url === 'string' && url.endsWith(`/${file}`);

test('LOCATION: louée pendant que la VF est marquée — les deux fichiers sont liés, seule la VO a une adresse', async () => {
  const u = user();
  const f = film({ vf: 1 });
  const rental = await R.rentFilm(u, f);
  assert.equal(rental.streaming_urls.vf, null, 'VF marquée : adresse nulle');
  assert.ok(addressOf(rental.streaming_urls.vo, 'film_vo.mp4'), 'VO : son adresse');
  assert.deepEqual(readdirSync(path.join(LINKS, rental.symlink_uuid)).sort(), ['film_vf.mp4', 'film_vo.mp4']);
});

test('LOCATION: une VF démarquée pendant la location se lance aussitôt — adresse rendue, lien déjà là', async () => {
  const u = user();
  const f = film({ vf: 1 });
  await R.rentFilm(u, f);
  mark(f, 0, 0);
  const [active] = R.getUserActiveRentals(u);
  assert.ok(addressOf(active.streaming_urls.vf, 'film_vf.mp4'), 'getUserActiveRentals rend l\'adresse VF');
  assert.ok(existsSync(path.join(LINKS, active.symlink_uuid, 'film_vf.mp4')), 'le lien mène au fichier');
  assert.ok(addressOf(R.getFilmRentalStatus(f, u).rental?.streaming_urls.vf, 'film_vf.mp4'), 'la fiche (enrichRental) aussi');
  // Marquée de nouveau : l'adresse disparaît, sans toucher aux liens.
  mark(f, 1, 0);
  assert.equal(R.getUserActiveRentals(u)[0].streaming_urls.vf, null);
  assert.ok(existsSync(path.join(LINKS, active.symlink_uuid, 'film_vf.mp4')));
});

test('TÉLÉCHARGEMENT: une version marquée n\'est jamais servie, même quand son lien existe', async () => {
  const u = user();
  const f = film({ vf: 1 });
  await R.rentFilm(u, f);
  let source = await R.getRentalDownloadSource(u, f);
  assert.equal(path.basename(source.absolutePath), 'film_vo.mp4', 'VF marquée : la VO');
  assert.ok(source.filename.endsWith('-VO.mp4'));
  mark(f, 0, 0);
  source = await R.getRentalDownloadSource(u, f);
  assert.equal(path.basename(source.absolutePath), 'film_vf.mp4', 'démarquée : la VF d\'abord, comme avant');
  assert.ok(source.filename.endsWith('-VF.mp4'));
  mark(f, 0, 1);
  assert.equal(path.basename((await R.getRentalDownloadSource(u, f)).absolutePath), 'film_vf.mp4', 'VO marquée : la VF');
  mark(f, 1, 1);
  await assert.rejects(R.getRentalDownloadSource(u, f), { message: 'Aucun fichier vidéo disponible pour cette location' });
});

test('LOCATION: sans version lisible, refus avant le stock et les crédits — ni débit, ni location, ni lien', async () => {
  const f = film();
  db.prepare('UPDATE films SET stock = 1 WHERE id = ?').run(f);
  await R.rentFilm(user(), f); // un autre visiteur prend la seule copie
  mark(f, 1, 1);
  const u = user(0);
  const linksBefore = readdirSync(LINKS).length;
  await assert.rejects(R.rentFilm(u, f), { message: "Ce film n'a aucune version lisible pour le moment" });
  assert.equal(credits(u), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rentals WHERE user_id = ?').get(u).n, 0);
  assert.equal(readdirSync(LINKS).length, linksBefore);
  // Le même film, une version démarquée : le refus suivant est celui du stock (l'ordre des contrôles est inchangé).
  mark(f, 0, 1);
  await assert.rejects(R.rentFilm(u, f), /Toutes les copies sont louées/);
});
