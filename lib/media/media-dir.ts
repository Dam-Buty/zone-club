import { dirname, basename } from 'path';

// Radarr range chaque film dans un dossier "Titre (Année)". On réutilise ce nom
// comme sous-dossier commun sous /media/films.
export function mediaDirFromMoviePath(moviePath: string): string {
    return basename(dirname(moviePath));
}

export function sanitizeDirName(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, '_');
}
