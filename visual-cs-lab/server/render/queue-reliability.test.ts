/**
 * Render queue reliability: what happens to jobs when the process stops, when a
 * render is duplicated, and when a child process has to be ended.
 *
 * The queue is one sequential worker over SQLite, so these are the failure modes
 * that actually matter: a crash mid-render, two enqueues racing, a hung ffmpeg,
 * and a partial file that must never look finished.
 *
 * Everything runs against a throwaway DATA_DIR/MEDIA_DIR; the real media tree is
 * never touched.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = mkdtempSync(path.join(tmpdir(), 'vcsl-queue-'));
const DATA_DIR = path.join(root, 'data');
const MEDIA_DIR = path.join(root, 'media');
process.env.DATA_DIR = DATA_DIR;
process.env.MEDIA_DIR = MEDIA_DIR;
mkdirSync(MEDIA_DIR, { recursive: true });

const { db } = await import('../db.ts');
const { resumeOnBoot, runFfmpeg, MAX_RECOVERY_ATTEMPTS, createJob, runWatchdogTick, renderWatchdog, lessonBundle } =
  await import('./jobs.ts');
const { lessonIssues } = await import('../scenes.ts');
const { readBranding } = await import('../db.ts');

const stamp = new Date().toISOString();

function lessons(count: number): string[] {
  const rows = db.prepare('SELECT id FROM lessons ORDER BY created_at LIMIT ?').all(count) as { id: string }[];
  assert.ok(rows.length >= count, `the seeded database must have at least ${count} lessons`);
  return rows.map((row) => row.id);
}

/** A seeded lesson that passes the render readiness check (no active job). */
function readyLesson(): string {
  const rows = db.prepare('SELECT id FROM lessons ORDER BY created_at').all() as { id: string }[];
  for (const row of rows) {
    const bundle = lessonBundle(row.id);
    if (!bundle) continue;
    if (lessonIssues(bundle.lesson, bundle.concept, readBranding()).length > 0) continue;
    const active = db
      .prepare("SELECT 1 FROM render_jobs WHERE lesson_id = ? AND state IN ('queued','rendering','encoding','validating')")
      .get(row.id);
    if (!active) return row.id;
  }
  throw new Error('the seeded database has no render-ready lesson');
}

/** A lesson with no job rows at all, for recovery tests that need a clean slate. */
function freeLesson(): string {
  const row = db
    .prepare('SELECT id FROM lessons WHERE id NOT IN (SELECT DISTINCT lesson_id FROM render_jobs) LIMIT 1')
    .get() as { id: string } | undefined;
  assert.ok(row, 'expected a lesson without render jobs');
  return row.id;
}

function insertJob(input: {
  id: string;
  lessonId: string;
  state: string;
  outputPath?: string | null;
  attempts?: number;
}): void {
  db.prepare(
    `INSERT INTO render_jobs (id, lesson_id, preset, width, height, fps, state, progress, log, error, output_path,
       bytes, dedupe_key, created_at, started_at, heartbeat_at, attempts, storyboard_hash, snapshot, expected_frames, expected_seconds)
     VALUES (?, ?, 'hd', 1080, 1920, 30, ?, 0, '', NULL, ?, 0, ?, ?, ?, ?, ?, '', '[]', 0, 0)`
  ).run(
    input.id,
    input.lessonId,
    input.state,
    input.outputPath ?? null,
    `${input.id}-key`,
    stamp,
    input.state === 'queued' ? null : stamp,
    input.state === 'queued' ? null : stamp,
    input.attempts ?? 0
  );
}

function jobRow(id: string): Record<string, any> | undefined {
  return db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as Record<string, any> | undefined;
}

function writeMedia(name: string, contents = 'partial-bytes'): string {
  const file = path.join(MEDIA_DIR, name);
  writeFileSync(file, contents);
  return file;
}

/* ------------------------------------------------- 1. duplicates are impossible */

test('the database refuses a second active render for the same lesson', () => {
  const [lesson] = lessons(1);
  insertJob({ id: 'active-1', lessonId: lesson, state: 'queued' });
  assert.throws(
    () => insertJob({ id: 'active-2', lessonId: lesson, state: 'rendering' }),
    /UNIQUE|constraint/i,
    'two active renders for one lesson must not both exist'
  );
  // A finished render of the same lesson is not "active", so it is still allowed —
  // and the lesson can be rendered again once nothing is in flight.
  db.prepare("UPDATE render_jobs SET state = 'done', output_path = '/tmp/done.mp4', finished_at = ? WHERE id = 'active-1'").run(
    stamp
  );
  insertJob({ id: 'active-3', lessonId: lesson, state: 'queued' });
  assert.ok(jobRow('active-3'));
  db.prepare("DELETE FROM render_jobs WHERE id IN ('active-1','active-3')").run();
});

test('createJob refuses a lesson that already has a render in flight', () => {
  const lesson = readyLesson();
  insertJob({ id: 'in-flight', lessonId: lesson, state: 'encoding' });
  const result = createJob(lesson, 'hd');
  assert.match(String(result.error), /already has a render in progress/);
  assert.equal(result.job, undefined);
  db.prepare("DELETE FROM render_jobs WHERE id = 'in-flight'").run();
});

/* ---------------------------------------------------- 2. crash recovery on boot */

