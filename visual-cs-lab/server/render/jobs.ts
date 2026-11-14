import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import ffmpegPath from 'ffmpeg-static';

import { db, newId, nowIso, readBrand, readBranding, type Brand } from '../db.ts';
import { effectiveConcept, lessonIssues, safeJson, type Scene } from '../scenes.ts';
import { ensureThumbnail } from './thumbnails.ts';
import type { VideoAssetRow } from '../content.ts';
import { drawMoment, planBrand, planFor, type MotionPlan } from '../anim/index.ts';
import { inspectPlan } from '../anim/inspect.ts';
import { lessonBundle, lessonThemeId, motionForLesson, themedBrand } from '../motion.ts';
import { PROFILES, totalFrames, type OutputProfile, type Preset } from './profiles.ts';
import {
  assessRender,
  parseMediaInfo,
  parseValidation,
  frameSample,
  type FrameSample,
  type RenderValidation
} from './quality.ts';
import { RenderWatchdog, watchdogLimitsFromEnv, type Stall } from './watchdog.ts';

export type { Preset } from './profiles.ts';
export { PROFILES as PRESETS } from './profiles.ts';

const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/visual-cs-lab/media';
mkdirSync(MEDIA_DIR, { recursive: true });
const CLIP_DIR = path.join(MEDIA_DIR, 'clips');
mkdirSync(CLIP_DIR, { recursive: true });

export type RenderState =
  | 'queued'
  | 'rendering'
  | 'encoding'
  | 'validating'
  | 'done'
  | 'error'
  | 'cancelled';

export type RenderJob = {
  id: string;
  lesson_id: string;
  preset: Preset;
  width: number;
  height: number;
  fps: number;
  state: RenderState;
  progress: number;
  log: string;
  error: string | null;
  output_path: string | null;
  bytes: number;
  duration_seconds: number;
  frames: number;
  expected_frames: number;
  expected_seconds: number;
  storyboard_hash: string;
  snapshot: string;
  validation: string | null;
  dedupe_key: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Refreshed while the worker makes progress; a stale one means a stall. */
  heartbeat_at?: string | null;
  /** Automatic recoveries after a process restart. */
  attempts?: number;
};

/* ---------------------------------------------------------- queue liveness */

/**
 * The queue is one sequential worker in this process. `renderWatchdog` is the
 * only record of what that worker is doing right now, so a stall can be aborted
 * instead of blocking every queued job behind it.
 */
export const renderWatchdog = new RenderWatchdog(watchdogLimitsFromEnv());

/** One automatic requeue after a crash: a render that kills the process twice is not retried forever. */
export const MAX_RECOVERY_ATTEMPTS = 1;

/** The in-progress file of a render: never a finished video, never a database row. */
const PARTIAL_SUFFIX = '.partial.mp4';

function finalPath(id: string): string {
  return path.join(MEDIA_DIR, `${id}.mp4`);
}

function partialPath(id: string): string {
  return path.join(MEDIA_DIR, `${id}${PARTIAL_SUFFIX}`);
}

/**
 * Ends a child process without leaving an orphan behind: close its stdin, ask
 * with SIGTERM, and insist with SIGKILL if it is still alive shortly after.
 */
function terminateChild(child: ChildProcess): void {
  try {
    child.stdin?.destroy();
  } catch {
    /* already closed */
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  const hard = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, 3000);
  hard.unref?.();
  child.once('close', () => clearTimeout(hard));
}

/** Writes the heartbeat with the progress update: one row write per batch of frames. */
function noteProgress(job: RenderJob, progress: number, frames: number): void {
  const stamp = nowIso();
  renderWatchdog.heartbeat(job.id);
  db.prepare('UPDATE render_jobs SET progress = ?, frames = ?, heartbeat_at = ? WHERE id = ?').run(
    progress,
    frames,
    stamp,
    job.id
  );
}

export type WatchdogEvent = Stall & { at: string };

/**
 * Looks for a stalled render and aborts it. Exported for tests and for the
 * interval started by `startWatchdog()`; the abort itself is what frees the
 * queue, the log line is what the Studio sees.
 */
export function runWatchdogTick(now = Date.now()): WatchdogEvent[] {
  const stalls = renderWatchdog.tick(now);
  for (const stall of stalls) {
    appendLog(stall.id, `watchdog: ${stall.detail} — aborting this render`);
  }
  return stalls.map((stall) => ({ ...stall, at: nowIso() }));
}

let watchdogTimer: NodeJS.Timeout | null = null;

/** Starts the liveness check. Safe to call twice: one interval per process. */
export function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    try {
      runWatchdogTick();
    } catch (error) {
      console.error('render watchdog tick failed', error);
    }
  }, renderWatchdog.limits.intervalMs);
  watchdogTimer.unref?.();
}

