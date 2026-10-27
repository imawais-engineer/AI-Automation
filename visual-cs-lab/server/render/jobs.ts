import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import ffmpegPath from 'ffmpeg-static';

import { db, newId, nowIso, readBrand, type Brand } from '../db.ts';
import { lessonIssues, safeJson, type ConceptInput, type LessonInput, type Scene } from '../scenes.ts';
import { drawFrame, totalDuration } from './draw.ts';

export type Preset = 'preview' | 'hd' | '4k';

export const PRESETS: Record<Preset, { width: number; height: number; fps: number; label: string }> = {
  preview: { width: 540, height: 960, fps: 24, label: 'Low-res preview 540×960' },
  hd: { width: 1080, height: 1920, fps: 30, label: 'Vertical HD 1080×1920' },
  '4k': { width: 2160, height: 3840, fps: 30, label: 'Portrait 4K 2160×3840' }
};

const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/visual-cs-lab/media';
mkdirSync(MEDIA_DIR, { recursive: true });

export type RenderJob = {
  id: string;
  lesson_id: string;
  preset: Preset;
  width: number;
  height: number;
  fps: number;
  state: 'queued' | 'rendering' | 'encoding' | 'validating' | 'done' | 'error';
  progress: number;
  log: string;
  error: string | null;
  output_path: string | null;
  bytes: number;
  duration_seconds: number;
  frames: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function lessonBundle(lessonId: string) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as
    | (LessonInput & { scenes: string })
    | undefined;
  if (!lesson) return null;
  const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(lesson.concept_id) as
    | ConceptInput
    | undefined;
  if (!concept) return null;
  return { lesson, concept };
}

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

export function createJob(lessonId: string, preset: Preset): { job?: RenderJob; error?: string } {
  const bundle = lessonBundle(lessonId);
  if (!bundle) return { error: 'Lesson not found.' };
  if (!PRESETS[preset]) return { error: 'Unknown export preset.' };

  const issues = lessonIssues(bundle.lesson, bundle.concept);
  if (issues.length > 0) {
    return { error: `The lesson is not ready to render yet: ${issues.join(' ')}` };
  }

  const active = db
    .prepare(
      "SELECT id FROM render_jobs WHERE lesson_id = ? AND preset = ? AND state IN ('queued','rendering','encoding','validating')"
    )
    .get(lessonId, preset) as { id: string } | undefined;
  if (active) return { error: `This lesson already has a ${preset} render in progress (${active.id}).` };

  const spec = PRESETS[preset];
  const id = newId();
  db.prepare(
    `INSERT INTO render_jobs (id, lesson_id, preset, width, height, fps, state, progress, log, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, '', ?, ?)`
  ).run(id, lessonId, preset, spec.width, spec.height, spec.fps, `${lessonId}:${preset}`, nowIso());

  pump();
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as RenderJob;
  return { job };
}

export function retryJob(id: string): { job?: RenderJob; error?: string } {
  const job = db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as RenderJob | undefined;
  if (!job) return { error: 'Render job not found.' };
  if (job.state !== 'error') return { error: 'Only failed jobs can be retried.' };
  db.prepare(
    "UPDATE render_jobs SET state = 'queued', progress = 0, error = NULL, log = '', started_at = NULL, finished_at = NULL WHERE id = ?"
  ).run(id);
  pump();
  return { job: db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as RenderJob };
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

function setState(id: string, state: RenderJob['state'], extra: Record<string, unknown> = {}) {
  const fields = Object.keys(extra);
  const assignments = ['state = ?', ...fields.map((field) => `${field} = ?`)].join(', ');
  db.prepare(`UPDATE render_jobs SET ${assignments} WHERE id = ?`).run(
    state,
    ...fields.map((field) => extra[field] as never),
    id
  );
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    proc.on('error', (error) => resolve({ code: 1, stderr: String(error) }));
  });
}

