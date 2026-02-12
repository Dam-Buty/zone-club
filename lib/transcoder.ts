import ffmpeg from 'fluent-ffmpeg';
import { db } from './db';
import { join, dirname, basename, extname } from 'path';
import { access } from 'fs/promises';

const MEDIA_FILMS_VO_PATH = process.env.MEDIA_FILMS_VO_PATH || '/media/films-vo';
const MEDIA_FILMS_VF_PATH = process.env.MEDIA_FILMS_VF_PATH || '/media/films-vf';

interface TranscodeJob {
  filmId: number;
  type: 'vo' | 'vf';
  inputRelativePath: string;
}

interface ProbeResult {
  videoCodec: string;
  audioCodec: string;
  duration: number;
}

const queue: TranscodeJob[] = [];
let processing = false;

// --- DB helpers ---

function updateTranscodeStatus(filmId: number, status: string, progress: number = 0, error: string | null = null): void {
  db.prepare(
    'UPDATE films SET transcode_status = ?, transcode_progress = ?, transcode_error = ? WHERE id = ?'
  ).run(status, progress, error, filmId);
}

function setTranscodedPath(filmId: number, type: 'vo' | 'vf', relativePath: string): void {
  const col = type === 'vo' ? 'file_path_vo_transcoded' : 'file_path_vf_transcoded';
  db.prepare(`UPDATE films SET ${col} = ? WHERE id = ?`).run(relativePath, filmId);
}

function checkAndEnableAvailability(filmId: number): void {
  const film = db.prepare(
    'SELECT file_path_vo_transcoded, file_path_vf_transcoded, is_available FROM films WHERE id = ?'
  ).get(filmId) as { file_path_vo_transcoded: string | null; file_path_vf_transcoded: string | null; is_available: number } | undefined;

  if (film && !film.is_available && (film.file_path_vo_transcoded || film.file_path_vf_transcoded)) {
    db.prepare('UPDATE films SET is_available = 1 WHERE id = ?').run(filmId);
    const title = (db.prepare('SELECT title FROM films WHERE id = ?').get(filmId) as any)?.title;
    console.log(`[transcoder] Film activé: "${title}"`);
  }
}

// --- Probe ---

function probeFile(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      resolve({
        videoCodec: videoStream?.codec_name || 'unknown',
        audioCodec: audioStream?.codec_name || 'unknown',
        duration: metadata.format.duration || 0,
      });
    });
  });
}

// --- Transcode ---

function transcodeFile(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  filmId: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const copyVideo = probe.videoCodec === 'h264';
    const copyAudio = probe.audioCodec === 'aac';
    const isRemux = copyVideo && copyAudio;

    const statusLabel = isRemux ? 'remuxing' : 'transcoding';
    updateTranscodeStatus(filmId, statusLabel, 0);

    console.log(`[transcoder] ${statusLabel}: video=${copyVideo ? 'copy' : 'h264'} audio=${copyAudio ? 'copy' : 'aac'}`);

    let lastProgressUpdate = 0;

    const command = ffmpeg(inputPath)
      .outputOptions('-movflags', '+faststart')
      .output(outputPath);

    // Video
    if (copyVideo) {
      command.videoCodec('copy');
    } else {
      command
        .videoCodec('libx264')
        .outputOptions('-crf', '23')
        .outputOptions('-preset', 'medium')
        .outputOptions('-vf', 'scale=-2:min(1080\\,ih)');
    }

    // Audio
    if (copyAudio) {
      command.audioCodec('copy');
    } else {
      command
        .audioCodec('aac')
        .audioBitrate('192k');
    }

    command
      .on('progress', (progress) => {
        const now = Date.now();
        if (now - lastProgressUpdate > 3000) {
          const pct = progress.percent ?? 0;
          updateTranscodeStatus(filmId, statusLabel, Math.min(pct, 99.9));
          lastProgressUpdate = now;
        }
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

// --- Queue processing ---

async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift()!;
    const basePath = job.type === 'vo' ? MEDIA_FILMS_VO_PATH : MEDIA_FILMS_VF_PATH;
    const inputPath = join(basePath, job.inputRelativePath);

    // Build output path: same dir, .web.mp4 extension
    const dir = dirname(inputPath);
    const name = basename(inputPath, extname(inputPath));
    const outputPath = join(dir, `${name}.web.mp4`);

    // Relative path for DB (strip base path)
    const outputRelative = join(
      dirname(job.inputRelativePath),
      `${basename(job.inputRelativePath, extname(job.inputRelativePath))}.web.mp4`
    );

    const filmTitle = (db.prepare('SELECT title FROM films WHERE id = ?').get(job.filmId) as any)?.title || `#${job.filmId}`;
    console.log(`[transcoder] Début ${job.type.toUpperCase()}: "${filmTitle}"`);

    try {
      // Check input exists
      await access(inputPath);

      // Probe
      updateTranscodeStatus(job.filmId, 'probing');
      const probe = await probeFile(inputPath);
      console.log(`[transcoder] Probe: video=${probe.videoCodec} audio=${probe.audioCodec} dur=${Math.round(probe.duration)}s`);

      // Transcode
      await transcodeFile(inputPath, outputPath, probe, job.filmId);

      // Success
      setTranscodedPath(job.filmId, job.type, outputRelative);
      updateTranscodeStatus(job.filmId, 'done', 100);
      checkAndEnableAvailability(job.filmId);

      console.log(`[transcoder] Terminé ${job.type.toUpperCase()}: "${filmTitle}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[transcoder] Erreur ${job.type.toUpperCase()} "${filmTitle}":`, msg);
      updateTranscodeStatus(job.filmId, 'error', 0, msg);
    }
  }

  processing = false;
}

// --- Public API ---

export function enqueueTranscode(filmId: number, type: 'vo' | 'vf', inputRelativePath: string): void {
  // Avoid duplicate jobs
  const exists = queue.some(j => j.filmId === filmId && j.type === type);
  if (exists) return;

  updateTranscodeStatus(filmId, 'pending');
  queue.push({ filmId, type, inputRelativePath });
  console.log(`[transcoder] Job ajouté: film #${filmId} ${type.toUpperCase()} (queue: ${queue.length})`);

  processQueue();
}

export function getQueueLength(): number {
  return queue.length;
}

export function isProcessing(): boolean {
  return processing;
}
