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

    // Dev/seed reality: a film row can exist with no file_path yet (Radarr
    // hasn't downloaded, transcoder hasn't run). Returning a UUID stub lets
    // the rental row be created so the user can browse the rental flow —
    // the player will just have nothing to stream.
    if (!filePaths.vf && !filePaths.vo && !filePaths.subtitles.fr && !filePaths.subtitles.en) {
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

    if (filePaths.vf) {
        const source = resolve(MEDIA_FILMS_PATH, filePaths.vf);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid VF file path');
        }
        const target = join(symlinkDir, 'film_vf.mp4');
        await symlink(source, target);
        result.vf = `${uuid}/film_vf.mp4`;
    }

    if (filePaths.vo) {
        const source = resolve(MEDIA_FILMS_PATH, filePaths.vo);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid VO file path');
        }
        const target = join(symlinkDir, 'film_vo.mp4');
        await symlink(source, target);
        result.vo = `${uuid}/film_vo.mp4`;
    }

    if (filePaths.subtitles.fr) {
        const source = resolve(MEDIA_FILMS_PATH, filePaths.subtitles.fr);
        if (!source.startsWith(resolve(MEDIA_FILMS_PATH))) {
            throw new Error('Invalid subtitles file path');
        }
        const target = join(symlinkDir, 'subs_fr.vtt');
        await symlink(source, target);
        result.subtitles = `${uuid}/subs_fr.vtt`;
    }

    if (filePaths.subtitles.en) {
        const source = resolve(MEDIA_FILMS_PATH, filePaths.subtitles.en);
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
