import { randomInt } from 'crypto';
import platsJson from './dictionaries/plats.json';
import originesJson from './dictionaries/origines.json';
import qualificatifsJson from './dictionaries/qualificatifs.json';

const plats: string[] = platsJson;
const origines: string[] = originesJson;
const qualificatifs: string[] = qualificatifsJson;

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
