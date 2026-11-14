/**
 * Render watchdog rules: what counts as a stall, and what the watchdog does
 * about it. These are the decisions that keep one hung encode from blocking the
 * whole sequential queue, so they are tested directly rather than only through a
 * full render.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderWatchdog, assessRunningJob, watchdogLimitsFromEnv, type RunningJob } from './watchdog.ts';

const LIMITS = { heartbeatMs: 1_000, stallMs: 10_000, encodeMs: 60_000, validateMs: 30_000, intervalMs: 5_000 };

function running(overrides: Partial<RunningJob> = {}): RunningJob {
  const now = 1_000_000;
  return {
    id: 'job-1',
    lessonId: 'lesson-1',
    stage: 'rendering',
    startedAt: now,
    stageStartedAt: now,
    heartbeatAt: now,
    abortReason: null,
    abort: new AbortController(),
    ...overrides
  };
}

test('a job that keeps writing frames is never called stalled', () => {
  const job = running();
  // Heartbeat refreshed a second ago: healthy.
  assert.equal(assessRunningJob(job, job.heartbeatAt + 1_000, LIMITS), null);
  // A minute of encoding is healthy too, as long as frames are still landing.
  const busy = { ...job, heartbeatAt: job.stageStartedAt + 59_000 };
  assert.equal(assessRunningJob(busy, job.stageStartedAt + 60_000 - 1, LIMITS), null);
});

test('silence longer than the stall window is a stall, whatever the stage', () => {
  for (const stage of ['rendering', 'encoding', 'validating'] as const) {
    const job = running({ stage, heartbeatAt: 1_000_000 + 500_000 });
    const stall = assessRunningJob(job, job.heartbeatAt + LIMITS.stallMs + 1, LIMITS);
    assert.ok(stall, `${stage} must be stalled after ${LIMITS.stallMs}ms of silence`);
    assert.equal(stall.reason, 'heartbeat');
    assert.equal(stall.stage, stage);
    assert.match(stall.detail, /no progress/);
  }
});

test('a stage that outlives its ceiling is a timeout even with a live heartbeat', () => {
  // Encoding past RENDER_ENCODE_TIMEOUT_MS.
  const encoding = running({ stage: 'encoding', heartbeatAt: 1_100_000, stageStartedAt: 1_000_000 });
  const encodeStall = assessRunningJob(encoding, 1_100_000, LIMITS);
  assert.equal(encodeStall?.reason, 'encode-timeout');

  // Validation has its own, shorter ceiling.
  const validating = running({ stage: 'validating', heartbeatAt: 1_040_000, stageStartedAt: 1_000_000 });
  const validateStall = assessRunningJob(validating, 1_040_000, LIMITS);
  assert.equal(validateStall?.reason, 'validation-timeout');
});

test('stage changes reset the ceiling and the heartbeat', () => {
  const watchdog = new RenderWatchdog(LIMITS);
  watchdog.register({ id: 'job-9', lessonId: 'lesson-9', now: 1_000_000 });
  watchdog.markStage('job-9', 'validating', 1_200_000);
  const job = watchdog.get('job-9')!;
  assert.equal(job.stage, 'validating');
  assert.equal(job.stageStartedAt, 1_200_000);
  // The 200s spent encoding does not count against validation.
  assert.equal(assessRunningJob(job, 1_210_000, LIMITS), null);
  watchdog.finish('job-9');
  assert.equal(watchdog.has('job-9'), false);
});

test('tick aborts exactly the stalled job and reports it once', () => {
  const watchdog = new RenderWatchdog(LIMITS);
  const healthy = watchdog.register({ id: 'healthy', lessonId: 'lesson-a', now: 1_000_000 });
  const stuck = watchdog.register({ id: 'stuck', lessonId: 'lesson-b', now: 1_000_000 });

  const at = 1_000_000 + LIMITS.stallMs + 1;
  watchdog.heartbeat('healthy', at);

  const stalls = watchdog.tick(at);
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].id, 'stuck');
  assert.equal(stuck.abort.signal.aborted, true);
  assert.equal(healthy.abort.signal.aborted, false);
  assert.match(String(watchdog.abortReason('stuck')), /^watchdog: /);

  // A second tick must not report (or abort) the same job again.
  assert.deepEqual(watchdog.tick(at + 1), []);
});

test('a registered job is never registered twice, so it cannot render twice', () => {
  const watchdog = new RenderWatchdog(LIMITS);
  const first = watchdog.register({ id: 'job-7', lessonId: 'lesson-7', now: 1_000_000 });
  const second = watchdog.register({ id: 'job-7', lessonId: 'lesson-7', now: 1_000_000 });
  assert.equal(first, second);
  assert.equal(watchdog.running().length, 1);
});

test('timeouts are configurable and fall back to documented defaults', () => {
  const configured = watchdogLimitsFromEnv({
    RENDER_STALL_TIMEOUT_MS: '5000',
    RENDER_ENCODE_TIMEOUT_MS: '900000',
    RENDER_VALIDATE_TIMEOUT_MS: '60000',
    RENDER_HEARTBEAT_MS: '250',
    RENDER_WATCHDOG_INTERVAL_MS: '1000'
  });
  assert.equal(configured.stallMs, 5_000);
  assert.equal(configured.encodeMs, 900_000);
  assert.equal(configured.validateMs, 60_000);

  const defaults = watchdogLimitsFromEnv({});
  assert.deepEqual(defaults, {
    heartbeatMs: 5_000,
    stallMs: 120_000,
    encodeMs: 30 * 60_000,
    validateMs: 15 * 60_000,
    intervalMs: 5_000
  });

  // Nonsense values are ignored rather than turning the watchdog into a no-op.
  const nonsense = watchdogLimitsFromEnv({ RENDER_STALL_TIMEOUT_MS: '0', RENDER_ENCODE_TIMEOUT_MS: 'abc' });
  assert.equal(nonsense.stallMs, defaults.stallMs);
  assert.equal(nonsense.encodeMs, defaults.encodeMs);
});

test('clear() aborts everything it was tracking', () => {
  const watchdog = new RenderWatchdog(LIMITS);
  const job = watchdog.register({ id: 'a', lessonId: 'l-a' });
  watchdog.clear();
  assert.equal(job.abort.signal.aborted, true);
  assert.equal(watchdog.running().length, 0);
});
