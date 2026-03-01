/**
 * Collection Report — Rapport sur l'état de la collection de films
 *
 * Usage:
 *   npx tsx scripts/collection-report.ts
 *
 * Catégories :
 *   1. Pas téléchargés — en base mais aucun fichier (ni VO ni VF)
 *   2. Partiels — uniquement VO ou uniquement VF
 *   3. Complets — VO + VF disponibles
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || join(__dirname, '..', 'data', 'zone.db');

const db = new Database(dbPath, { readonly: true });

interface Film {
  id: number;
  tmdb_id: number;
  title: string;
  title_original: string | null;
  release_year: number | null;
  aisle: string | null;
  is_nouveaute: number;
  is_available: number;
  file_path_vo: string | null;
  file_path_vf: string | null;
  radarr_vo_id: number | null;
  radarr_vf_id: number | null;
}

const allFilms = db.prepare(`
  SELECT id, tmdb_id, title, title_original, release_year, aisle,
         is_nouveaute, is_available, file_path_vo, file_path_vf,
         radarr_vo_id, radarr_vf_id
  FROM films
  ORDER BY title
`).all() as Film[];

const notDownloaded: Film[] = [];
const voOnly: Film[] = [];
const vfOnly: Film[] = [];
const complete: Film[] = [];

for (const film of allFilms) {
  const hasVO = !!film.file_path_vo;
  const hasVF = !!film.file_path_vf;

  if (!hasVO && !hasVF) {
    notDownloaded.push(film);
  } else if (hasVO && !hasVF) {
    voOnly.push(film);
  } else if (!hasVO && hasVF) {
    vfOnly.push(film);
  } else {
    complete.push(film);
  }
}

// --- Helpers ---

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function filmLine(f: Film): string {
  const year = f.release_year ? ` (${f.release_year})` : '';
  const aisle = f.aisle ? `  [${f.aisle}]` : `  ${DIM}[pas d'allée]${RESET}`;
  const flags: string[] = [];
  if (f.is_nouveaute) flags.push('NEW');
  if (f.is_available) flags.push('DISPO');
  const radarr: string[] = [];
  if (f.radarr_vo_id) radarr.push('VO');
  if (f.radarr_vf_id) radarr.push('VF');
  const radarrStr = radarr.length ? `  radarr:${radarr.join('+')}` : '';

  return `  ${DIM}#${f.tmdb_id}${RESET} ${f.title}${year}${aisle}${flags.length ? `  ${MAGENTA}${flags.join(' ')}${RESET}` : ''}${radarrStr}`;
}

function section(color: string, emoji: string, title: string, films: Film[]) {
  console.log(`\n${color}${BOLD}${emoji} ${title} (${films.length})${RESET}`);
  if (films.length === 0) {
    console.log(`  ${DIM}(aucun)${RESET}`);
  } else {
    for (const f of films) {
      console.log(filmLine(f));
    }
  }
}

// --- Output ---

console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║       RAPPORT COLLECTION ZONE CLUB       ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}`);
console.log(`${DIM}  ${allFilms.length} films en base${RESET}`);

section(RED, '⬇', 'PAS TÉLÉCHARGÉS — aucun fichier', notDownloaded);
section(YELLOW, '⚠', 'PARTIELS — VO uniquement', voOnly);
section(YELLOW, '⚠', 'PARTIELS — VF uniquement', vfOnly);
section(GREEN, '✓', 'COMPLETS — VO + VF', complete);

// --- Summary ---

console.log(`\n${BOLD}${CYAN}── Résumé ──${RESET}`);
console.log(`  Total en base :     ${BOLD}${allFilms.length}${RESET}`);
console.log(`  ${RED}Pas téléchargés : ${BOLD}${notDownloaded.length}${RESET}  ${DIM}(${pct(notDownloaded.length)})${RESET}`);
console.log(`  ${YELLOW}Partiels :        ${BOLD}${voOnly.length + vfOnly.length}${RESET}  ${DIM}(${pct(voOnly.length + vfOnly.length)})${RESET}  ${DIM}[VO seul: ${voOnly.length}, VF seul: ${vfOnly.length}]${RESET}`);
console.log(`  ${GREEN}Complets :        ${BOLD}${complete.length}${RESET}  ${DIM}(${pct(complete.length)})${RESET}`);

// Aisle breakdown
const aisles = new Map<string, { total: number; complete: number; partial: number; none: number }>();
for (const f of allFilms) {
  const key = f.aisle || '(sans allée)';
  const entry = aisles.get(key) || { total: 0, complete: 0, partial: 0, none: 0 };
  entry.total++;
  const hasVO = !!f.file_path_vo;
  const hasVF = !!f.file_path_vf;
  if (hasVO && hasVF) entry.complete++;
  else if (hasVO || hasVF) entry.partial++;
  else entry.none++;
  aisles.set(key, entry);
}

console.log(`\n${BOLD}${CYAN}── Par allée ──${RESET}`);
for (const [aisle, stats] of [...aisles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const bar = `${GREEN}${'█'.repeat(stats.complete)}${YELLOW}${'█'.repeat(stats.partial)}${RED}${'█'.repeat(stats.none)}${RESET}`;
  console.log(`  ${BOLD}${aisle.padEnd(14)}${RESET} ${String(stats.total).padStart(3)} films  ${bar}  ${GREEN}${stats.complete}✓${RESET} ${YELLOW}${stats.partial}⚠${RESET} ${RED}${stats.none}⬇${RESET}`);
}

console.log();

db.close();

function pct(n: number): string {
  if (allFilms.length === 0) return '0%';
  return `${Math.round((n / allFilms.length) * 100)}%`;
}
