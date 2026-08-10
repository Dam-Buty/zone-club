// ISO 639-1 (2 lettres, TMDB) → ISO 639-2/B (3 lettres, tags MKV/ffprobe).
// Couvre les langues de films courantes ; fallback = valeur inchangée.
const MAP_1_TO_2: Record<string, string> = {
  en: 'eng', fr: 'fre', ja: 'jpn', ko: 'kor', zh: 'chi', it: 'ita',
  es: 'spa', de: 'ger', ru: 'rus', pt: 'por', sv: 'swe', da: 'dan',
  no: 'nor', fi: 'fin', nl: 'dut', pl: 'pol', tr: 'tur', ar: 'ara',
  hi: 'hin', th: 'tha', cs: 'cze', hu: 'hun', el: 'gre', he: 'heb',
  uk: 'ukr', ro: 'rum', is: 'isl',
};

export function iso639_1to2(code: string): string {
  if (!code) return code;
  return MAP_1_TO_2[code.toLowerCase()] ?? code;
}

const FRENCH = new Set(['fre', 'fra', 'fr', 'french', 'français', 'francais']);
export function isFrench(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return FRENCH.has(lang.toLowerCase());
}

const ENGLISH = new Set(['eng', 'en', 'english', 'anglais']);
export function isEnglish(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return ENGLISH.has(lang.toLowerCase());
}
