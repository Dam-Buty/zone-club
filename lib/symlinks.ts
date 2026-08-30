import { mkdir, symlink, rm, access } from 'fs/promises';
import { join, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';

const MEDIA_FILMS_PATH = process.env.MEDIA_FILMS_PATH || '/media/films';
const SYMLINKS_PATH = process.env.SYMLINKS_PATH || '/media/public/symlinks';

export interface SymlinkPaths {
    uuid: string;
    vf: string | null;
    vo: string | null;
    subtitles: string | null;
    subtitles_en: string | null;
}

/**
 * Un chemin média écrit par le pipeline est relatif à MEDIA_FILMS_PATH
 * (« Titre (Année)/vo.mp4 ») et se consomme via un symlink servi par lighttpd.
 * Le seed de dev (`npm run seed`) y écrit à la place une URL absolue ou un
 * chemin racine : reconnaissable à sa forme, il part tel quel vers le <video>
 * sans symlink ni storage à héberger. Voir scripts/seed-films.ts.
 */
export function isDirectMediaUrl(value: string | null | undefined): value is string {
    return !!value && /^(https?:\/\/|\/)/.test(value);
}

export async function createRentalSymlinks(
    tmdbId: number,
    filePaths: {
        vf: string | null;
        vo: string | null;
        subtitles: {
            fr: string | null;
            en: string | null;
        };
    }
): Promise<SymlinkPaths> {
    const uuid = uuidv4();

    // Un média servi directement (URL de seed) n'a rien à lier : on le retire ici
    // plutôt que de garder un test par branche plus bas.
    const toLink = {
        vf: isDirectMediaUrl(filePaths.vf) ? null : filePaths.vf,
        vo: isDirectMediaUrl(filePaths.vo) ? null : filePaths.vo,
        subtitles: {
            fr: isDirectMediaUrl(filePaths.subtitles.fr) ? null : filePaths.subtitles.fr,
            en: isDirectMediaUrl(filePaths.subtitles.en) ? null : filePaths.subtitles.en,
        },
    };

    // Dev/seed reality: a film row can exist with no file_path yet (Radarr
    // hasn't downloaded, transcoder hasn't run). Returning a UUID stub lets
    // the rental row be created so the user can browse the rental flow —
    // the player will just have nothing to stream.
    if (!toLink.vf && !toLink.vo && !toLink.subtitles.fr && !toLink.subtitles.en) {
        return { uuid, vf: null, vo: null, subtitles: null, subtitles_en: null };
    }

    const symlinkDir = join(SYMLINKS_PATH, uuid);

    await mkdir(symlinkDir, { recursive: true });

    const result: SymlinkPaths = {
        uuid,
        vf: null,
        vo: null,
        subtitles: null,
        subtitles_en: null
    };

    if (toLink.vf) {
        const source = resolve(MEDIA_FILMS_PATH, toLink.vf);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid VF file path');
        }
        const target = join(symlinkDir, 'film_vf.mp4');
        await symlink(source, target);
        result.vf = `${uuid}/film_vf.mp4`;
    }

    if (toLink.vo) {
        const source = resolve(MEDIA_FILMS_PATH, toLink.vo);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid VO file path');
        }
        const target = join(symlinkDir, 'film_vo.mp4');
        await symlink(source, target);
        result.vo = `${uuid}/film_vo.mp4`;
    }

    if (toLink.subtitles.fr) {
        const source = resolve(MEDIA_FILMS_PATH, toLink.subtitles.fr);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid subtitles file path');
        }
        const target = join(symlinkDir, 'subs_fr.vtt');
        await symlink(source, target);
        result.subtitles = `${uuid}/subs_fr.vtt`;
    }

    if (toLink.subtitles.en) {
        const source = resolve(MEDIA_FILMS_PATH, toLink.subtitles.en);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid subtitles file path');
        }
        const target = join(symlinkDir, 'subs_en.vtt');
        await symlink(source, target);
        result.subtitles_en = `${uuid}/subs_en.vtt`;
    }

    return result;
}

export async function deleteRentalSymlinks(uuid: string): Promise<void> {
    const symlinkDir = join(SYMLINKS_PATH, uuid);

    try {
        await access(symlinkDir);
        await rm(symlinkDir, { recursive: true });
    } catch {
        // Directory doesn't exist, ignore
    }
}

export function getStreamingUrl(uuid: string, filename: string): string {
    const domain = process.env.DOMAIN || 'localhost';
    const storageSubdomain = process.env.STORAGE_SUBDOMAIN || 'zone-storage';

    return `https://${storageSubdomain}.${domain}/${uuid}/${filename}`;
}
