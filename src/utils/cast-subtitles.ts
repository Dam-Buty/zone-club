/**
 * Pistes de sous-titres envoyées au Chromecast.
 *
 * Le receiver ne reçoit que le MP4 : les `<track>` du `<video>` local ne
 * traversent pas le réseau. On déclare donc les WebVTT en side-load dans le
 * `MediaInfo` (voir `useGoogleCast.castMedia`). Le receiver par défaut ne gère
 * que les pistes texte, et une seule active à la fois.
 */

export type CastSubtitleLanguage = 'fr' | 'en';

export interface CastSubtitleTrack {
    /** ID stable dans le MediaInfo (fr = 1, en = 2). */
    id: number;
    url: string;
    language: CastSubtitleLanguage;
    label: string;
}

interface StreamingUrlsLike {
    subtitles?: string | null;
    subtitles_en?: string | null;
}

const CAST_SUBTITLE_SOURCES = [
    { id: 1, key: 'subtitles', language: 'fr', label: 'Français' },
    { id: 2, key: 'subtitles_en', language: 'en', label: 'English' },
] as const satisfies ReadonlyArray<{
    id: number;
    key: keyof StreamingUrlsLike;
    language: CastSubtitleLanguage;
    label: string;
}>;

/**
 * Une URL relative (`/seed-media/...`) est résolue par le navigateur, pas par le
 * Chromecast : elle n'est pas joignable depuis le receiver. On ne déclare donc
 * que les URLs absolues, celles servies par le storage. Bénéfice secondaire : en
 * mode seed, aucune piste n'est déclarée, donc la vidéo archive.org (sans
 * `Access-Control-Allow-Origin` sur sa réponse finale) continue de se caster.
 */
export function buildCastSubtitleTracks(
    streamingUrls: StreamingUrlsLike | null | undefined,
): CastSubtitleTrack[] {
    if (!streamingUrls) return [];

    return CAST_SUBTITLE_SOURCES.flatMap(({ id, key, language, label }) => {
        const url = streamingUrls[key];
        if (!url || !/^https?:\/\//i.test(url)) return [];
        return [{ id, url, language, label }];
    });
}

/** ID à activer au chargement (ou à basculer pendant le cast). */
export function activeSubtitleId(
    tracks: CastSubtitleTrack[],
    subtitleTrack: 'off' | CastSubtitleLanguage,
): number | null {
    if (subtitleTrack === 'off') return null;
    return tracks.find(track => track.language === subtitleTrack)?.id ?? null;
}
