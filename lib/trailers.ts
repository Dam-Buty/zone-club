import { spawn } from 'child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import {
    allocineMediaIds,
    allocineVideos,
    hasVfTrailer,
    isDailymotionUrl,
    pickAllocineTrailer,
    pickHlsVariant,
    trailerLang,
    type TrailerLang,
} from './trailer-source';

// Bandes-annonces de la borne, sans publicité : récupérées une fois chez Allociné (hébergées sur
// Dailymotion) au format « 480 », gardées sur le disque, servies par /api/films/[tmdbId]/trailer et
// jouées par le lecteur de la borne. Voir lib/trailer-source.ts pour le pourquoi.
//
// Une seule récupération à la fois (file d'attente) : chacune interroge Wikidata, Allociné et
// Dailymotion, puis lance ffmpeg. Un échec est retenu 24 h pour ne pas réessayer en boucle.

/**
 * Où sont gardées les bandes-annonces. Pas sous .next : `npm run deploy` l'efface, et le serveur de
 * production tourne depuis .next/standalone. À côté des films par défaut, sinon dans le dossier courant.
 */
export const TRAILER_DIR =
    process.env.TRAILER_CACHE_DIR ||
    (process.env.MEDIA_FILMS_PATH ? join(process.env.MEDIA_FILMS_PATH, '.bandes-annonces') : join(process.cwd(), '.trailer-cache'));

const RETRY_AFTER_MS = 24 * 3600 * 1000;
const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000;
/** Pages de vidéos Allociné lues au plus pour trouver une VF (Get Out en cite deux). */
const MAX_ALLOCINE_PAGES = 6;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const WIKIDATA_UA = 'zone-club/1.0 (bandes-annonces de la borne)';

export type TrailerStatus = { state: 'ready'; lang: TrailerLang } | { state: 'preparing' } | { state: 'none' } | { state: 'failed' };

type TrailerMeta =
    | { state: 'ready'; lang: TrailerLang; title: string; dailymotion: string; bytes: number; at: number }
    | { state: 'none' | 'failed'; reason: string; at: number };

export function trailerFile(tmdbId: number): string {
    return join(TRAILER_DIR, `${tmdbId}.mp4`);
}

function metaFile(tmdbId: number): string {
    return join(TRAILER_DIR, `${tmdbId}.json`);
}

async function readMeta(tmdbId: number): Promise<TrailerMeta | null> {
    try {
        return JSON.parse(await readFile(metaFile(tmdbId), 'utf8')) as TrailerMeta;
    } catch {
        return null;
    }
}

async function writeMeta(tmdbId: number, meta: TrailerMeta): Promise<void> {
    await mkdir(TRAILER_DIR, { recursive: true });
    await writeFile(metaFile(tmdbId), JSON.stringify(meta));
}

const inflight = new Map<number, Promise<void>>();
let queue: Promise<void> = Promise.resolve();

/** Où en est la bande-annonce d'un film ; lance sa récupération si elle n'est ni prête ni en échec récent. */
export async function trailerStatus(tmdbId: number): Promise<TrailerStatus> {
    const meta = await readMeta(tmdbId);
    if (meta?.state === 'ready') {
        try {
            await stat(trailerFile(tmdbId));
            return { state: 'ready', lang: meta.lang };
        } catch {
            // Fichier disparu : on le récupère de nouveau.
        }
    }
    if (inflight.has(tmdbId)) return { state: 'preparing' };
    if (meta && meta.state !== 'ready' && Date.now() - meta.at < RETRY_AFTER_MS) return { state: meta.state };
    const job = queue
        .then(() => fetchTrailer(tmdbId))
        .catch(async (error: unknown) => {
            console.error('[bande-annonce] échec pour', tmdbId, error);
            await writeMeta(tmdbId, { state: 'failed', reason: String((error as Error)?.message ?? error).slice(0, 300), at: Date.now() }).catch(() => {});
        })
        .finally(() => inflight.delete(tmdbId));
    queue = job;
    inflight.set(tmdbId, job);
    return { state: 'preparing' };
}

