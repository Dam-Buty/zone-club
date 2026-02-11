import { mkdir, symlink, rm, access } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const MEDIA_FILMS_VO_PATH = process.env.MEDIA_FILMS_VO_PATH || '/media/films-vo';
const MEDIA_FILMS_VF_PATH = process.env.MEDIA_FILMS_VF_PATH || '/media/films-vf';
const SYMLINKS_PATH = process.env.SYMLINKS_PATH || '/media/public/symlinks';

export interface SymlinkPaths {
    uuid: string;
    vf: string | null;
    vo: string | null;
    subtitles: string | null;
}

export async function createRentalSymlinks(
    tmdbId: number,
    filePaths: {
        vf: string | null;
        vo: string | null;
        subtitles: string | null;
    }
): Promise<SymlinkPaths> {
    const uuid = uuidv4();
    const symlinkDir = join(SYMLINKS_PATH, uuid);

    await mkdir(symlinkDir, { recursive: true });

    const result: SymlinkPaths = {
        uuid,
        vf: null,
        vo: null,
        subtitles: null
    };

    if (filePaths.vf) {
        const source = join(MEDIA_FILMS_VF_PATH, filePaths.vf);
        const target = join(symlinkDir, 'film_vf.mp4');
        await symlink(source, target);
        result.vf = `${uuid}/film_vf.mp4`;
    }

    if (filePaths.vo) {
        const source = join(MEDIA_FILMS_VO_PATH, filePaths.vo);
        const target = join(symlinkDir, 'film_vo.mp4');
        await symlink(source, target);
        result.vo = `${uuid}/film_vo.mp4`;
    }

    if (filePaths.subtitles) {
        const source = join(MEDIA_FILMS_VO_PATH, filePaths.subtitles);
        const target = join(symlinkDir, 'subs_fr.vtt');
        await symlink(source, target);
        result.subtitles = `${uuid}/subs_fr.vtt`;
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
