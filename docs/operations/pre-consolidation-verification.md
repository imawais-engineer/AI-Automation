# Pre-consolidation verification

> **Historical record.** Written before PR #1 merged `ai-video-shorts` into `main`. Branch names, commit ids and counts describe that moment. For the current state see [final-codebase-audit.md](../architecture/final-codebase-audit.md).

Date: 2026-11-14. Branch: `ai-video-shorts` at `c75c5fe` plus the review fixes listed in §1.
Environment: the Base44 sandbox — Docker Compose, the app running from the cloned source at
`/workspace/visual-cs-lab`, production-like data in the `/data` volume (`lab.db` 7.1 MB, 122 media
files, 971.7 MB).

Scope: independent verification of everything the previous reports claimed, before `main` is
changed. **No branch was merged, no history rewritten, nothing force-pushed, no branch deleted, and
no production data was removed.** Two disposable accounts were created for the browser suite and
deleted afterwards (§4); everything else described here ran in throwaway directories or an
isolated container.

## 0. Verdict

The application branch is **safe to become the canonical repository**. It is **not yet "production
ready"** in the data-durability sense, because two verified findings affect disaster recovery and
one affects a render profile (§7). None of them is a repository-consolidation blocker.

| Gate | Result |
| --- | --- |
| Test suite | **202 / 202 pass** (6.5 s, in the app container) |
| Typecheck | `tsc --noEmit` clean |
| Production build | clean (61 modules; 583.49 kB JS → 144.26 kB gzip; 32.14 kB CSS) |
| API contract | **95 route entries · 84 with a Studio action · 11 public · 4 learner-session** |
| Backup → restore → boot | verified against a real full copy of the live data |
| Process crash recovery | verified with a real `SIGKILL` during a real encode |
| Browser journeys | verified in a real browser (9 journeys, 5 screenshots) |
| Production image | built, booted on disposable volumes, rendered a real video |

## 1. Task 1 — review of the outstanding diff

Reviewed: `package.json`, `package-lock.json`, `server/app.ts`, `server/index.ts`,
`server/render/jobs.ts`, `server/render/watchdog.ts`, `server/ops/backup.ts`,
`server/ops/backup-cli.ts`, `server/db.ts` + `server/content-schema.ts` (schema and additive
migrations), the seven router modules and their two mount points, the six new test files, the
`Dockerfile`, the environment Compose file, and the `docs/` tree.