/** Stops the interval (tests, and a clean shutdown). In-flight aborts are untouched. */
export function stopWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

export { lessonBundle } from '../motion.ts';

function appendLog(id: string, line: string, progress?: number) {
  const stamp = new Date().toISOString().slice(11, 19);
  const row = db.prepare('SELECT log FROM render_jobs WHERE id = ?').get(id) as { log: string } | undefined;
  if (!row) return;
  const next = `${row.log}${row.log ? '\n' : ''}[${stamp}] ${line}`;
  db.prepare('UPDATE render_jobs SET log = ?, progress = COALESCE(?, progress) WHERE id = ?').run(
    next.slice(-4000),
    progress ?? null,
    id
  );
}

function jobById(id: string): RenderJob | undefined {
  return db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as RenderJob | undefined;
}

export function createJob(lessonId: string, preset: Preset): { job?: RenderJob; error?: string } {
  const bundle = lessonBundle(lessonId);
  if (!bundle) return { error: 'Lesson not found.' };
  const profile = PROFILES[preset];
  if (!profile) return { error: 'Unknown export preset.' };

  const issues = lessonIssues(bundle.lesson, bundle.concept, readBranding());
  if (issues.length > 0) {
    return { error: `The lesson is not ready to render yet: ${issues.join(' ')}` };
  }

  // The storyboard is snapshotted at enqueue time: the job renders exactly what
  // was validated, and a later edit cannot change a render already in flight.
  const scenes = safeJson<Scene[]>(bundle.lesson.scenes, []);
  if (scenes.length === 0) {
    return { error: 'The lesson has no storyboard to render. Build it from the verified trace first.' };
  }
  const snapshot = JSON.stringify(scenes);
  const hash = createHash('sha1').update(snapshot).digest('hex');

  const active = db
    .prepare(
      "SELECT id FROM render_jobs WHERE lesson_id = ? AND state IN ('queued','rendering','encoding','validating')"
    )
    .get(lessonId) as { id: string } | undefined;
  if (active) return { error: `This lesson already has a render in progress (${active.id}).` };

  const expectedMs = totalDuration(scenes);
  const frames = totalFrames(expectedMs, profile.fps);
  const id = newId();
  try {
    db.prepare(
      `INSERT INTO render_jobs (id, lesson_id, preset, width, height, fps, state, progress, log, dedupe_key,
         expected_frames, expected_seconds, storyboard_hash, snapshot, theme_id, created_at, heartbeat_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, '', ?, ?, ?, ?, ?, ?, ?, NULL, 0)`
    ).run(
      id,
      lessonId,
      preset,
      profile.width,
      profile.height,
      profile.fps,
      `${lessonId}:${preset}:${hash.slice(0, 8)}`,
      frames,
      expectedMs / 1000,
      hash,
      snapshot,
      lessonThemeId(lessonId),
      nowIso()
    );
  } catch (error) {
    // Two enqueues can pass the read above at the same time; the database's
    // one-active-render index is what actually decides between them.
    const message = (error as Error).message || '';
    if (/UNIQUE|constraint/i.test(message)) {
      return { error: 'This lesson already has a render in progress.' };
    }
    throw error;
  }

  pump();
  return { job: jobById(id) };
}

export type RenderFailure = { lessonId: string; lessonTitle: string; error: string; at: string };

/**
 * Failed renders are not kept. The reason lives only in memory until the Studio
 * reads it once, so Created videos holds real renders and nothing else.
 */
const failures: RenderFailure[] = [];

/** Hands the failures over once: nothing failed is stored, so this is the only record. */
export function recentFailures(): RenderFailure[] {
  return failures.splice(0, failures.length);
}

function recordFailure(job: RenderJob, error: string): void {
  const bundle = lessonBundle(job.lesson_id);
  failures.unshift({
    lessonId: job.lesson_id,
    lessonTitle: bundle?.lesson.title || job.lesson_id,
    error,
    at: nowIso()
  });
  failures.splice(5);
}

/** Drops the job row and any partial file: a failed generation is never stored. */
async function failJob(job: RenderJob, error: string): Promise<void> {
  recordFailure(job, error);
  await unlink(finalPath(job.id)).catch(() => undefined);
  await unlink(partialPath(job.id)).catch(() => undefined);
  db.prepare('DELETE FROM render_jobs WHERE id = ?').run(job.id);
}

