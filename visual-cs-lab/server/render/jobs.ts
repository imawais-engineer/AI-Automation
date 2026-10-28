import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import ffmpegPath from 'ffmpeg-static';

import { db, newId, nowIso, readBrand, type Brand } from '../db.ts';
import { effectiveConcept, lessonIssues, safeJson, type Scene } from '../scenes.ts';
import { drawMoment, planBrand, planFor, type MotionPlan } from '../anim/index.ts';
import { inspectPlan } from '../anim/inspect.ts';
import { lessonBundle, motionForLesson } from '../motion.ts';
import { PROFILES, totalFrames, type OutputProfile, type Preset } from './profiles.ts';
import {
  assessRender,
  parseMediaInfo,
  parseValidation,
  frameSample,
  type FrameSample,
  type RenderValidation
} from './quality.ts';

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
};

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

  const issues = lessonIssues(bundle.lesson, bundle.concept);
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
  db.prepare(
    `INSERT INTO render_jobs (id, lesson_id, preset, width, height, fps, state, progress, log, dedupe_key,
       expected_frames, expected_seconds, storyboard_hash, snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, '', ?, ?, ?, ?, ?, ?)`
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
    nowIso()
  );

  pump();
  return { job: jobById(id) };
}

export function retryJob(id: string): { job?: RenderJob; error?: string } {
  const job = jobById(id);
  if (!job) return { error: 'Render job not found.' };
  if (job.state !== 'error' && job.state !== 'cancelled') {
    return { error: 'Only failed or cancelled jobs can be retried.' };
  }
  db.prepare(
    "UPDATE render_jobs SET state = 'queued', progress = 0, error = NULL, log = '', started_at = NULL, finished_at = NULL, validation = NULL WHERE id = ?"
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
  if (job.state === 'queued') {
    db.prepare("UPDATE render_jobs SET state = 'cancelled', error = 'Cancelled before rendering.', finished_at = ? WHERE id = ?").run(
      nowIso(),
      id
    );
    cancelled.delete(id);
  }
  return { job: jobById(id) };
}

let pumping = false;

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = db
        .prepare("SELECT * FROM render_jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1")
        .get() as RenderJob | undefined;
      if (!next) break;
      await renderJob(next);
    }
  } finally {
    pumping = false;
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

export function runFfmpeg(
  args: string[],
  opts: { captureStdout?: boolean } = {}
): Promise<{ code: number; stderr: string; stdout: Buffer }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', opts.captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '';
    const chunks: Buffer[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    if (proc.stdout) proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr, stdout: Buffer.concat(chunks) }));
    proc.on('error', (error) => resolve({ code: 1, stderr: String(error), stdout: Buffer.alloc(0) }));
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
  onProgress?: (framesWritten: number, total: number) => void;
  isCancelled?: () => boolean;
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
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      // Gradient-heavy motion graphics lose detail fast at high CRF; the HD
      // master uses 19 and 4K uses 21 (4K has four times the pixels).
      '-crf', args.crf ?? (profile.height >= 2000 ? '21' : profile.height >= 1900 ? '19' : '21'),
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
      if (args.isCancelled?.()) throw new Error('cancelled');
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
    if (code !== 0) {
      return {
        ok: false,
        frames: frameIndex,
        error: `ffmpeg exited with code ${code}: ${encoderError.trim().slice(-300) || 'no output'}`
      };
    }
    return { ok: true, frames: frameIndex };
  } catch (error) {
    try {
      encoder.stdin.destroy();
    } catch {
      /* already closed */
    }
    try {
      encoder.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    await exited.catch(() => 1);
    return { ok: false, frames: frameIndex, error: (error as Error).message };
  }
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
  atSeconds: number
): Promise<FrameSample | null> {
  const width = 270;
  const height = 480;
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
    { captureStdout: true }
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
  profile: OutputProfile
): Promise<RenderValidation> {
  const probe = await runFfmpeg(['-hide_banner', '-i', output]);
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
    { captureStdout: true }
  );
  const decodedFrames = decode.code === 0 ? lastFrameCount(decode.stdout) : 0;

  // Five points across the short: beginning, two middle beats (where the
  // algorithm actually changes state) and the ending.
  const expectedSeconds = job.expected_frames / profile.fps;
  const samples: FrameSample[] = [];
  for (const fraction of [0.06, 0.28, 0.5, 0.74, 0.94]) {
    const sample = await sampleFrame(output, Math.max(0, expectedSeconds * fraction));
    if (sample) samples.push(sample);
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

async function renderJob(job: RenderJob): Promise<void> {
  setState(job.id, 'rendering', { started_at: nowIso(), error: null, progress: 0, log: '', validation: null });

  const bundle = lessonBundle(job.lesson_id);
  if (!bundle) {
    setState(job.id, 'error', { error: 'The lesson was deleted before rendering.', finished_at: nowIso() });
    return;
  }

  const brand = readBrand() as Brand;
  // Render the snapshot taken at enqueue: the file matches what was validated.
  const scenes = safeJson<Scene[]>(job.snapshot || '', []);
  const stored = scenesFor(job.lesson_id) || [];
  if (scenes.length === 0) {
    setState(job.id, 'error', {
      error: 'The job has no storyboard snapshot. Start a new render.',
      finished_at: nowIso()
    });
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
    setState(job.id, 'error', {
      error: `The animation plan could not be built: ${(error as Error).message}`,
      finished_at: nowIso()
    });
    return;
  }
  // Scene inspection runs before a single frame is encoded: text containment,
  // text/object collisions, pointer-to-target alignment and the algorithm state
  // each scene shows. A failure refuses the render instead of shipping it.
  const audit = inspectPlan(motion);
  appendLog(
    job.id,
    `scene inspection: ${audit.sampled} sampled moments · ${audit.checks.filter((check) => check.ok).length}/${audit.checks.length} checks passed`
  );
  if (!audit.ok) {
    setState(job.id, 'error', {
      error: `Scene inspection failed: ${audit.issues.join(' ')}`,
      validation: JSON.stringify({
        ok: false,
        media: null,
        checks: audit.checks,
        humanReview: [],
        samples: [],
        validatedAt: nowIso()
      }),
      finished_at: nowIso()
    });
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

  const output = path.join(MEDIA_DIR, `${job.id}.mp4`);
  const result = await encodeMoment({
    motion,
    profile,
    output,
    onProgress: (written, total) => {
      const pct = Math.min(95, (written / Math.max(1, total)) * 95);
      db.prepare('UPDATE render_jobs SET progress = ?, frames = ? WHERE id = ?').run(pct, written, job.id);
    },
    isCancelled: () => cancelled.has(job.id)
  });

  if (!result.ok) {
    const isCancel = cancelled.has(job.id);
    cancelled.delete(job.id);
    await unlink(output).catch(() => undefined);
    setState(job.id, isCancel ? 'cancelled' : 'error', {
      error: isCancel ? 'Cancelled while rendering.' : `Render failed: ${result.error}`,
      finished_at: nowIso()
    });
    appendLog(job.id, isCancel ? 'cancelled' : `failed after ${result.frames} frames`);
    return;
  }

  setState(job.id, 'encoding', { progress: 96, frames: result.frames });
  appendLog(job.id, `${result.frames} frames written, encode finished`);
  setState(job.id, 'validating', { progress: 98 });

  try {
    const validation = await validateOutput(job, output, profile);
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
      setState(job.id, 'error', {
        error: `Output validation failed: ${failed.map((check) => `${check.label} (${check.detail})`).join('; ')}.`,
        output_path: output,
        bytes: info.size,
        duration_seconds: media?.durationSeconds ?? 0,
        frames: result.frames,
        validation: JSON.stringify(validation),
        finished_at: nowIso()
      });
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
  } catch (error) {
    setState(job.id, 'error', {
      error: `Validation failed: ${(error as Error).message}`,
      output_path: output,
      finished_at: nowIso()
    });
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
    purpose: 'Scene preview'
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

export function resumeOnBoot(): void {
  db.prepare(
    "UPDATE render_jobs SET state = 'error', error = 'Interrupted by a server restart. Retry the job.', finished_at = ? WHERE state IN ('rendering','encoding','validating')"
  ).run(nowIso());
  pump();
}

export { parseValidation, PROFILES as OUTPUT_PROFILES };
