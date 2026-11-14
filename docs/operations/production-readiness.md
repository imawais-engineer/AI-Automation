# Production readiness — engineering report

Branch: `ai-video-shorts` (`77a647f` + this work). Date: 2026-11-14.
Scope: reliability, regression protection, backup/recovery, security review. **No feature work, no
branch consolidation, no data migration, no account changes.**

> **Extended later the same day:** the production image build, a real backup → restore → boot drill
> and a real crash-recovery drill (SIGKILL mid-encode) are now verified. See
> [pre-consolidation-verification.md](pre-consolidation-verification.md), which supersedes the
> "not verified" rows in §4 and §5 below.

## 1. Changes in this branch

| Area | File(s) | What changed |
| --- | --- | --- |
| App composition | `server/app.ts` (new), `server/index.ts` | The API is now built by `createApiApp()` with the same middleware and router order as before, so the contract tests exercise the real application. Added: JSON 404 for unknown `/api` paths, a JSON error handler that keeps body-parser 4xx statuses and hides server details, and `x-powered-by` disabled. |
| Render liveness | `server/render/watchdog.ts` (new) | Heartbeat/stage tracking, stall assessment, configurable timeouts, abort of stalled jobs, one registration per job. |
| Render queue | `server/render/jobs.ts` | Heartbeat writes, atomic claim, one-active-render guards, `.partial.mp4` + rename, timeouts on every ffmpeg call, SIGTERM→SIGKILL child termination, boot recovery that requeues an interrupted render once, partial-file sweep. |
| Database | `server/db.ts` | Additive columns `render_jobs.heartbeat_at`, `render_jobs.attempts`; partial unique index `render_jobs_one_active_per_lesson`. Existing rows untouched. |
| Backup | `server/ops/backup.ts`, `server/ops/backup-cli.ts` (new) | Consistent SQLite snapshot, atomic set creation, manifest with hashes/counts, verification, retention, safe restore. |
| Tests | `server/routes/api-contract.test.ts`, `server/render/watchdog.test.ts`, `server/render/queue-reliability.test.ts`, `server/ops/backup.test.ts`, `server/ui/regression.test.ts` (all new) | 53 tests (see §3). |
| Tooling | `package.json` | `test:api`, `test:queue`, `test:backup`, `test:ui`, `backup` scripts; `npm test` covers the new suites. Dev dependencies: `jsdom@25`, `@types/jsdom` (no browser download, no E2E framework). |
| Docs | `docs/operations/*` | This report plus render queue, backup, security, branch consolidation. |

Behaviour deliberately **not** changed: render states, failure policy (failed renders are not
stored), the sequential in-process queue, the 3 MB JSON limit, the permission model, session
handling, every existing route's method/path/gate.

## 2. Git verification

See `docs/operations/branch-consolidation.md` for the full analysis. Summary: remote `main` is one
commit newer than the merge base (`9c54e75`, a one-line Upwork URL change in the old README); the
application branch is 47 commits ahead and its local ref was two commits behind its own remote. No
branch was modified.

## 3. Test results (run in the app container, this branch)

| Command | Result |
| --- | --- |
| `npm test` | **202 tests, 202 pass, 0 fail**, 5.65 s |
| `npm run test:api` | 17 / 17 pass — 95 route entries, 84 protected |
| `npm run test:queue` | 16 / 16 pass — 8 watchdog rules + 8 queue/recovery/child-process |
| `npm run test:backup` | 9 / 9 pass — create, verify, damaged DB, damaged media, restore, retention, refusal paths |
| `npm run test:ui` | 11 / 11 pass — Home, Explore, Roadmaps, Roadmap detail, lesson reader, My Learning (anonymous + signed in), Sign-in submit, Studio gate (anonymous + learner), content editor, rendering dashboard |
| `npm run typecheck` | clean |
| `npm run build` | success (61 modules; 583.49 kB JS → 144.26 kB gzip; 32.14 kB CSS) |

