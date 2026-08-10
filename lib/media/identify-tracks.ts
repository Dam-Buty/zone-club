import { iso639_1to2, isFrench, isEnglish } from './iso639';

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  tags?: { language?: string; title?: string };
}

export interface SubTrack { lang: 'fr' | 'en'; streamIndex: number; codec: string; }

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
    if (isFrench(lang)) textSubs.push({ lang: 'fr', streamIndex: s.index, codec });
    else if (isEnglish(lang)) textSubs.push({ lang: 'en', streamIndex: s.index, codec });
  }
  // Dédup par langue (garde la première), ordre fr puis en
  const seen = new Set<string>();
  const dedup = textSubs.filter(s => (seen.has(s.lang) ? false : (seen.add(s.lang), true)));
  dedup.sort((a, b) => (a.lang === b.lang ? 0 : a.lang === 'fr' ? -1 : 1));

  return {
    voAudioIndex: vo ? vo.index : null,
    vfAudioIndex: vf ? vf.index : null,
    voAudioOrdinal: vo ? audio.indexOf(vo) : null,
    vfAudioOrdinal: vf ? audio.indexOf(vf) : null,
    textSubs: dedup,
    imageSubsFlagged,
  };
}
