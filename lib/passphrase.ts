import { randomInt } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const plats: string[] = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'dictionaries', 'plats.json'), 'utf-8'));
const origines: string[] = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'dictionaries', 'origines.json'), 'utf-8'));
const qualificatifs: string[] = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'dictionaries', 'qualificatifs.json'), 'utf-8'));

function secureRandomChoice<T>(array: T[]): T {
    return array[randomInt(0, array.length)];
}

export function generatePassphrase(): string {
    const plat = secureRandomChoice(plats);
    const origine = secureRandomChoice(origines);
    const qualificatif = secureRandomChoice(qualificatifs);

    return `${plat}-${origine}-${qualificatif}`;
}

export function getPassphraseCombinations(): number {
    return plats.length * origines.length * qualificatifs.length;
}