Previously the suite had 149 tests; the 53 new ones are the regression protection for this work.
The pre-existing suite (algorithms, scenes, rendering geometry, captions, narration, branding,
pipeline) still passes unchanged.

## 4. What is real verification, and what is simulated

**Real, on this sandbox, against real processes:**

- The service was restarted with the new code; `/api/health` returned `{"ok":true,…}`.
- The additive migration ran against the **actual** `/data/lab.db`: `heartbeat_at` and `attempts`
  exist, the partial unique index exists, and all **56 finished renders are untouched** (all rows
  still `done`).
- A real `preview` render of a seeded lesson, in a throwaway data directory: **2340 frames, 58.5 s,
  2,048,859-byte MP4, 17/17 quality checks, asset registered `ready`, zero partial files**.
- A forced watchdog stall on a real render (`RENDER_STALL_TIMEOUT_MS=1`): aborted **0.7 s** after
  queueing, ffmpeg child ended, row removed, failure recorded, no file left behind.
- The ffmpeg-timeout test really spawns ffmpeg and really kills it (exit `124` after ~0.7 s).

**Simulated or injected (and labelled as such):**

- Crash recovery: the rows a crash leaves behind were inserted directly into a test database, then
  `resumeOnBoot()` was run. No container was actually OOM-killed.
- Backup/restore was exercised against synthetic data trees, never against production data.
- The browser suite renders the real React components in jsdom against stubbed API responses. It
  does not paint, layout, or talk to the API; the real end-to-end page check is the preview.

**Not verified at all:** a real disk/IO stall, a real 4K render, a production image build, and any
off-box backup or scheduled backup.

## 5. Remaining risks

| Risk | Impact | Mitigation / next step |
| --- | --- | --- |
| `admin@mail.com` and two other unverified admin accounts | Unknown party with full Studio rights | Owner decision in `security-review.md` §7; rotate provider keys if not theirs |
| No off-box backups | Losing the volume loses videos and metadata | Ship sets to object storage; schedule `npm run backup` hourly + full set after batches |
| Publishing is manual | No automated Instagram/TikTok/YouTube flow | Existing known gap; `publish_jobs` is the queue to build on |
| Single-process queue | A whole-process freeze (not just a stuck encode) stops renders | Container healthcheck + restart; recovery requeues the interrupted job |
| No CSRF token / security headers | Narrow: same-origin, `SameSite=Lax`; no CSP | Add CSP/HSTS at the proxy; revisit if a second origin is allowed |
| Express 4 async error forwarding | An unexpected async throw could bypass the JSON error handler | Wrap async handlers or move to Express 5 |
| 4K profile unvalidated | A 4K job could fail quality checks or time out | Run one `4k` render and confirm `RENDER_ENCODE_TIMEOUT_MS` is sufficient on the host |
| jsdom is not a browser | CSS/layout regressions are invisible to `test:ui` | Keep the small jsdom suite for routing/permissions; use preview screenshots for visual checks |
| Session lifetime 30 days, no rotation | A stolen cookie lasts up to a month | Rotate on sign-in, add “sign out everywhere”; delete sessions for retired accounts |

## 6. Recommended next steps

1. **Decide the admin accounts** (`security-review.md` §7) and end their sessions if they are not
   yours. Nothing else in this report depends on it, but it is the highest-severity open item.
2. **Schedule backups** and copy them off the box; run the restore drill once against a real set.
3. **Consolidate the branch** using `branch-consolidation.md` once the owner decides about the
   portfolio link — after that, promote the preview from `main`.
4. **Add the missing safety nets** in order: security headers at the proxy, async error wrapping,
   session rotation, an admin audit log.
5. **Run one 4K and one `long` render end to end** on the production host and record the timings so
   `RENDER_ENCODE_TIMEOUT_MS`/`RENDER_VALIDATE_TIMEOUT_MS` reflect reality.
6. **Keep the suites honest**: the contract table in `api-contract.test.ts` is the list of endpoints
   that must keep working. When a route is added, add it there in the same commit.
