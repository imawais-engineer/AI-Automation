/**
 * Render queue watchdog: liveness tracking for the in-process render worker.
 *
 * The queue is deliberately still one sequential worker over SQLite (see
 * docs/operations/render-queue-reliability.md). What it lacked was a way to
 * notice that the worker had stopped making progress — a hung ffmpeg, a stalled
 * pipe write, a validation pass that never returns — because one stuck job
 * blocks every job behind it.
 *
 * This module holds only the liveness decision and the abort wiring; it never
 * touches the database or spawns processes, so the rules can be tested directly.
 * `jobs.ts` registers each job it starts here, refreshes its heartbeat as frames
 * are written, and turns an abort into the same failure path a broken encode
 * takes.
 */

import type { RenderState } from './jobs.ts';

export type WatchdogLimits = {
  /** How often the worker's heartbeat is refreshed while frames are written. */
  heartbeatMs: number;
  /** Silence longer than this means the worker is stuck, whatever the stage. */
  stallMs: number;
  /** Wall-clock ceiling for one encoding pass. */
  encodeMs: number;
  /** Wall-clock ceiling for the post-encode validation pass. */
  validateMs: number;
  /** How often the interval watchdog looks for stalled jobs. */
  intervalMs: number;
};

function envMs(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Timeouts come from the environment so a slow machine can be given more room. */
export function watchdogLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): WatchdogLimits {
  return {
    heartbeatMs: envMs('RENDER_HEARTBEAT_MS', 5_000, env),
    stallMs: envMs('RENDER_STALL_TIMEOUT_MS', 120_000, env),
    encodeMs: envMs('RENDER_ENCODE_TIMEOUT_MS', 30 * 60_000, env),
    validateMs: envMs('RENDER_VALIDATE_TIMEOUT_MS', 15 * 60_000, env),
    intervalMs: envMs('RENDER_WATCHDOG_INTERVAL_MS', 5_000, env)
  };
}

export type StallReason = 'heartbeat' | 'encode-timeout' | 'validation-timeout';

export type RunningJob = {
  id: string;
  lessonId: string;
  stage: RenderState;
  /** When the job was claimed and when its current stage began. */
  startedAt: number;
  stageStartedAt: number;
  /** Last frame/validation progress seen. */
  heartbeatAt: number;
  /** Set when the watchdog gives up on this job. */
  abortReason: string | null;
  abort: AbortController;
};

export type Stall = { id: string; stage: RenderState; reason: StallReason; detail: string };

/**
 * Decides whether one running job has stopped making progress.
 *
 * A stage transition resets the heartbeat, so a long encode that keeps writing
 * frames is never called stalled; only genuine silence (or a wall-clock ceiling
 * for the stage) is.
 */
export function assessRunningJob(job: RunningJob, now: number, limits: WatchdogLimits): Stall | null {
  const idleMs = now - job.heartbeatAt;
  if (idleMs > limits.stallMs) {
    return {
      id: job.id,
      stage: job.stage,
      reason: 'heartbeat',
      detail: `no progress for ${Math.round(idleMs / 1000)}s in ${job.stage} (limit ${Math.round(limits.stallMs / 1000)}s)`
    };
  }
  const stageMs = now - job.stageStartedAt;
  const ceiling = job.stage === 'validating' ? limits.validateMs : limits.encodeMs;
  if (stageMs > ceiling) {
    return {
      id: job.id,
      stage: job.stage,
      reason: job.stage === 'validating' ? 'validation-timeout' : 'encode-timeout',
      detail: `${job.stage} ran for ${Math.round(stageMs / 1000)}s (limit ${Math.round(ceiling / 1000)}s)`
    };
  }
  return null;
}

/** In-memory registry of the jobs this process is actually working on. */
export class RenderWatchdog {
  private jobs = new Map<string, RunningJob>();

  constructor(public readonly limits: WatchdogLimits = watchdogLimitsFromEnv()) {}

  /** Registers a claimed job. One entry per job id — a second claim never runs. */
  register(input: { id: string; lessonId: string; stage?: RenderState; now?: number }): RunningJob {
    const now = input.now ?? Date.now();
    const existing = this.jobs.get(input.id);
    if (existing) return existing;
    const job: RunningJob = {
      id: input.id,
      lessonId: input.lessonId,
      stage: input.stage ?? 'rendering',
      startedAt: now,
      stageStartedAt: now,
      heartbeatAt: now,
      abortReason: null,
      abort: new AbortController()
    };
    this.jobs.set(job.id, job);
    return job;
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  get(id: string): RunningJob | undefined {
    return this.jobs.get(id);
  }

  running(): RunningJob[] {
    return [...this.jobs.values()];
  }

  /** Records progress: a written frame, or the start of another stage. */
  heartbeat(id: string, now = Date.now()): void {
    const job = this.jobs.get(id);
    if (job) job.heartbeatAt = now;
  }

  markStage(id: string, stage: RenderState, now = Date.now()): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.stage = stage;
    job.stageStartedAt = now;
    job.heartbeatAt = now;
  }

  finish(id: string): void {
    this.jobs.delete(id);
  }

  /** Why the watchdog gave up on a job, if it did. */
  abortReason(id: string): string | null {
    return this.jobs.get(id)?.abortReason ?? null;
  }

  /**
   * Stalled jobs that have not been aborted yet. A job being stopped keeps
   * running for a moment while its child process is reaped; reporting it again
   * every tick would only repeat the abort and the log line.
   */
  stalled(now = Date.now()): Stall[] {
    const out: Stall[] = [];
    for (const job of this.jobs.values()) {
      if (job.abort.signal.aborted) continue;
      const stall = assessRunningJob(job, now, this.limits);
      if (stall) out.push(stall);
    }
    return out;
  }

  /**
   * Aborts every stalled job's child process and reports what was stopped.
   * Aborting is safe to repeat: a job is only registered once, and the encode
   * turns the abort into an ordinary failure the queue can move past.
   */
  tick(now = Date.now()): Stall[] {
    const stalls = this.stalled(now);
    for (const stall of stalls) {
      const job = this.jobs.get(stall.id);
      if (!job || job.abort.signal.aborted) continue;
      job.abortReason = `watchdog: ${stall.detail}`;
      job.abort.abort(new Error(job.abortReason));
    }
    return stalls;
  }

  clear(): void {
    for (const job of this.jobs.values()) job.abort.abort(new Error('watchdog cleared'));
    this.jobs.clear();
  }
}
