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

interface JobState {
  status: string;
  progress: number;
  error: string | null;
}

const queue: TranscodeJob[] = [];
let activeJobs = 0;
const MAX_CONCURRENT = 2;
const THREADS_PER_JOB = 10;

// Per-job progress tracking for combined reporting
const jobStates = new Map<string, JobState>();

function jobKey(filmId: number, type: string): string {
  return `${filmId}-${type}`;
}

// --- DB helpers ---

function syncFilmStatus(filmId: number): void {
  const voState = jobStates.get(jobKey(filmId, 'vo'));
  const vfState = jobStates.get(jobKey(filmId, 'vf'));

  const states = [voState, vfState].filter(Boolean) as JobState[];
  if (states.length === 0) return;

  // Combined progress = average of all tracked jobs
  const combinedProgress = states.reduce((sum, s) => sum + s.progress, 0) / states.length;

  // Combined status: error > active > probing > pending > done
  let combinedStatus: string;
  let combinedError: string | null = null;

  if (states.some(s => s.status === 'error')) {
    combinedStatus = 'error';
    combinedError = states.find(s => s.status === 'error')!.error;
  } else if (states.some(s => s.status === 'transcoding' || s.status === 'remuxing')) {
    combinedStatus = states.find(s => s.status === 'transcoding')?.status
      || states.find(s => s.status === 'remuxing')!.status;
  } else if (states.some(s => s.status === 'probing')) {
    combinedStatus = 'probing';
  } else if (states.every(s => s.status === 'done')) {
    combinedStatus = 'done';
    // Cleanup tracked states
    jobStates.delete(jobKey(filmId, 'vo'));
    jobStates.delete(jobKey(filmId, 'vf'));
  } else {
    combinedStatus = 'pending';
  }

  db.prepare(
    'UPDATE films SET transcode_status = ?, transcode_progress = ?, transcode_error = ? WHERE id = ?'
  ).run(combinedStatus, Math.min(combinedProgress, combinedStatus === 'done' ? 100 : 99.9), combinedError, filmId);
}

function updateJobState(filmId: number, type: string, status: string, progress: number = 0, error: string | null = null): void {
  jobStates.set(jobKey(filmId, type), { status, progress, error });
  syncFilmStatus(filmId);
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
  filmId: number,
  type: 'vo' | 'vf'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const copyVideo = probe.videoCodec === 'h264';
    const copyAudio = probe.audioCodec === 'aac';
    const isRemux = copyVideo && copyAudio;

    const statusLabel = isRemux ? 'remuxing' : 'transcoding';
    updateJobState(filmId, type, statusLabel, 0);

    console.log(`[transcoder] ${statusLabel}: video=${copyVideo ? 'copy' : 'h264'} audio=${copyAudio ? 'copy' : 'aac'}`);

    let lastProgressUpdate = 0;

    const command = ffmpeg(inputPath)
      .outputOptions('-threads', String(THREADS_PER_JOB))
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
          updateJobState(filmId, type, statusLabel, Math.min(pct, 99.9));
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

async function processJob(job: TranscodeJob): Promise<void> {
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
    // Skip if already transcoded (check BEFORE input — source may have been deleted)
    try {
      await access(outputPath);
      console.log(`[transcoder] Skip ${job.type.toUpperCase()}: "${filmTitle}" (déjà transcodé)`);
      setTranscodedPath(job.filmId, job.type, outputRelative);
      updateJobState(job.filmId, job.type, 'done', 100);
      checkAndEnableAvailability(job.filmId);
      return;
    } catch { /* output doesn't exist, proceed */ }

    // Check input exists
    await access(inputPath);

    // Probe
    updateJobState(job.filmId, job.type, 'probing');
    const probe = await probeFile(inputPath);
    console.log(`[transcoder] Probe: video=${probe.videoCodec} audio=${probe.audioCodec} dur=${Math.round(probe.duration)}s`);

    // Transcode
    await transcodeFile(inputPath, outputPath, probe, job.filmId, job.type);

    // Success
    setTranscodedPath(job.filmId, job.type, outputRelative);
    updateJobState(job.filmId, job.type, 'done', 100);
    checkAndEnableAvailability(job.filmId);

    console.log(`[transcoder] Terminé ${job.type.toUpperCase()}: "${filmTitle}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[transcoder] Erreur ${job.type.toUpperCase()} "${filmTitle}":`, msg);
    updateJobState(job.filmId, job.type, 'error', 0, msg);
  } finally {
    activeJobs--;
    processQueue();
  }
}

function processQueue(): void {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    activeJobs++;
    processJob(job);
  }
}

// --- Public API ---

export function enqueueTranscode(filmId: number, type: 'vo' | 'vf', inputRelativePath: string): void {
  // Avoid duplicate jobs
  const exists = queue.some(j => j.filmId === filmId && j.type === type);
  if (exists) return;

  updateJobState(filmId, type, 'pending');
  queue.push({ filmId, type, inputRelativePath });
  console.log(`[transcoder] Job ajouté: film #${filmId} ${type.toUpperCase()} (queue: ${queue.length})`);

  processQueue();
}

export function recoverPendingTranscodes(): void {
  interface UnfinishedFilm {
    id: number;
    title: string;
    file_path_vo: string | null;
    file_path_vf: string | null;
    file_path_vo_transcoded: string | null;
    file_path_vf_transcoded: string | null;
  }

  const films = db.prepare(`
    SELECT id, title, file_path_vo, file_path_vf, file_path_vo_transcoded, file_path_vf_transcoded
    FROM films
    WHERE (file_path_vo IS NOT NULL AND file_path_vo_transcoded IS NULL)
       OR (file_path_vf IS NOT NULL AND file_path_vf_transcoded IS NULL)
  `).all() as UnfinishedFilm[];

  if (films.length === 0) {
    console.log('[transcoder] Recovery: aucun transcodage en attente');
    return;
  }

  let count = 0;
  for (const film of films) {
    if (film.file_path_vo && !film.file_path_vo_transcoded) {
      enqueueTranscode(film.id, 'vo', film.file_path_vo);
      count++;
    }
    if (film.file_path_vf && !film.file_path_vf_transcoded) {
      enqueueTranscode(film.id, 'vf', film.file_path_vf);
      count++;
    }
  }

  console.log(`[transcoder] Recovery: ${count} job(s) ré-enqueue pour ${films.length} film(s)`);
}

export function getQueueLength(): number {
  return queue.length;
}

export function isProcessing(): boolean {
  return activeJobs > 0;
}