| Area | Finding | Outcome |
| --- | --- | --- |
| Dependencies | `package.json` and `package-lock.json` are in sync — `npm ci` inside the image build resolved the whole tree from the lockfile with no repair step. No stray or duplicated entries. | OK |
| Scripts | Every referenced script exists (`dev`, `start`, `build`, `test`, `test:api`, `test:queue`, `test:backup`, `test:ui`, `backup`, `typecheck`). | OK |
| Untracked files | `git status` clean, no untracked or ignored-but-required files. Build output and local data are correctly ignored. | OK |
| Imports | Typecheck clean across server, client and tests; the contract suite mounts each router alone, which also proves no router depends on another being loaded first. | OK |
| Route contract | 95 entries; 84 behind `requireAction`, 11 public, 4 learner-session. Middleware order (`json` → `attachUser` → public → admin → domain → JSON 404 → JSON error) is asserted. | OK |
| Migrations | Additive only (`ensureColumn`), plus a partial unique index `render_jobs_one_active_per_lesson`. Ran against the real database: columns present, index present, all 56 finished renders untouched. | OK |
| Race — duplicate enqueue | Guarded twice: a read, then the partial unique index as the actual decider, with the constraint error translated to a 409-style message. Verified in code and by the queue suite. | OK |
| Race — duplicate claim | `renderJob()` claims with `UPDATE … WHERE state = 'queued'` and returns if `changes === 0`; the pump also refuses a job already registered with the watchdog. | OK |
| Race — two processes, one data directory | **Finding R3.** Two app processes against the same `DATA_DIR` actively fight: the second one's `resumeOnBoot()` sees the first one's running job as "interrupted", requeues it and deletes its partial file, and the live encoder then fails. Reproduced accidentally in this session (§3). Single-instance deployment is a requirement today. | Reported, not changed |
| Unhandled promise | **Finding F1 (fixed).** `pump()` was fire-and-forget from three call sites; a throw inside `renderJob()` would have become an unhandled rejection and ended the process, leaving the queue stopped until a restart. The pump now catches, records the failure and continues with the next job. | Fixed |
| Unsafe cleanup | Failure paths delete only their own `<id>.mp4` / `<id>.partial.mp4`; nothing walks the media tree. Backup retention only removes `vcsl-YYYYMMDD-HHMMSS` directories inside the backup root and re-checks the resolved path before `rm -rf`. | OK |
| Child processes | Every ffmpeg spawn has a timeout, `SIGTERM` → `SIGKILL` escalation, and an abort listener; the encoder is ended on cancel, stall and error. | OK |
| Boot recovery | Partial sweep, one automatic requeue (`attempts`), drop when the lesson already has another active job, `error` rows dropped by policy. Verified for real in §3. | OK |
| Observability | **Finding F2 (fixed).** `index.ts` ignored `resumeOnBoot()`'s result, so a recovered or dropped render was invisible in the log. It now prints one summary line. | Fixed |
| Documentation | **Finding F3 (fixed).** `README.md` still advertised 149 tests. Corrected to 202 with the suites it actually covers. | Fixed |
| Documentation | `docs/operations/production-readiness.md` still lists "a production image build" and "backup against production data" as never verified — both are verified here. A pointer was added to this report rather than rewriting history. | Fixed (pointer) |
| Documentation | `docs/operations/branch-consolidation.md` describes the tree at `77a647f`; the branch has since added `c75c5fe`. Its plan is unchanged by that commit, but the commit ids in it are one step old. | Noted |
| Docker configuration | Development Compose runs the cloned source with `npm run dev` (live reload) and a real `/api/health` healthcheck; the production `Dockerfile` installs from the lockfile, builds the client, and runs `tsx` from source. Neither bakes a prebuilt app image. | OK |
| Environment configuration | The environment Git `SETUP.md`/`environment.json` still describe the repository's previous life as a documentation-only preview, while the Compose file correctly runs the Lab. Documentation drift in the Base44 environment repository, not in this repository. | Noted |

No behaviour was changed apart from F1 (§1): routes, gates, render states, failure policy, the
sequential queue, the JSON limit and the schema are untouched.

## 2. Task 2 — real backup and restore

A **full** backup was taken from the live `/data` volume with the shipped CLI, verified, restored
into an empty directory, and the restored copy was booted as a second instance.

```bash
npm run backup -- create --media full --keep 3 --out /tmp/verify-backups
npm run backup -- verify /tmp/verify-backups/vcsl-20261114-155540
npm run backup -- restore /tmp/verify-backups/vcsl-20261114-155540 /tmp/restore-drill
```

| Check | Result |
| --- | --- |
| Snapshot consistency | SQLite online backup API while the server was writing (WAL); snapshot integrity `ok` before it was allowed to become a set |
| `verify` | exit 0, no issues — manifest, hash, size, `integrity_check`, `foreign_key_check`, row counts |
| Restore | `integrity ok`; row counts identical to the manifest |
| Foreign keys | `PRAGMA foreign_key_check` → **0 violations** |
| Orphans | lessons without concept, modules without roadmap, items without module/lesson, progress without lesson/user, slides without deck, assets without job → **all 0** |
| Content | 28 concepts · 28 lessons (23 published) · 11 decks · 84 slides · 28 storyboards · 52 quiz questions · 100 sections · 12 code examples |
| Roadmaps | 1 roadmap · 4 modules · 27 items, every item resolving to a lesson |
| Users / progress | 4 users (3 admin, 1 learner) · 2 progress rows, both resolving to a real lesson and user |
| Renders | 56 jobs, all `done`; 57 video assets; no `error`/`queued`/`rendering` rows |
| Media hashes | **122 / 122 files matched** the manifest SHA-256, 0 missing |
| Media assets | 56 MP4s (971.7 MB) · 7 narration takes · 1 audio variant master · 58 thumbnails · 0 partial files · `clips/` correctly excluded |
| Boot on restored data | `/api/health` 200 (`fonts: true`), `/api/learn/concepts` returns 28 lessons, `/api/learn/lessons/binary-search` 200 (5 sections, 3 quiz questions, video present), a published video asset streamed **200, `video/mp4`, 24.9 MB** |

