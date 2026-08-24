import { iso639_1to2, isFrench, isEnglish } from './iso639';

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  profile?: string;
  bit_rate?: string | number;
  color_transfer?: string;
  color_primaries?: string;
  tags?: { language?: string; title?: string };
}

export interface SubTrack { lang: 'fr' | 'en'; streamIndex: number; codec: string; title?: string }

export interface TrackIdentification {
  voAudioIndex: number | null;
  vfAudioIndex: number | null;
  voAudioOrdinal: number | null; // position 0-based dans la liste audio (Nième piste)
  vfAudioOrdinal: number | null;
  textSubs: SubTrack[];        // ordre: fr d'abord, puis en
  imageSubs: SubTrack[];       // pistes PGS/VobSub, récupérables par OCR
  imageSubsFlagged: boolean;   // au moins une piste sub image détectée
}

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const IMAGE_SUB_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'pgssub']);

export function identifyTracks(streams: ProbeStream[], originalLanguage: string | null): TrackIdentification {
  const audio = streams.filter(s => s.codec_type === 'audio');
  const subs = streams.filter(s => s.codec_type === 'subtitle');

  const voTag = iso639_1to2(originalLanguage || '');

  // VF = première audio taggée français
  const vf = audio.find(s => isFrench(s.tags?.language));
  // VO = première audio dans la langue originale ; fallback = première audio non-française ; fallback = première audio
  const voByLang = voTag ? audio.find(s => (s.tags?.language || '').toLowerCase() === voTag.toLowerCase()) : undefined;
  const voNonFr = audio.find(s => !isFrench(s.tags?.language));
  const vo = voByLang ?? voNonFr ?? audio[0];

  const textSubs: SubTrack[] = [];
  const imageSubs: SubTrack[] = [];
  let imageSubsFlagged = false;
  for (const s of subs) {
    const codec = (s.codec_name || '').toLowerCase();
    const lang = s.tags?.language;
    const title = s.tags?.title;
    // Les pistes image ne sont plus jetées : elles sont récupérables par OCR.
    // C'est la norme sur les BluRay de catalogue — Saving Private Ryan, Die Hard 2
    // et Naked Gun n'ont QUE du PGS, et étaient donc refusés faute de sous-titres
    // alors qu'ils en portaient. Sur Gran Torino, la seule piste texte française
    // est la piste forcée : la version complète n'existe qu'en PGS.
    const target = IMAGE_SUB_CODECS.has(codec) ? imageSubs
      : TEXT_SUB_CODECS.has(codec) ? textSubs
        : null;
    if (!target) continue;
    if (target === imageSubs) imageSubsFlagged = true;
    if (isFrench(lang)) target.push({ lang: 'fr', streamIndex: s.index, codec, title });
    else if (isEnglish(lang)) target.push({ lang: 'en', streamIndex: s.index, codec, title });
  }
  // TOUTES les pistes candidates sont retournées, pas une par langue.
  //
  // Une release porte couramment deux pistes par langue — les sous-titres forcés
  // (panneaux, dialogues en langue étrangère : ~90 lignes) et les dialogues
  // complets (~1500 lignes) — et AUCUNE métadonnée ne permet de les distinguer de
  // façon fiable : sur un WEB-DL Netflix testé, `DISPOSITION:forced` vaut 0 sur les
  // deux, et côté titre la piste forcée porte une chaîne vide quand la complète n'a
  // pas de tag du tout. Garder la première revenait à servir les panneaux comme
  // sous-titres. Le tri se fait à l'extraction, au nombre de cues.
  const order = { fr: 0, en: 1 };
  const dedup = [...textSubs].sort((a, b) => order[a.lang] - order[b.lang] || a.streamIndex - b.streamIndex);

  return {
    voAudioIndex: vo ? vo.index : null,
    vfAudioIndex: vf ? vf.index : null,
    voAudioOrdinal: vo ? audio.indexOf(vo) : null,
    vfAudioOrdinal: vf ? audio.indexOf(vf) : null,
    textSubs: dedup,
    imageSubs: [...imageSubs].sort((a, b) => order[a.lang] - order[b.lang] || a.streamIndex - b.streamIndex),
    imageSubsFlagged,
  };
}