async function fetchText(url: string): Promise<string> {
    const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${new URL(url).hostname}`);
    return response.text();
}

/** L'identifiant Allociné du film, d'après Wikidata (propriétés P4947 TMDB → P1265 AlloCiné). */
async function allocineIdFor(tmdbId: number): Promise<string | null> {
    const query = `SELECT ?a WHERE { ?f wdt:P4947 "${tmdbId}" ; wdt:P1265 ?a . } LIMIT 1`;
    const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': WIKIDATA_UA },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
    const json = (await response.json()) as { results?: { bindings?: { a?: { value?: string } }[] } };
    const id = json.results?.bindings?.[0]?.a?.value;
    return id && /^\d+$/.test(id) ? id : null;
}

async function fetchTrailer(tmdbId: number): Promise<void> {
    const allocine = await allocineIdFor(tmdbId);
    if (!allocine) {
        await writeMeta(tmdbId, { state: 'none', reason: 'pas de fiche Allociné connue de Wikidata', at: Date.now() });
        return;
    }

    // La page du film décrit sa vidéo principale (souvent la VO) et cite les autres : on les lit
    // jusqu'à trouver une bande-annonce en VF.
    const filmPage = await fetchText(`https://www.allocine.fr/film/fichefilm_gen_cfilm=${allocine}.html`);
    const videos = allocineVideos(filmPage);
    for (const media of allocineMediaIds(filmPage).slice(0, MAX_ALLOCINE_PAGES)) {
        if (hasVfTrailer(videos)) break;
        if (videos.some((v) => v.media === media)) continue;
        await new Promise((resolve) => setTimeout(resolve, 400));
        try {
            const page = await fetchText(`https://www.allocine.fr/video/player_gen_cmedia=${media}&cfilm=${allocine}.html`);
            for (const v of allocineVideos(page)) if (!videos.some((w) => w.media === v.media)) videos.push(v);
        } catch {
            // Page de vidéo manquante : on passe à la suivante.
        }
    }
    const best = pickAllocineTrailer(videos);
    if (!best) {
        await writeMeta(tmdbId, { state: 'none', reason: 'pas de bande-annonce sur Allociné', at: Date.now() });
        return;
    }

    const metadata = JSON.parse(await fetchText(`https://www.dailymotion.com/player/metadata/video/${best.dailymotion}`)) as {
        qualities?: { auto?: { type?: string; url?: string }[] };
    };
    const manifest = metadata.qualities?.auto?.find((q) => q.type === 'application/x-mpegURL')?.url;
    if (typeof manifest !== 'string' || !isDailymotionUrl(manifest)) throw new Error('flux Dailymotion introuvable');
    const variant = pickHlsVariant(await fetchText(manifest), manifest);
    if (!variant || !isDailymotionUrl(variant)) throw new Error('pas de flux « 480 » chez Dailymotion');

    await mkdir(TRAILER_DIR, { recursive: true });
    const part = `${trailerFile(tmdbId)}.part`;
    try {
        await remux(variant, part);
        const { size } = await stat(part);
        if (size < 100_000) throw new Error(`fichier trop petit (${size} octets)`);
        await rename(part, trailerFile(tmdbId));
        await writeMeta(tmdbId, { state: 'ready', lang: trailerLang(best.title), title: best.title, dailymotion: best.dailymotion, bytes: size, at: Date.now() });
    } finally {
        await rm(part, { force: true });
    }
}

/** Copie du flux HLS dans un MP4 lisible dès le début (`faststart`), sans réencodage. */
function remux(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(
            'ffmpeg',
            ['-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'https,tls,tcp,crypto,hls', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output],
            { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        ffmpeg.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-2000);
        });
        const timer = setTimeout(() => ffmpeg.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
        ffmpeg.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        ffmpeg.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg ${code ?? 'tué'} : ${stderr.trim().split('\n').pop() ?? ''}`));
        });
    });
}