**Finding R2 (not fixed).** `render_jobs.output_path` and `video_assets.file_path` store **absolute**
paths. The restored copy at `/tmp/restore-drill` served its video from `/data/media/...` — the
production directory — because the database still names it. Restoring onto the same absolute path
is correct today; restoring anywhere else silently reads the old location (and 404s if it is gone).
Mitigation is either "restore to the same `MEDIA_DIR`" (document in the runbook) or rebasing stored
paths during restore. This is the single most important recovery caveat.

## 3. Task 3 — process crash recovery

A disposable instance (`DATA_DIR=/tmp/crash-drill`, port 3102) bootstrapped its own admin, queued a
real `hd` render of *Stacks* through `POST /api/renders`, and was killed with `SIGKILL` to its
whole process group (node + ffmpeg) about 2.5 s into encoding.

| Check | Result |
| --- | --- |
| State the crash left behind | one row in `rendering`, `attempts = 0`, `heartbeat_at` 2.5 s old, `output_path` null, a 48-byte `…partial.mp4`, **no** `.mp4` |
| Restart | boot logged the interrupted job and requeued it: `attempts = 1`, partial file swept |
| Duplicate active job | 0 — one row per lesson, the watchdog registers a job once, the unique index holds |
| Recovery completes | `done`: **2340 frames, 78.00 s, 6,934,389 bytes**, `attempts = 1` |
| Output integrity | ffprobe: `h264 (High)`, `yuv420p`, **1080×1920, 30 fps**, duration `00:01:18.00` — the full expected timeline, not a truncated file |
| Asset registration | `asset-<jobId>` created `ready`, 6,934,389 bytes, pointing at the final MP4 |
| Partial handling at rest | no `*.partial.mp4` left; the interrupted file never became a visible video |
| Subsequent rendering | a new render on the same instance completed normally (2340 frames, 2,048,830 bytes, 78 s) |

While building this drill, a **second** app process was started against the same data directory by
mistake. Its boot recovery treated the first process's live encode as interrupted, requeued the job
and removed its partial file; the live encoder then failed and the row was dropped. That is the
evidence for R3: the queue is correct for one process and unsafe for two.

## 4. Task 4 — browser end-to-end

Playwright was **not** added. The probe is conclusive: Chromium downloads inside the app container
but cannot launch — `libglib-2.0`, `libgobject-2.0`, `libnss3`, `libnssutil3`, `libnspr4`,
`libdbus-1`, `libatk-1.0`, `libatk-bridge-2.0` are not in `node:22-bookworm-slim`. Making it work
means installing OS packages on every container start, which would destabilise the environment the
brief asked to protect. Adding a browser dependency to the production image for the same reason was
rejected. The journeys were therefore driven in the platform's real Chromium against the running
app, with screenshots, and the assertions cover DOM and API state — not jsdom.

