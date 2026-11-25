// Bandes-annonces de la borne, sans publicité (Rusmir, 17/11/2026 : « on veut la bande-annonce sans
// pub, point »). Le lecteur intégré de YouTube peut diffuser des publicités, et c'est la chaîne qui
// en décide, pas nous ; YouTube refuse en plus, depuis ce réseau, tout téléchargement (« Sign in to
// confirm you're not a bot », relevé le 17/11/2026 avec yt-dlp 2026.10.26). Allociné, lui, publie la
// bande-annonce de presque chaque film sorti en France, en VF le plus souvent, et l'héberge sur
// Dailymotion, qui répond sans demander de connexion. Le serveur la récupère une fois, au format
// « 480 », la garde, et la borne la joue dans son propre lecteur : aucune publicité possible.
//
// Ce module lit les pages et les playlists ; il est pur et sans import, pour être testé tel quel
// (tests/domain/trailers.test.mjs). Le téléchargement est dans lib/trailers.ts.

export interface AllocineVideo {
  /** Identifiant de la vidéo chez Allociné (cmedia). */
  media: number;
  /** Identifiant de la même vidéo chez Dailymotion. */
  dailymotion: string;
  title: string;
  /** Bande-annonce ou teaser (et non un extrait, une interview…). */
  trailer: boolean;
}

export type TrailerLang = 'vf' | 'vost' | 'vo';

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function isDailymotionId(id: unknown): id is string {
  return typeof id === 'string' && /^x[a-z0-9]{4,12}$/.test(id);
}

/** Vrai pour une adresse https chez Dailymotion ou son réseau de diffusion : le serveur ne va pas ailleurs. */
export function isDailymotionUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname;
  const within = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  return url.protocol === 'https:' && (within('dailymotion.com') || within('dmcdn.net'));
}

/** Les vidéos décrites par une page Allociné (attributs `data-model` des lecteurs), sans doublon. */
export function allocineVideos(html: string): AllocineVideo[] {
  const out = new Map<number, AllocineVideo>();
  for (const match of html.matchAll(/data-model="([^"]*)"/g)) {
    let model: unknown;
    try {
      model = JSON.parse(decodeEntities(match[1]));
    } catch {
      continue;
    }
    const videos = (model as { videos?: unknown }).videos;
    if (!Array.isArray(videos)) continue;
    for (const v of videos as { id?: unknown; idDailymotion?: unknown; title?: unknown; file_type?: unknown }[]) {
      if (typeof v.id !== 'number' || !isDailymotionId(v.idDailymotion) || typeof v.title !== 'string') continue;
      const title = decodeEntities(v.title);
      out.set(v.id, {
        media: v.id,
        dailymotion: v.idDailymotion,
        title,
        trailer: v.file_type === 'TRAILER' || /bande-annonce|teaser/i.test(title),
      });
    }
  }
  return [...out.values()];
}

/** Les vidéos citées par une page Allociné (liens `cmedia=`), dans l'ordre, sans doublon. */
export function allocineMediaIds(html: string): number[] {
  return [...new Set([...html.matchAll(/cmedia=(\d+)/g)].map((m) => Number(m[1])))];
}

/** Langue d'une bande-annonce d'après son titre Allociné (« … VF », « … VOST », « … VO STFR »). */
export function trailerLang(title: string): TrailerLang {
  if (/\bVOST|\bVO\s*STFR\b|\bSTFR\b/i.test(title)) return 'vost';
  if (/\bVFF?\b/.test(title)) return 'vf';
  return 'vo';
}

const LANG_ORDER: Record<TrailerLang, number> = { vf: 0, vost: 1, vo: 2 };

function score(video: AllocineVideo): number {
  const kind = /bande-annonce/i.test(video.title) ? 0 : /teaser/i.test(video.title) ? 1 : 2;
  return LANG_ORDER[trailerLang(video.title)] * 3 + kind;
}

/** La bande-annonce à garder : la VF d'abord, puis la VOST, puis la VO ; la bande-annonce avant le teaser. */
export function pickAllocineTrailer(videos: AllocineVideo[]): AllocineVideo | null {
  const trailers = videos.filter((v) => v.trailer);
  if (trailers.length === 0) return null;
  return trailers.reduce((best, v) => (score(v) < score(best) ? v : best));
}

/** Vrai quand la meilleure bande-annonce possible (une bande-annonce en VF) est déjà trouvée. */
export function hasVfTrailer(videos: AllocineVideo[]): boolean {
  return videos.some((v) => v.trailer && trailerLang(v.title) === 'vf' && /bande-annonce/i.test(v.title));
}

/**
 * Le flux à récupérer dans la playlist HLS de Dailymotion : le plus haut jusqu'à « 480 » (le nom
 * du flux, sinon sa hauteur), jamais au-dessus — Rusmir veut des fichiers légers. `null` s'il n'y en a pas.
 */
export function pickHlsVariant(master: string, baseUrl: string, maxQuality = 480): string | null {
  const lines = master.split(/\r?\n/).map((l) => l.trim());
  let best: { quality: number; bandwidth: number; uri: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = new Map<string, string>();
    for (const m of lines[i].slice('#EXT-X-STREAM-INF:'.length).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
      attrs.set(m[1], m[2].replace(/^"|"$/g, ''));
    }
    const uri = lines.slice(i + 1).find((l) => l !== '' && !l.startsWith('#'));
    if (!uri) continue;
    const name = Number(attrs.get('NAME'));
    const height = Number((attrs.get('RESOLUTION') ?? '').split('x')[1]);
    const quality = Number.isFinite(name) && name > 0 ? name : height;
    const bandwidth = Number(attrs.get('BANDWIDTH')) || 0;
    if (!(quality > 0) || quality > maxQuality) continue;
    if (!best || quality > best.quality || (quality === best.quality && bandwidth > best.bandwidth)) {
      best = { quality, bandwidth, uri };
    }
  }
  if (!best) return null;
  try {
    return new URL(best.uri, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Une plage d'octets demandée par un lecteur vidéo (`Range: bytes=…`), ou `null` si elle ne se sert pas. */
export function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
}
