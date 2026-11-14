# Render queue reliability

Status: implemented in this branch. Applies to `visual-cs-lab/server/render/jobs.ts` and
`visual-cs-lab/server/render/watchdog.ts`.

## 1. The queue as it is

There is **one** render worker, inside the API process. It is a single sequential loop over the
SQLite `render_jobs` table:

```
POST /api/renders ──► INSERT render_jobs (state = 'queued')
                                  │
                          pump() │ one job at a time
                                  ▼
   ┌───────────┐  claim  ┌───────────┐ frames ┌──────────┐ validate ┌────────────┐
   │  queued   │────────►│ rendering │───────►│ encoding │─────────►│ validating │
   └───────────┘         └───────────┘        └──────────┘          └────────────┘
                                                                          │ ok
                                                                          ▼
                                                                      ┌──────┐
                                                                      │ done │
                                                                      └──────┘
```

Job states and what they mean:

| State | Meaning | Who sets it |
| --- | --- | --- |
| `queued` | Accepted, waiting for the worker. No file exists. | `createJob`, `retryJob`, boot recovery |
| `rendering` | Animate frames and stream them into ffmpeg's stdin. | `renderJob` (atomic claim) |
| `encoding` | All frames written; ffmpeg is flushing/closing the file. | `runClaimedJob` |
| `validating` | The encoded file is probed, fully decoded and sampled. | `runClaimedJob` |
| `done` | Validated, stored, registered as the lesson's video asset. | `runClaimedJob` |
| `cancelled` | Stopped by a person before completion. | `cancelJob` / encode abort |
| `error` | Terminal failure. **Not kept**: the row and files are removed. | `failJob` |

Failed renders are deliberately not stored (existing product decision): `failJob()` records the
reason in memory (`recentFailures()`), deletes the partial and final files, and deletes the row. The
Studio reads the memory list once and shows it as a notice.

**Why no distributed queue.** The workload is one encode at a time on one machine: frame drawing
needs a canvas and the encoder is CPU-bound, so parallelism would only make each render slower.
SQLite plus an in-process worker is the correct design at this scale. The reliability gap was not
scale — it was that a single stuck encode blocked every job behind it, with no way to notice. That
is what the watchdog closes. If the service is ever scaled to several processes, revisit this
document and use a claim table with lease expiry (or a real broker) *instead of* adding a second
in-process worker.

## 2. What was added

### 2.1 Heartbeat per job

`render_jobs.heartbeat_at` (additive migration) is refreshed:

- when the job is claimed (`started_at` = `heartbeat_at` = now),
- on every progress update — each batch of 15 written frames, in the same `UPDATE` that stores
  `progress`/`frames` (no extra write),
- at each stage transition (`markStage`), and
- between phases of validation (probe, full decode, each sampled frame).

The heartbeat is the only signal that the worker is alive and moving; it is never derived from
`created_at`, so a long but healthy encode is never mistaken for a stall.

### 2.2 The watchdog

`RenderWatchdog` keeps an in-memory entry per running job (stage, stage start, heartbeat, abort
controller) and answers one question: *has this job stopped making progress?*

```
stall  = now - heartbeat_at > RENDER_STALL_TIMEOUT_MS
       OR (stage is rendering/encoding and now - stage_started > RENDER_ENCODE_TIMEOUT_MS)
       OR (stage is validating          and now - stage_started > RENDER_VALIDATE_TIMEOUT_MS)
```

On a stall the watchdog **aborts** the job: the abort signal ends the ffmpeg child (SIGTERM, then
SIGKILL after 3 s), the pending frame write rejects, the encode returns a failure, and the normal
failure path removes the row and any partial file. The queue then continues with the next job.
A job is reported once — a job already being aborted is skipped on later ticks.

`startWatchdog()` is called once at boot (`server/index.ts`). It never touches `done` jobs, and it
cannot kill a container: it only ends the child process of a job the process itself started.

### 2.3 Configurable timeouts