| # | Journey | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Visitor opens Home | Verified | Anonymous `/` renders the hero, topic cards and the 23/1/23 stats with **Sign in / Create account** and no Studio link, 0 console errors (screenshot); also verified unauthenticated on the restored instance and the production container |
| 2 | Visitor explores concepts | Verified | `/explore` renders 23 lesson cards with topic chips and difficulty meta (screenshot) |
| 3 | Visitor opens a lesson | Verified | `/learn/binary-search`: title, 9 sections, objectives, lesson contents, quiz block (screenshot) |
| 4 | User signs in | Verified | Sign-in form submitted, landed on `/my-learning`, `/api/auth/me` returned the learner |
| 5 | User accesses My Learning | Verified | Personal heading, roadmap progress card, saved-lessons panel (screenshot) |
| 6 | Authorized administrator opens Studio | Verified | `/admin/content` renders grouped lesson rows with slide/video/narration badges (screenshot) |
| 7 | Administrator opens the lesson editor | Verified | `/admin/content/:id` metadata + publish-readiness (8/8); `/admin/lessons/:id` storyboard (13 scenes, 77.0 s) with Preview/HD/Long/4K and Render MP4 (screenshot) |
| 8 | Administrator inspects rendering jobs | Verified | `/admin/renders`: 40 rows, FORMAT badges (Horizontal/Vertical), DONE/PASSED, sizes and durations; Inspect expands the row (screenshot) |
| 9 | Unauthorized learner cannot access admin | Verified | UI gate "Your account cannot open the studio…"; `POST /api/renders` → `{"error":"Your role (learner) cannot perform this action."}` (screenshot) |

Two disposable accounts (`e2e-learner@verify.test`, `e2e-admin@verify.test`) were created for
journeys 4–9 and **deleted afterwards** together with their sessions; the user table is back to its
original four rows and the session count (12) is unchanged.

## 5. Task 5 — Docker

The repository's own production image was built from source (`docker build -f visual-cs-lab/Dockerfile`)
and run on disposable volumes (`/tmp/vcsl-verify-data`, port 3901). No production volume was touched.

| Check | Result |
| --- | --- |
| Build | success — `npm ci --include=dev` from the lockfile, `vite build`, no warnings beyond the 500 kB chunk hint |
| Start | container up, `Visual CS Lab listening on http://0.0.0.0:3000` |
| Health | `/api/health` 200 `{ok:true, fonts:true}` |
| Static frontend | `/` 200 HTML shell, hashed bundle `/assets/index-BmaDARtu.js` 200 (269,084 bytes), deep link `/explore` 200 HTML (SPA fallback), `/api/nope` 404 JSON |
| Database init | fresh volume seeded itself: 13 lessons, 1 roadmap, 28 concepts |
| Fonts | `/fonts/inter-400.ttf` 200 `font/ttf`; startup font assertion passed |
| Rendering dependencies | `ffmpeg-static` 7.0.2 static + `@napi-rs/canvas` present; a real `preview` render completed inside the container (**2340 frames, 2,048,830 bytes, 78 s, 17/17 checks, validation ok**) |
| Restart | `docker stop` → `docker start`: data persisted, `/api/health` 200, same lesson count |
| Clean shutdown | **Finding R4.** `docker stop` returned in 0 s with exit code **1** — there is no `SIGTERM` handler, so node is killed rather than draining. No render was in flight; if one had been, boot recovery would requeue it. |

## 6. Verification matrix

| Claim | Real environment | Isolated test infrastructure | Simulated | Not tested |
| --- | --- | --- | --- | --- |
| Test suite 202 passing | yes (app container) | — | — | — |
| Typecheck / production build | yes | — | — | — |
| API contract (95 routes, 84 gated) | yes | yes (disposable DB, real HTTP) | — | — |
| Backup create / verify / restore | yes — live `/data` copy | yes (empty target dir) | — | scheduled/off-box runs |
| Restore → boot with real media | yes | yes (`/tmp/restore-drill`) | — | restore to a *different* absolute path (R2) |
| Crash recovery (SIGKILL mid-encode) | yes (disposable instance) | — | — | OOM kill, host power loss |
| Watchdog stall abort | — | yes (unit + reported real run) | — | a genuine disk/IO stall |
| Real MP4 rendering | yes — 6 renders this session | yes | — | 4K and Master profiles |
| Browser journeys | yes — real Chromium | — | — | automated repeat run (no Playwright) |
| Production image | yes (isolated container) | — | — | registry publish, multi-host |
| Graceful shutdown drain | — | — | — | yes — not implemented (R4) |
| Publishing to social platforms | — | — | — | yes — manual today |