export function retryJob(id: string): { job?: RenderJob; error?: string } {
  const job = jobById(id);
  if (!job) return { error: 'Render job not found.' };
  if (job.state !== 'error' && job.state !== 'cancelled') {
    return { error: 'Only failed or cancelled jobs can be retried.' };
  }
  // A manual retry is a fresh decision: it clears the recovery counter and the
  // stale heartbeat, so the watchdog gives the new attempt its full budget.
  db.prepare(
    `UPDATE render_jobs SET state = 'queued', progress = 0, frames = 0, error = NULL, log = '',
       started_at = NULL, finished_at = NULL, validation = NULL, heartbeat_at = NULL, attempts = 0
     WHERE id = ?`
  ).run(id);
  pump();
  return { job: jobById(id) };
}

const cancelled = new Set<string>();

/** Cancels a queued or in-flight render. A finished job is left alone. */
export function cancelJob(id: string): { job?: RenderJob; error?: string } {
  const job = jobById(id);
  if (!job) return { error: 'Render job not found.' };
  if (!['queued', 'rendering', 'encoding', 'validating'].includes(job.state)) {
    return { error: 'This job has already finished.' };
  }
  cancelled.add(id);
  // A running encode stops on the next frame anyway; aborting now also unblocks
  // one that is waiting on a pipe write, without waiting for the watchdog.
  renderWatchdog.get(id)?.abort.abort(new Error('cancelled'));
  if (job.state === 'queued') {
    db.prepare("UPDATE render_jobs SET state = 'cancelled', error = 'Cancelled before rendering.', finished_at = ? WHERE id = ?").run(
      nowIso(),
      id
    );
    cancelled.delete(id);
  }
  return { job: jobById(id) };
}

export const pumpingState = { active: false };

async function pump(): Promise<void> {
  if (pumpingState.active) return;
  pumpingState.active = true;
  try {
    for (;;) {
      const next = db
        .prepare("SELECT * FROM render_jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1")
        .get() as RenderJob | undefined;
      if (!next) break;
      // A job already registered as running is never started a second time; the
      // worker that owns it will clear its state when it finishes.
      if (renderWatchdog.has(next.id)) break;
      await renderJob(next);
    }
  } finally {
    pumpingState.active = false;
  }
}

function setState(id: string, state: RenderState, extra: Record<string, unknown> = {}) {
  const fields = Object.keys(extra);
  const assignments = ['state = ?', ...fields.map((field) => `${field} = ?`)].join(', ');
  db.prepare(`UPDATE render_jobs SET ${assignments} WHERE id = ?`).run(
    state,
    ...fields.map((field) => extra[field] as never),
    id
  );
}

/**
 * Runs one ffmpeg command to completion.
 *
 * A timeout is always applied: a probe or decode pass that never returns would
 * otherwise hold the sequential queue forever. On timeout the child is ended
 * (SIGTERM, then SIGKILL) and the caller sees a normal non-zero exit with the
 * reason in stderr.
 */
export function runFfmpeg(
  args: string[],
  opts: { captureStdout?: boolean; timeoutMs?: number } = {}
): Promise<{ code: number; stderr: string; stdout: Buffer }> {
  const timeoutMs = opts.timeoutMs ?? renderWatchdog.limits.validateMs;
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', opts.captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: { code: number; stderr: string; stdout: Buffer }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    if (proc.stdout) proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code) => finish({ code: code ?? 1, stderr, stdout: Buffer.concat(chunks) }));
    proc.on('error', (error) => finish({ code: 1, stderr: String(error), stdout: Buffer.alloc(0) }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        terminateChild(proc);
        finish({
          code: 124,
          stderr: `${stderr}\nffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`,
          stdout: Buffer.concat(chunks)
        });
      }, timeoutMs);
      timer.unref?.();
    }
  });
}

/** Total length of a beat list, in milliseconds. */
export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, scene) => sum + (Number(scene.durationMs) || 0), 0);
}

/**
 * Draws every frame of the motion plan into ffmpeg's stdin and waits for the
 * encode. One canvas is reused and each frame is written once the previous write
 * has drained, so a 4K master never holds more than a single frame in memory.
 *
 * This is the same `drawMoment()` the preview uses: there is no separate
 * slideshow path for export.
 */
