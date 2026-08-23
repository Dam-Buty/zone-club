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
  tags?: { language?: string; title?: string };
}

export interface SubTrack { lang: 'fr' | 'en'; streamIndex: number; codec: string; title?: string }

export interface TrackIdentification {
  voAudioIndex: number | null;
  vfAudioIndex: number | null;
  voAudioOrdinal: number | null; // position 0-based dans la liste audio (Nième piste)
  vfAudioOrdinal: number | null;
  textSubs: SubTrack[];        // ordre: fr d'abord, puis en
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
  let imageSubsFlagged = false;
  for (const s of subs) {
    const codec = (s.codec_name || '').toLowerCase();
    const lang = s.tags?.language;
    if (IMAGE_SUB_CODECS.has(codec)) { imageSubsFlagged = true; continue; }
    if (!TEXT_SUB_CODECS.has(codec)) continue;
    const title = s.tags?.title;
    if (isFrench(lang)) textSubs.push({ lang: 'fr', streamIndex: s.index, codec, title });
    else if (isEnglish(lang)) textSubs.push({ lang: 'en', streamIndex: s.index, codec, title });
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
    imageSubsFlagged,
  };
}