Renders actually produced during this verification: *Stacks* HD 2340 frames / 78.00 s (crash drill,
recovered), *Stacks* preview 2340 frames / 78 s (clean drill), *Binary Search* preview (rejected by
the bitrate gate, see R1), *Stacks* preview 2340 frames / 78 s (production image).

## 7. Remaining risks

| # | Risk | Severity | Evidence | Next step |
| --- | --- | --- | --- | --- |
| R1 | **Preview renders of low-motion lessons are rejected.** The bitrate floor is `max(0.2, pixelRatio × 0.55)` Mbit/s, which for the 540×960 preview profile is a flat 0.2. A valid *Binary Search* preview measured **0.199 Mbit/s** and the job was failed and deleted with "Bitrate ≥ 0.2 Mbit/s". | Medium (user-visible false failure, one profile) | Reproduced twice in this session | Make the floor profile-aware (e.g. scale the absolute part with the pixel ratio, ~0.13 for preview) and add a test that a flat-content preview encode passes |
| R2 | **Restore only works at the original absolute path.** Rendered paths are stored absolute; a restored set at another path still reads the old `MEDIA_DIR`. | High for disaster recovery | Restored instance served its MP4 from `/data/media` | Rebase `output_path`/`file_path` on restore, or document "restore to the same `MEDIA_DIR`" in the runbook |
| R3 | **Two processes on one data directory corrupt each other's queue.** Boot recovery requeues a live job and deletes its partial. | Medium (accidental double start, any future multi-replica) | Reproduced in §3 | Advisory lock file / single-instance guard at boot; keep one replica per volume |
| R4 | **No graceful shutdown.** `docker stop` exits 1 immediately; an in-flight render is lost and only recovered on the next boot. | Low | §5 | Handle `SIGTERM`: stop the watchdog, abort the active encode, checkpoint SQLite, exit 0 |
| R5 | **No automated browser regression suite.** Playwright cannot run in this image. | Medium | §4 probe | Run Playwright in a CI image that installs the browser's OS dependencies; the nine journeys above are the script to port |
| R6 | Role *changes* were not exercised in the browser (promoting a learner to editor and back); only the fixed learner/admin gates were. | Low | §4 | Add to the Playwright suite once the browser image exists |
| R7 | **Backups are on-box only, and nothing schedules them.** A lost volume still loses everything. | High | `docs/operations/backup-and-recovery.md` | Hourly `npm run backup`, nightly `--media full`, ship sets off-box |
| R8 | 4K and Master profiles were not rendered in this verification. | Low | — | Render one 4K lesson before promising 4K |
| R9 | Legacy accounts `admin@mail.com` (and two other admins) still exist. | Security decision | `security-review.md` §7 | Owner confirms or deletes them; rotate provider keys if unknown |
| R10 | No CSP / CSRF token; protection is same-origin + `SameSite=Lax`. | Low–Medium | `security-review.md` | Add CSP/HSTS at the proxy |
| R11 | The `/data` volume carries one-off scripts and logs from earlier sessions (`check.ts`, `q1.mjs`…`q8.mjs`, `render*.ts`, `generate.log`). | Low hygiene | `ls /data` | Remove them; keep tooling in `server/ops` |
| R12 | Publishing to Instagram/TikTok/YouTube is manual. | Product gap | `publish_jobs` only drafts | Build the connector queue when the APIs are chosen |
| R13 | The environment Git (`SETUP.md`, `environment.json`) still describes the old docs-only preview. | Low (documentation) | Environment config | Refresh in the Base44 environment repository |

## 8. Recommendation

**Consolidate `ai-video-shorts` into `main` as a pull request with a merge commit**, keeping the
plan in `branch-consolidation.md` (preserve the `main`-unique README line, no rewrite, no
force-push). The engineering baseline is verified: the suite, the API contract, the queue, backups,
real rendering, the production image and the nine browser journeys all hold on real infrastructure.

Before calling the deployment "production ready", close **R2** (restore path) and **R7** (off-box,
scheduled backups) — they are the two that decide whether a bad day is recoverable — and schedule
**R1** (preview bitrate gate) as the first functional fix, since it can refuse a perfectly good
render of a quiet lesson.
