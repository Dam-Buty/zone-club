import { randomInt } from 'crypto';
import plats from './dictionaries/plats.json';
import origines from './dictionaries/origines.json';
import qualificatifs from './dictionaries/qualificatifs.json';

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