async function encodeMoment(args: {
  motion: MotionPlan;
  profile: OutputProfile;
  output: string;
  /** Optional slice of the timeline, for scene previews. */
  fromMs?: number;
  toMs?: number;
  crf?: string;
  /** Container metadata: the personal identity travels with the file. */
  meta?: { title: string; artist: string; comment: string };
  onProgress?: (framesWritten: number, total: number) => void;
  isCancelled?: () => boolean;
  /** Aborted by the watchdog or a cancel request: the encoder is ended safely. */
  signal?: AbortSignal;
}): Promise<{ ok: boolean; frames: number; error?: string }> {
  const { motion, profile, output } = args;
  const fromMs = args.fromMs ?? 0;
  const toMs = args.toMs ?? motion.durationMs;
  const total = totalFrames(Math.max(1, toMs - fromMs), profile.fps);

  const encoder = spawn(
    ffmpegPath as string,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${profile.width}x${profile.height}`,
      '-r', String(profile.fps),
      '-i', '-',
      '-an',
      ...(args.meta
        ? [
            '-metadata', `title=${args.meta.title}`,
            '-metadata', `artist=${args.meta.artist}`,
            '-metadata', `author=${args.meta.artist}`,
            '-metadata', `comment=${args.meta.comment}`
          ]
        : []),
      '-c:v', 'libx264',
      '-preset', profile.x264,
      // Every lesson is flat vector motion graphics: the animation tune keeps
      // gradients and moving edges clean instead of smearing them between frames.
      '-tune', 'animation',
      // Gradient-heavy motion graphics lose detail fast at high CRF; each profile
      // carries its own quality. The Master profile targets a high bitrate instead,
      // so the uploaded file is never the bottleneck.
      ...(profile.bitrate
        ? ['-b:v', profile.bitrate, '-maxrate', profile.bitrate, '-bufsize', profile.bufsize ?? '32M']
        : ['-crf', args.crf ?? profile.crf]),
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-g', String(profile.fps * 2),
      '-movflags', '+faststart',
      output
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  let encoderError = '';
  encoder.stderr.on('data', (chunk: Buffer) => {
    encoderError += chunk.toString();
    if (encoderError.length > 4000) encoderError = encoderError.slice(-4000);
  });
  const exited = new Promise<number>((resolve) => encoder.on('close', (code) => resolve(code ?? 1)));
  // An abort ends the encoder instead of leaving an orphaned ffmpeg behind.
  const onAbort = () => terminateChild(encoder);
  args.signal?.addEventListener('abort', onAbort, { once: true });
  if (args.signal?.aborted) onAbort();

  const write = (buffer: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (!encoder.stdin.writable) {
        reject(new Error('the encoder closed its input early'));
        return;
      }
      encoder.stdin.write(buffer, (error) => (error ? reject(error) : resolve()));
    });

  const canvas = createCanvas(profile.width, profile.height);
  const ctx = canvas.getContext('2d');
  let frameIndex = 0;

  try {
    for (let i = 0; i < total; i++) {
      if (args.isCancelled?.() || args.signal?.aborted) throw new Error('cancelled');
      const tMs = fromMs + (i / profile.fps) * 1000;
      drawMoment(ctx, motion, Math.min(tMs, motion.durationMs - 1), {
        width: profile.width,
        height: profile.height
      });
      const image = ctx.getImageData(0, 0, profile.width, profile.height);
      await write(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));
      frameIndex++;
      if (frameIndex % 15 === 0) args.onProgress?.(frameIndex, total);
    }
    encoder.stdin.end();
    const code = await exited;
    args.signal?.removeEventListener('abort', onAbort);
    if (code !== 0) {
      return {
        ok: false,
        frames: frameIndex,
        error: `ffmpeg exited with code ${code}: ${encoderError.trim().slice(-300) || 'no output'}`
      };
    }
    return { ok: true, frames: frameIndex };
  } catch (error) {
    args.signal?.removeEventListener('abort', onAbort);
    terminateChild(encoder);
    await exited.catch(() => 1);
    return { ok: false, frames: frameIndex, error: (error as Error).message };
  }
}

/** Records a validated render job as the lesson's silent video asset. */
export function registerRenderAsset(jobId: string): VideoAssetRow | null {
  const job = db
    .prepare(
      'SELECT id, lesson_id, preset, width, height, output_path, bytes, duration_seconds, validation, state, storyboard_hash FROM render_jobs WHERE id = ?'
    )
    .get(jobId) as
    | {
        id: string;
        lesson_id: string;
        preset: string;
        width: number;
        height: number;
        output_path: string | null;
        bytes: number;
        duration_seconds: number;
        validation: string | null;
        state: string;
        storyboard_hash: string;
      }
    | undefined;
  if (!job || job.state !== 'done' || !job.output_path) return null;
  const existing = db.prepare('SELECT * FROM video_assets WHERE render_job_id = ?').get(job.id) as
    | VideoAssetRow
    | undefined;
  if (existing) return existing;

  const lesson = db.prepare('SELECT version, theme_id, scenes FROM lessons WHERE id = ?').get(job.lesson_id) as
    | { version: number; theme_id: string; scenes: string }
    | undefined;
  // An asset belongs to the storyboard it was rendered from: a job whose snapshot
  // no longer matches the lesson is a stale encode, not a current video.
  const currentHash = createHash('sha1').update(String(lesson?.scenes || '[]')).digest('hex');
  if (currentHash !== String(job.storyboard_hash || '')) return null;
  const validation = job.validation ? (JSON.parse(job.validation) as { ok?: boolean }) : null;
  const id = `asset-${job.id}`;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO video_assets (id, lesson_id, lesson_version, render_job_id, base_asset_id, theme_id, audio_mode,
       audio_track_id, resolution, width, height, file_path, thumbnail_path, bytes, duration_seconds,
       validation_ok, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'silent', NULL, ?, ?, ?, ?, '', ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    job.lesson_id,
    Number(lesson?.version || 1),
    job.id,
    lesson?.theme_id || 'theme_01',
    job.preset,
    job.width,
    job.height,
    job.output_path,
    job.bytes,
    job.duration_seconds,
    validation?.ok ? 1 : 0,
    validation?.ok ? 'ready' : 'failed',
    stamp,
    stamp
  );
  return db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id) as VideoAssetRow;
}

function lastFrameCount(stdout: Buffer): number {
  const text = stdout.toString('utf8');
  let last = 0;
  for (const match of text.matchAll(/frame=(\d+)/g)) last = Number(match[1]);
  return last;
}

/** Extracts one frame as a small PNG and measures it. */
async function sampleFrame(
  output: string,
  atSeconds: number,
  aspect: { width: number; height: number }
): Promise<FrameSample | null> {
  // Sample at a fixed short side so a landscape copy is measured on its own
  // shape instead of being squashed into the vertical one.
  const width = 270;
  const height = Math.max(2, Math.round((width * aspect.height) / aspect.width));
  const result = await runFfmpeg(
    [
      '-nostdin',
      '-v', 'error',
      '-ss', atSeconds.toFixed(3),
      '-i', output,
      '-frames:v', '1',
      '-vf', `scale=${width}:${height}`,
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ],
    { captureStdout: true, timeoutMs: 60_000 }
  );
  if (result.code !== 0 || result.stdout.length === 0) return null;
  try {
    const image = await loadImage(result.stdout);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    return frameSample(data.data, width, height, atSeconds);
  } catch {
    return null;
  }
}

/**
 * Validates the encoded file: container/stream metadata, a full decode pass that
 * counts decoded frames, and three sampled frames checked for blankness and for
 * actual motion between them.
 */
async function validateOutput(
  job: RenderJob,
  output: string,
  profile: OutputProfile,
  /** Called between phases so a long decode is never mistaken for a stall. */
  onActivity?: () => void
): Promise<RenderValidation> {
  const probe = await runFfmpeg(['-hide_banner', '-i', output], {
    timeoutMs: Math.min(renderWatchdog.limits.validateMs, 120_000)
  });
  onActivity?.();
  const media = parseMediaInfo(probe.stderr);
  const info = await stat(output);
  // Only the container signature is needed, so a 4K master is not read into memory.
  const handle = await open(output, 'r');
  const head = Buffer.alloc(16);
  try {
    await handle.read(head, 0, 16, 0);
  } finally {
    await handle.close();
  }

  const decode = await runFfmpeg(
    ['-nostdin', '-v', 'error', '-i', output, '-an', '-f', 'null', '-progress', 'pipe:1', '-nostats', '-'],
    { captureStdout: true, timeoutMs: renderWatchdog.limits.validateMs }
  );
  onActivity?.();
  const decodedFrames = decode.code === 0 ? lastFrameCount(decode.stdout) : 0;

  // Five points across the short: beginning, two middle beats (where the
  // algorithm actually changes state) and the ending — each one inside a settled
  // beat, because a frame on a beat boundary is legitimately mid-fade to black.
  const expectedSeconds = job.expected_frames / profile.fps;
  const samples: FrameSample[] = [];
  for (const at of validationSampleMoments(expectedSeconds, job.snapshot)) {
    const sample = await sampleFrame(output, Math.max(0, at), {
      width: profile.width,
      height: profile.height
    });
    if (sample) samples.push(sample);
    onActivity?.();
  }

  return assessRender({
    profile,
    expectedFrames: job.expected_frames,
    bytes: info.size,
    head,
    media,
    decodedFrames,
    samples,
    decodeError: decode.code === 0 ? undefined : decode.stderr.trim().slice(-200)
  });
}

/**
 * The seconds a finished render is sampled at for the blank-frame check.
 *
 * The five fractions are snapped to the middle of the beat nearest to them: every
 * beat fades in and out, so sampling a boundary would call a healthy frame blank.
 */
export function validationSampleMoments(seconds: number, snapshot: string): number[] {
  const scenes = safeJson<Scene[]>(snapshot, []);
  const fractions = [0.06, 0.28, 0.5, 0.74, 0.94];
  if (scenes.length === 0) return fractions.map((fraction) => seconds * fraction);

  let cursor = 0;
  const settled = scenes.map((scene) => {
    const duration = Math.max(1, Number(scene.durationMs) || 0);
    const middle = cursor + duration * 0.5;
    cursor += duration;
    return middle / 1000;
  });

  const times = fractions.map((fraction) => {
    const target = seconds * fraction;
    return settled.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best), settled[0]);
  });
  return [...new Set(times)].sort((a, b) => a - b);
}

/**
 * Claims a queued job and runs it.
 *
 * The claim is one conditional UPDATE (`state = 'queued'`), so a job reaches the
 * encoder exactly once even if two pumps or a retry race each other. The job is
 * registered with the watchdog for the whole run, and always deregistered.
 */
async function renderJob(job: RenderJob): Promise<void> {
  if (renderWatchdog.has(job.id)) return;
  const stamp = nowIso();
  const claim = db
    .prepare(
      `UPDATE render_jobs SET state = 'rendering', started_at = ?, heartbeat_at = ?, error = NULL,
         progress = 0, frames = 0, log = '', validation = NULL
       WHERE id = ? AND state = 'queued'`
    )
    .run(stamp, stamp, job.id);
  if (claim.changes === 0) return;

  const running = renderWatchdog.register({ id: job.id, lessonId: job.lesson_id, stage: 'rendering' });
  try {
    await runClaimedJob(job, running);
  } finally {
    renderWatchdog.finish(job.id);
  }
}

async function runClaimedJob(job: RenderJob, running: ReturnType<RenderWatchdog['register']>): Promise<void> {
  const bundle = lessonBundle(job.lesson_id);
  if (!bundle) {
    await failJob(job, 'The lesson was deleted before rendering.');
    return;
  }

  // The lesson's theme supplies the surface palette; the personal identity and
  // opening/ending timings come from the brand row unchanged.
  const brand = themedBrand(readBrand() as Brand, lessonThemeId(job.lesson_id));
  const branding = readBranding();
  // Render the snapshot taken at enqueue: the file matches what was validated.
  const scenes = safeJson<Scene[]>(job.snapshot || '', []);
  const stored = scenesFor(job.lesson_id) || [];
  if (scenes.length === 0) {
    await failJob(job, 'The job has no storyboard snapshot. Start a new render.');
    return;
  }
  const profile = PROFILES[job.preset];
  let motion: MotionPlan;
  try {
    // The plan is rebuilt from the snapshot's beat timings and the concept's
    // trusted trace, so the file animates verified states only.
    motion = planFor({
      lesson: bundle.lesson,
      concept: effectiveConcept(bundle.lesson, bundle.concept),
      scenes,
      brand: planBrand(brand)
    });
  } catch (error) {
    await failJob(job, `The animation plan could not be built: ${(error as Error).message}`);
    return;
  }
  // Scene inspection runs before a single frame is encoded: text containment,
  // text/object collisions, pointer-to-target alignment and the algorithm state
  // each scene shows. A failure refuses the render instead of shipping it.
  // The plan is inspected at half the profile's size, so a landscape copy is
  // judged against its own frame instead of the vertical one.
  const audit = inspectPlan(motion, { width: job.width / 2, height: job.height / 2 });
  appendLog(
    job.id,
    `scene inspection: ${audit.sampled} sampled moments · ${audit.checks.filter((check) => check.ok).length}/${audit.checks.length} checks passed`
  );
  if (!audit.ok) {
    await failJob(job, `Scene inspection failed: ${audit.issues.join(' ')}`);
    return;
  }

  const plannedFrames = totalFrames(motion.durationMs, profile.fps);
  appendLog(
    job.id,
    `${scenes.length} beats, ${plannedFrames} frames (${(motion.durationMs / 1000).toFixed(2)}s) at ${job.width}×${job.height} ${job.fps}fps — ${motion.kind} motion (snapshot ${job.storyboard_hash.slice(0, 8)})`
  );
  if (stored.length > 0 && createHash('sha1').update(JSON.stringify(stored)).digest('hex') !== job.storyboard_hash) {
    appendLog(job.id, 'note: the lesson storyboard has been edited since this render was queued');
  }

  // The encode writes `<id>.partial.mp4`. Only a successful encode is renamed to
  // `<id>.mp4`, so a crash mid-write can never leave a file that looks finished.
  const partial = partialPath(job.id);
  const output = finalPath(job.id);
  await unlink(partial).catch(() => undefined);
  const result = await encodeMoment({
    motion,
    profile,
    output: partial,
    meta: {
      title: bundle.lesson.title,
      artist: branding.presenter,
      comment: `${branding.presenter} · ${branding.role}`
    },
    onProgress: (written, total) => {
      const pct = Math.min(95, (written / Math.max(1, total)) * 95);
      noteProgress(job, pct, written);
    },
    isCancelled: () => cancelled.has(job.id),
    signal: running.abort.signal
  });

  if (!result.ok) {
    const isCancel = cancelled.has(job.id);
    cancelled.delete(job.id);
    await unlink(partial).catch(() => undefined);
    const stallReason = renderWatchdog.abortReason(job.id);
    if (isCancel) {
      setState(job.id, 'cancelled', { error: 'Cancelled while rendering.', finished_at: nowIso() });
      appendLog(job.id, 'cancelled');
    } else if (stallReason) {
      await failJob(job, `Render failed: ${stallReason}.`);
    } else {
      await failJob(job, `Render failed: ${result.error}`);
    }
    return;
  }

  // The encode is complete; the file becomes the render's output at this point.
  try {
    await rename(partial, output);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    await failJob(job, `The finished encode could not be stored: ${(error as Error).message}`);
    return;
  }

  setState(job.id, 'encoding', { progress: 96, frames: result.frames });
  renderWatchdog.markStage(job.id, 'encoding');
  appendLog(job.id, `${result.frames} frames written, encode finished`);
  setState(job.id, 'validating', { progress: 98 });
  renderWatchdog.markStage(job.id, 'validating');

  try {
    const validation = await validateOutput(job, output, profile, () => renderWatchdog.heartbeat(job.id));
    // The encoded file's checks and the plan's scene checks belong to one report.
    validation.checks.push(...audit.checks);
    validation.ok = validation.ok && audit.checks.every((check) => check.ok);
    const info = await stat(output);
    const failed = validation.checks.filter((check) => !check.ok);
    appendLog(
      job.id,
      validation.ok
        ? `quality checked: ${validation.checks.length} checks passed · ${(info.size / 1048576).toFixed(2)} MB`
        : `quality checks failed: ${failed.map((check) => check.id).join(', ')}`
    );
    const media = validation.media;
    if (!validation.ok) {
      await failJob(job, `Output validation failed: ${failed.map((check) => `${check.label} (${check.detail})`).join('; ')}.`);
      await unlink(output).catch(() => undefined);
      return;
    }

    setState(job.id, 'done', {
      progress: 100,
      output_path: output,
      bytes: info.size,
      duration_seconds: media?.durationSeconds ?? job.expected_seconds,
      frames: result.frames,
      validation: JSON.stringify(validation),
      finished_at: nowIso()
    });
    // A finished, validated render becomes the lesson's silent video asset, so the
    // learner page can play exactly the file that passed the quality checks.
    registerRenderAsset(job.id);
    // The poster image is cut from the same deterministic opening frame, so the
    // library and the publishing queue show what the video actually opens with.
    const thumb = ensureThumbnail(job.lesson_id);
    appendLog(
      job.id,
      thumb.file
        ? `thumbnail ${thumb.regenerated ? 'generated' : 'reused'} from the opening frame at ${(thumb.row?.captured_at_ms ?? 0) / 1000}s`
        : `thumbnail not generated: ${thumb.error || 'unknown reason'}`
    );
  } catch (error) {
    await failJob(job, `Validation failed: ${(error as Error).message}`);
    await unlink(output).catch(() => undefined);
  }
}

function motionFor(lessonId: string): MotionPlan | null {
  return motionForLesson(lessonId)?.motion ?? null;
}

/** A frame from the middle of one beat, used for real storyboard thumbnails. */
export function thumbnail(lessonId: string, sceneIndex: number, width = 540): Buffer | null {
  const motion = motionFor(lessonId);
  if (!motion) return null;
  const beat = motion.beats[sceneIndex];
  if (!beat) return null;
  const height = Math.round((width / 9) * 16);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const at = beat.startMs + (beat.endMs - beat.startMs) * 0.55;
  drawMoment(ctx, motion, at, { width, height });
  return canvas.encodeSync('png');
}

/**
 * A short MP4 of one scene, so the editor can play the real motion instead of
 * looking at a still. Output is cached on the scene contents and brand version.
 */
export async function sceneClip(
  lessonId: string,
  sceneIndex: number,
  width = 540
): Promise<{ file?: string; error?: string }> {
  const motion = motionFor(lessonId);
  if (!motion) return { error: 'This lesson has no animation to preview yet.' };
  const beat = motion.beats[sceneIndex];
  if (!beat) return { error: 'Scene not found.' };
  const brand = readBrand() as Brand;
  const profile: OutputProfile = {
    width,
    height: Math.round((width / 9) * 16),
    fps: PROFILES.preview.fps,
    label: `Clip ${width}px`,
    purpose: 'Scene preview',
    crf: PROFILES.preview.crf,
    x264: PROFILES.preview.x264
  };
  const hash = createHash('sha1')
    .update(JSON.stringify({ beat, brand: brand.updated_at, width, fps: profile.fps, v: 2 }))
    .digest('hex')
    .slice(0, 20);
  const file = path.join(CLIP_DIR, `${hash}.mp4`);
  if (existsSync(file)) return { file };

  const tmp = path.join(CLIP_DIR, `${hash}.${process.pid}.tmp.mp4`);
  const result = await encodeMoment({
    motion,
    profile,
    output: tmp,
    fromMs: beat.startMs,
    toMs: beat.endMs,
    crf: '23'
  });
  if (!result.ok) {
    await unlink(tmp).catch(() => undefined);
    return { error: `Scene preview failed: ${result.error}` };
  }
  try {
    // Rename is atomic inside one directory, so a reader never sees a half file.
    await rename(tmp, file);
  } catch {
    return { file: tmp };
  }
  return { file };
}

/**
 * The canonical storyboard: only the scenes persisted on the lesson row.
 *
 * It deliberately does not fall back to a freshly built scene list — that would
 * show a storyboard the render readiness check and the renderer cannot see, and
 * let the UI promise a video the stored record cannot produce.
 */
export function scenesFor(lessonId: string): Scene[] | null {
  const bundle = lessonBundle(lessonId);
  if (!bundle) return null;
  return safeJson<Scene[]>(bundle.lesson.scenes || '[]', []);
}

export type BootRecovery = { requeued: string[]; dropped: string[]; partialsRemoved: number };

function removeJobFiles(id: string, outputPath?: string | null): void {
  for (const file of [finalPath(id), partialPath(id), outputPath]) {
    if (!file) continue;
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Boot recovery for the sequential queue.
 *
 * - Partial files (`<id>.partial.mp4`) are deleted: a half-written encode is
 *   never a finished video, and nothing points at one after a crash.
 * - A job that was in flight is requeued once, so a server restart does not lose
 *   the render a person asked for. A job that has already used its one automatic
 *   recovery is dropped, as is a job whose lesson already has another active
 *   render, so a crash loop cannot spin forever.
 * - Rows in `error` are dropped, matching the policy that failed generations are
 *   not stored as history. Completed (`done`) jobs and their MP4s are untouched.
 */
export function resumeOnBoot(opts: { pump?: boolean } = {}): BootRecovery {
  const summary: BootRecovery = { requeued: [], dropped: [], partialsRemoved: 0 };
  const recoveredAt = nowIso();

  // 1. Leftover partial files from a crash: never a finished render.
  if (existsSync(MEDIA_DIR)) {
    for (const entry of readdirSync(MEDIA_DIR)) {
      if (!entry.endsWith(PARTIAL_SUFFIX)) continue;
      try {
        unlinkSync(path.join(MEDIA_DIR, entry));
        summary.partialsRemoved += 1;
      } catch {
        /* already gone */
      }
    }
  }

  // 2. Interrupted jobs: requeue once, then give up.
  const interrupted = db
    .prepare(
      `SELECT id, lesson_id, output_path, attempts FROM render_jobs
       WHERE state IN ('rendering','encoding','validating') ORDER BY created_at`
    )
    .all() as { id: string; lesson_id: string; output_path: string | null; attempts: number }[];
  for (const row of interrupted) {
    const otherActive = db
      .prepare(
        `SELECT id FROM render_jobs WHERE lesson_id = ? AND id != ?
         AND state IN ('queued','rendering','encoding','validating') LIMIT 1`
      )
      .get(row.lesson_id, row.id) as { id: string } | undefined;
    const attempts = Number(row.attempts || 0);
    if (otherActive || attempts >= MAX_RECOVERY_ATTEMPTS) {
      // The MP4 of an unfinished job is never a finished render.
      removeJobFiles(row.id, row.output_path);
      db.prepare('DELETE FROM render_jobs WHERE id = ?').run(row.id);
      summary.dropped.push(row.id);
      continue;
    }
    removeJobFiles(row.id, row.output_path);
    db.prepare(
      `UPDATE render_jobs SET state = 'queued', progress = 0, frames = 0, error = NULL,
         started_at = NULL, heartbeat_at = NULL, attempts = ?, log = ?
       WHERE id = ?`
    ).run(attempts + 1, `[recovery] requeued after a process restart at ${recoveredAt}`, row.id);
    summary.requeued.push(row.id);
  }

  // 3. Failed rows are not kept (existing policy), and neither are their files.
  const failed = db.prepare("SELECT id, output_path FROM render_jobs WHERE state = 'error'").all() as {
    id: string;
    output_path: string | null;
  }[];
  for (const row of failed) {
    removeJobFiles(row.id, row.output_path);
    db.prepare('DELETE FROM render_jobs WHERE id = ?').run(row.id);
    summary.dropped.push(row.id);
  }

  if (opts.pump !== false) pump();
  return summary;
}

export { parseValidation, PROFILES as OUTPUT_PROFILES };