async function renderJob(job: RenderJob): Promise<void> {
  const started = nowIso();
  setState(job.id, 'rendering', { started_at: started, error: null, progress: 0, log: '' });

  const bundle = lessonBundle(job.lesson_id);
  if (!bundle) {
    setState(job.id, 'error', { error: 'The lesson was deleted before rendering.', finished_at: nowIso() });
    return;
  }

  const brand = readBrand();
  // Render the stored storyboard so edited timings and captions reach the file.
  const scenes = scenesFor(job.lesson_id) || [];
  if (scenes.length === 0) {
    setState(job.id, 'error', {
      error: 'The lesson has no storyboard to render. Build the storyboard first.',
      finished_at: nowIso()
    });
    return;
  }
  const expectedMs = totalDuration(scenes);
  const totalFrames = Math.max(1, Math.round((expectedMs / 1000) * job.fps));
  appendLog(job.id, `${scenes.length} scenes, ${totalFrames} frames at ${job.width}×${job.height} ${job.fps}fps`);

  const output = path.join(MEDIA_DIR, `${job.id}.mp4`);
  const canvas = createCanvas(job.width, job.height);
  const ctx = canvas.getContext('2d');

  const encoder = spawn(
    ffmpegPath as string,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${job.width}x${job.height}`,
      '-r', String(job.fps),
      '-i', '-',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', job.preset === '4k' ? '21' : '20',
      '-pix_fmt', 'yuv420p',
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
      if (encoder.stdin.write(buffer)) resolve();
      else encoder.stdin.once('drain', () => resolve());
      encoder.stdin.once('error', reject);
    });

  let frameIndex = 0;
  let sceneIndex = 0;
  const sceneStartFrame: number[] = [];
  let acc = 0;
  for (const scene of scenes) {
    sceneStartFrame.push(acc);
    acc += Math.max(1, Math.round((scene.durationMs / 1000) * job.fps));
  }

  try {
    for (sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
      const scene = scenes[sceneIndex];
      const frames = Math.max(1, Math.round((scene.durationMs / 1000) * job.fps));
      for (let i = 0; i < frames; i++) {
        const elapsed = (i / job.fps) * 1000;
        drawFrame(ctx, scene, sceneIndex, scenes.length, elapsed, brand as Brand, {
          width: job.width,
          height: job.height
        });
        const image = ctx.getImageData(0, 0, job.width, job.height);
        await write(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));
        frameIndex++;
        if (frameIndex % 15 === 0) {
          const pct = Math.min(96, (frameIndex / totalFrames) * 100);
          db.prepare('UPDATE render_jobs SET progress = ?, frames = ? WHERE id = ?').run(pct, frameIndex, job.id);
        }
      }
    }

    setState(job.id, 'encoding', { progress: 97, frames: frameIndex });
    appendLog(job.id, `frames written (${frameIndex}), finishing encode`);
    encoder.stdin.end();

    const code = await exited;
    if (code !== 0) {
      setState(job.id, 'error', {
        error: `ffmpeg exited with code ${code}: ${encoderError.trim().slice(-300) || 'no output'}`,
        finished_at: nowIso()
      });
      return;
    }

    setState(job.id, 'validating', { progress: 99 });
    const probe = await runFfmpeg(['-hide_banner', '-i', output]);
    const dimension = probe.stderr.match(/(\d{2,5})x(\d{2,5})/);
    const durationMatch = probe.stderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
    const stat = await import('node:fs/promises').then((fs) => fs.stat(output));
    const problems: string[] = [];
    if (stat.size === 0) problems.push('the file is empty');
    if (!dimension) problems.push('the output resolution could not be read');
    else if (Number(dimension[1]) !== job.width || Number(dimension[2]) !== job.height) {
      problems.push(`the output is ${dimension[1]}×${dimension[2]} instead of ${job.width}×${job.height}`);
    }
    let seconds = 0;
    if (durationMatch) {
      seconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
      const expectedSeconds = expectedMs / 1000;
      if (Math.abs(seconds - expectedSeconds) > 0.75) {
        problems.push(`duration ${seconds.toFixed(2)}s does not match the ${expectedSeconds.toFixed(2)}s storyboard`);
      }
    } else {
      problems.push('the output duration could not be read');
    }

    if (problems.length > 0) {
      setState(job.id, 'error', {
        error: `Output validation failed: ${problems.join('; ')}.`,
        output_path: output,
        bytes: stat.size,
        duration_seconds: seconds,
        finished_at: nowIso()
      });
      return;
    }

    appendLog(job.id, `validated ${dimension![1]}×${dimension![2]} ${seconds.toFixed(2)}s ${(stat.size / 1048576).toFixed(2)}MB`);
    setState(job.id, 'done', {
      progress: 100,
      output_path: output,
      bytes: stat.size,
      duration_seconds: seconds,
      frames: frameIndex,
      finished_at: nowIso()
    });
  } catch (error) {
    try {
      encoder.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    setState(job.id, 'error', {
      error: `Render failed: ${(error as Error).message}`,
      finished_at: nowIso()
    });
  }
}

/** A single rendered frame, used for real storyboard thumbnails. */
export function thumbnail(lessonId: string, sceneIndex: number, width = 540): Buffer | null {
  const scenes = scenesFor(lessonId);
  if (!scenes) return null;
  const scene = scenes[sceneIndex];
  if (!scene) return null;
  const height = Math.round((width / 9) * 16);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, scene, sceneIndex, scenes.length, scene.durationMs * 0.5, readBrand() as Brand, {
    width,
    height
  });
  return canvas.encodeSync('png');
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