test('boot recovery requeues an interrupted render and keeps the finished ones', () => {
  const [interruptedLesson, doneLesson, errorLesson] = lessons(3);
  insertJob({ id: 'crash-rendering', lessonId: interruptedLesson, state: 'rendering' });
  insertJob({ id: 'crash-encoding', lessonId: doneLesson, state: 'done', outputPath: path.join(MEDIA_DIR, 'crash-encoding.mp4') });
  insertJob({ id: 'crash-error', lessonId: errorLesson, state: 'error' });

  // Files a crash could have left behind.
  const interruptedOutput = writeMedia('crash-rendering.mp4');
  const partial = writeMedia('crash-rendering.partial.mp4');
  const strayPartial = writeMedia('orphan.partial.mp4');
  const finished = writeMedia('crash-encoding.mp4', 'finished-video-bytes');

  const summary = resumeOnBoot({ pump: false });

  const requeued = jobRow('crash-rendering');
  assert.ok(requeued, 'an interrupted render is kept, not deleted');
  assert.equal(requeued.state, 'queued');
  assert.equal(requeued.attempts, 1);
  assert.equal(requeued.heartbeat_at, null);
  assert.match(String(requeued.log), /requeued after a process restart/);
  assert.ok(summary.requeued.includes('crash-rendering'));

  // A half-written encode is never a render: both the partial and the unfinished
  // final file are gone.
  assert.equal(existsSync(partial), false);
  assert.equal(existsSync(interruptedOutput), false);
  assert.equal(existsSync(strayPartial), false, 'leftover partial files are swept at boot');
  assert.equal(summary.partialsRemoved >= 2, true);

  // A failed generation is still not kept as history.
  assert.equal(jobRow('crash-error'), undefined);
  assert.ok(summary.dropped.includes('crash-error'));

  // Completed renders and their files are untouched.
  const done = jobRow('crash-encoding');
  assert.equal(done?.state, 'done');
  assert.equal(done?.output_path, path.join(MEDIA_DIR, 'crash-encoding.mp4'));
  assert.equal(existsSync(finished), true, 'a finished render file must survive boot recovery');
  assert.equal(readFileSync(finished, 'utf8'), 'finished-video-bytes');
});

test('a crash loop gives up after one automatic recovery', () => {
  insertJob({ id: 'crash-loop', lessonId: freeLesson(), state: 'rendering', attempts: MAX_RECOVERY_ATTEMPTS });
  const output = writeMedia('crash-loop.mp4');

  const summary = resumeOnBoot({ pump: false });
  assert.equal(jobRow('crash-loop'), undefined, 'a job that crashed twice is not retried forever');
  assert.ok(summary.dropped.includes('crash-loop'));
  assert.equal(existsSync(output), false);
});

test('recovery never requeues two active jobs for one lesson', () => {
  const lesson = freeLesson();
  // A second active row for the same lesson cannot be inserted today (unique
  // index), so simulate an older database by dropping the index for this check.
  db.exec('DROP INDEX IF EXISTS render_jobs_one_active_per_lesson');
  insertJob({ id: 'dup-a', lessonId: lesson, state: 'rendering' });
  insertJob({ id: 'dup-b', lessonId: lesson, state: 'validating' });
  const summary = resumeOnBoot({ pump: false });
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM render_jobs WHERE lesson_id = ? AND state IN ('queued','rendering','encoding','validating')")
    .get(lesson) as { n: number };
  assert.equal(active.n, 1, 'only one active row may survive recovery for a lesson');
  assert.equal(summary.dropped.length, 1);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS render_jobs_one_active_per_lesson
       ON render_jobs(lesson_id) WHERE state IN ('queued','rendering','encoding','validating')`
  );
});

/* --------------------------------------------------------- 3. hung child process */

test('a stuck ffmpeg call is ended by its timeout instead of blocking the queue', async () => {
  const started = Date.now();
  const result = await runFfmpeg(
    [
      '-hide_banner',
      '-f', 'lavfi',
      // `-re` paces the synthetic input at real time, so this command really
      // would run for two minutes: only the timeout can end it.
      '-re',
      '-i', 'testsrc=duration=120:size=320x240:rate=30',
      '-f', 'null',
      '-'
    ],
    { timeoutMs: 700 }
  );
  const elapsed = Date.now() - started;
  assert.equal(result.code, 124, 'a timed-out run reports 124');
  assert.match(result.stderr, /timed out/);
  assert.ok(elapsed < 20_000, `the child must be killed promptly, took ${elapsed}ms`);
});

test('a stalled heartbeat aborts the running job through the watchdog', () => {
  const running = renderWatchdog.register({ id: 'watchdog-probe', lessonId: 'lesson-probe', now: 0 });
  running.heartbeatAt = 0;
  running.stageStartedAt = 0;

  const stalls = runWatchdogTick(renderWatchdog.limits.stallMs + 1);
  const probe = stalls.find((stall) => stall.id === 'watchdog-probe');
  assert.ok(probe, 'the probe job must be reported as stalled');
  assert.equal(probe.reason, 'heartbeat');
  assert.equal(running.abort.signal.aborted, true, 'the encode is aborted, which ends its child process');
  assert.match(String(renderWatchdog.abortReason('watchdog-probe')), /watchdog:/);
  renderWatchdog.finish('watchdog-probe');
});

test('the media directory holds no partial encodes after recovery', () => {
  const leftovers = readdirSync(MEDIA_DIR).filter((entry) => entry.endsWith('.partial.mp4'));
  assert.deepEqual(leftovers, [], 'a partial encode must never be left behind');
});
