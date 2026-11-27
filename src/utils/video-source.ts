// Les films de la borne (approche de la devanture, distribution de la K7) existent en deux codages, au même niveau de
// qualité : H.264 pour tous, AV1 pour les navigateurs qui le lisent sans peine — de 31 à 54 % plus léger selon le film
// (Rusmir, 26/11/2026 : « ceux qui sont compatibles AV1 reçoivent la vidéo AV1, les autres la vidéo H264 »). La fabrique
// les livre ensemble (tools/devanture-borne/encodage.py) et écrit dans les données la chaîne `codecs` exacte de l'AV1.
//
// On demande au navigateur (MediaCapabilities) s'il lit CE fichier, à sa taille et à son débit, sans à-coups : Safari ne
// l'annonce que sur les appareils qui ont un décodeur AV1 dans leur puce (iPhone 15 Pro et après, Mac M3 et après), Chrome
// et Firefox partout où le décodage logiciel suffit. Dans le doute, H.264 : il se lit partout.
// Aucun import de valeur : testé tel quel par tests/domain/video-source.test.mjs.

/** La version AV1 d'un film, telle que la fabrique la décrit. */
export type Av1Version = { src: string; codecs: string; octets: number };

/** Un film à télécharger : son fichier H.264, sa version AV1 s'il en a une, et de quoi la décrire au navigateur. */
export type FilmFiles = {
  src: string;
  width: number;
  height: number;
  framerate: number;
  durationMs: number;
  av1?: Av1Version;
};

type Capabilities = { decodingInfo: MediaCapabilities['decodingInfo'] } | undefined;
type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; blob: () => Promise<Blob> }>;

const defaultCapabilities = (): Capabilities =>
  typeof navigator === 'undefined' ? undefined : (navigator.mediaCapabilities as Capabilities);

/** Vrai si le navigateur annonce lire la version AV1 de ce film, et sans à-coups. API absente, refus, erreur : faux. */
export async function readsAv1(film: FilmFiles, capabilities: Capabilities = defaultCapabilities()): Promise<boolean> {
  if (!film.av1 || !capabilities) return false;
  try {
    const info = await capabilities.decodingInfo({
      type: 'file',
      video: {
        contentType: `video/mp4; codecs="${film.av1.codecs}"`,
        width: film.width,
        height: film.height,
        framerate: film.framerate,
        bitrate: Math.round((film.av1.octets * 8) / (film.durationMs / 1000)),
      },
    });
    return info.supported && info.smooth;
  } catch {
    return false;
  }
}

async function download(url: string, fetcher: Fetcher): Promise<Blob> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  return response.blob();
}

/**
 * Le film entier, en mémoire : la version AV1 si le navigateur la lit, le H.264 sinon — un seul des deux fichiers
 * est téléchargé. Si l'AV1 ne vient pas (absent, réseau), on se rabat sur le H.264 ; si le H.264 manque, c'est une
 * erreur, et l'appelant fait sans film.
 */
export async function fetchFilm(
  film: FilmFiles,
  capabilities: Capabilities = defaultCapabilities(),
  fetcher: Fetcher = (url) => fetch(url),
): Promise<Blob> {
  if (film.av1 && (await readsAv1(film, capabilities))) {
    try {
      return await download(film.av1.src, fetcher);
    } catch {
      // Le H.264, ci-dessous.
    }
  }
  return download(film.src, fetcher);
}
