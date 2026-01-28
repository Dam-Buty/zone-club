import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomInt } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDictionary(name: string): string[] {
    const path = join(__dirname, 'dictionaries', `${name}.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
}

const plats = loadDictionary('plats');
const origines = loadDictionary('origines');
const qualificatifs = loadDictionary('qualificatifs');

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