All values are environment variables, read at process start:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RENDER_STALL_TIMEOUT_MS` | `120000` (2 min) | Silence that counts as a stall, any stage |
| `RENDER_ENCODE_TIMEOUT_MS` | `1800000` (30 min) | Wall-clock ceiling for one encode |
| `RENDER_VALIDATE_TIMEOUT_MS` | `900000` (15 min) | Ceiling for probe + decode + sampling |
| `RENDER_HEARTBEAT_MS` | `5000` | Documented heartbeat cadence (informational; the worker heartbeats per frame batch) |
| `RENDER_WATCHDOG_INTERVAL_MS` | `5000` | How often the watchdog looks |

Invalid or non-positive values fall back to the defaults, so a typo cannot disable the watchdog.
A slow machine (4K on a small box) can raise `RENDER_ENCODE_TIMEOUT_MS` without touching code.

### 2.4 One render per job — three independent guards

1. **Database**: a partial unique index
   `render_jobs_one_active_per_lesson ON render_jobs(lesson_id) WHERE state IN ('queued','rendering','encoding','validating')`
   makes two active jobs for one lesson impossible, even from two processes or two browser tabs.
   Created at boot; if an older database already contained duplicates the index is skipped with a
   warning instead of deleting history (verify with `PRAGMA index_list(render_jobs)`).
2. **Atomic claim**: a job is only started by
   `UPDATE ... SET state='rendering' WHERE id = ? AND state = 'queued'`; if `changes === 0` the job
   was already claimed and this runner returns immediately.
3. **In-process registry**: `renderWatchdog.has(id)` prevents re-entry, and the pump itself is a
   single loop (`pumpingState.active`).

### 2.5 Child-process handling

Every ffmpeg invocation is now bounded:

- `runFfmpeg(args, { timeoutMs })` kills the child on timeout and returns exit code `124` with
  `ffmpeg timed out after …` in stderr (default ceiling: `RENDER_VALIDATE_TIMEOUT_MS`; probes are
  capped at 2 min, frame extraction at 60 s).
- The encoder used for the render itself is ended through `terminateChild()`: stdin closed,
  SIGTERM, then SIGKILL after 3 s if it is still alive. The timer is `unref`'d and cleared on
  close, so it never keeps the process alive and never leaks a stray kill.

### 2.6 Partial files can never look finished

The encoder writes `<job-id>.partial.mp4`. Only a successful encode is renamed to `<job-id>.mp4`
(atomic inside one directory). Validation runs on the renamed file, and `output_path` /
`state = 'done'` are written only after every check passes. On any failure both files are removed.
At boot, every `*.partial.mp4` in `MEDIA_DIR` is deleted, and nothing references one.

### 2.7 Recovery after a process restart

`resumeOnBoot()` (called from `server/index.ts` before `listen`) now:

1. deletes leftover `*.partial.mp4` files;
2. **requeues** jobs that were in `rendering` / `encoding` / `validating`, once
   (`attempts + 1`, `heartbeat_at` cleared, a `[recovery] requeued after a process restart` log
   line). This is new: an interrupted render used to be deleted, so a restart silently lost the
   video;
3. drops a recovered job instead of requeuing when it has already used its one automatic recovery
   (`MAX_RECOVERY_ATTEMPTS = 1`) or when its lesson already has another active job (protects the
   unique index and prevents crash loops);
4. still drops rows in `error` (existing policy: failures are not history);
5. leaves `done` rows and their MP4s completely untouched — verified by test.

A manual retry (`POST /api/renders/:id/retry`) resets `attempts`, `heartbeat_at`, `frames` and the
log, so it is a genuinely fresh attempt and is safe to repeat: the claim + the partial-file rule
make it idempotent (a retried job either produces one validated file or no file at all).

## 3. Verification

Automated (`npm run test:queue`):

| Test | What it proves |
| --- | --- |
| `watchdog.test.ts` (8) | fresh heartbeat is not a stall; silence is; stage ceilings are per-stage; stage change resets the clock; `tick()` aborts exactly the stalled job, once; a job cannot register twice; env parsing with fallbacks; `clear()` aborts everything |
| `queue-reliability.test.ts` (8) | DB refuses two active renders per lesson; `createJob` refuses an in-flight lesson; boot recovery requeues an interrupted job, sweeps partials, drops a crash-looped job and an `error` row, and keeps the finished MP4 bytes; recovery never leaves two active rows for one lesson; a stuck ffmpeg is ended by its timeout (real child process, exit `124`); a stalled heartbeat aborts the real running entry; no partial file is left in `MEDIA_DIR` |

Also run end to end by hand on this branch (real ffmpeg, throwaway data directory — not the
production data):

- A `preview` render of a seeded lesson completed in **58.5 s**: 2340 frames, 2,048,859-byte MP4,
  **17/17 quality checks**, `state = done`, video asset `ready`, zero `*.partial.mp4` files left.
- With `RENDER_STALL_TIMEOUT_MS=1`, the watchdog aborted that same render **0.7 s** after queueing:
  the ffmpeg child was killed, the row was removed, `recentFailures()` held
  `Render failed: watchdog: no progress for 0s in rendering`, and no file was left behind.

What was **not** verified: a stall induced by a real disk/IO hang (the timeout path was exercised
through a real long-running child process instead), and recovery from an actual container OOM kill
(recovery was exercised by inserting the exact rows such a kill leaves behind).

## 4. Operating it

- **Is a job stuck?** `SELECT id, state, progress, started_at, heartbeat_at FROM render_jobs WHERE state IN
  ('rendering','encoding','validating');` — a `heartbeat_at` older than
  `RENDER_STALL_TIMEOUT_MS` means the watchdog is about to end it (or already did).
- **Why did a render fail?** Failed rows are removed by design. `docker compose logs` shows
  `watchdog: … — aborting this render`, and the Studio shows the in-memory failure notice once.
- **Raise a limit** for a slow host: set `RENDER_ENCODE_TIMEOUT_MS`/`RENDER_VALIDATE_TIMEOUT_MS` in
  the environment, then restart the service.
- **Never** delete rows in `done`, and never delete files under `MEDIA_DIR` that a `done` row
  points at — they are the only copy of the videos (see `backup-and-recovery.md`).

## 5. Known limits

- Cancelling a **queued** job is immediate; cancelling a running one stops it at the next frame or
  at the abort, so the row can briefly still be in a running state.
- `recentFailures()` is in memory: a restart forgets the last failure reasons (by design — nothing
  failed is stored).
- The watchdog protects against a hung child or a hung loop. It cannot help if the whole process
  is frozen (then no tick runs); the container health check is the layer for that.
- `RENDER_HEARTBEAT_MS` is documented but not used to throttle writes: heartbeats ride on the
  existing progress updates, which are cheaper than a separate timer.
