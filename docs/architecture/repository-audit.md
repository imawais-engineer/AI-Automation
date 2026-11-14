# Repository audit

> **Historical record.** Written before PR #1 merged `ai-video-shorts` into `main`. Branch names, commit ids and counts describe that moment. For the current state see [final-codebase-audit.md](final-codebase-audit.md).

Investigation performed before any code was changed. Evidence is quoted from Git and from
reading the source; nothing here is inferred from documentation alone.

## 1. Branch inventory

| Ref | Commit | Date | Subject |
| --- | --- | --- | --- |
| `main` (local) | `ed7b18c` | 2026-10-26 | `docs: industry-focused wording` |
| `origin/main` (fetched) | `ed7b18c` | 2026-10-26 | same |
| `origin/main` (per `git ls-remote`) | `9c54e75` | — | newer than the fetched ref — see §7 |
| `ai-video-shorts` | `9903edd` | 2026-11-10 | `Add video format tags to Renders list and metadata` |
| `origin/ai-video-shorts` | `9903edd` | 2026-11-10 | same |

- `git merge-base --is-ancestor main ai-video-shorts` → **true**: `main` is a direct ancestor
  of the application branch.
- `git rev-list --left-right --count main...ai-video-shorts` → `0  46`: the application
  branch is 46 commits ahead and 0 behind.
- `git log --oneline -- visual-cs-lab | wc -l` → 46: every one of those commits touches the
  application directory.
- Tags: none. Other branches: none. Worktree at investigation time: **clean** (`git status
  --porcelain` empty), so no user work was at risk.

**Conclusion.** `ai-video-shorts` is the newest implementation and the only branch
containing the product. The second branch, `main`, is the legacy AI-Automation portfolio and
does not contain the application at all.

## 2. What `main` contained

26 tracked files:

```
.github/workflows/security-scan.yml
.gitignore  CONTRIBUTING.md  LICENSE  README.md  SECURITY.md
docs/automation-process.md  docs/client-use-cases.md
docs/tools-stack.md         docs/upwork-portfolio-notes.md
workflows/01-ai-lead-qualification/…           (README, setup guide, n8n JSON export,
workflows/02-google-workspace-reporting/…       screenshots, sample data, demo links)
workflows/03-crm-follow-up-automation/…
```

That is a portfolio of n8n / Make / Zapier workflow demonstrations: the identity the
product is replacing. `git ls-tree -r --name-only origin/main | grep -c visual-cs-lab` → 0.

## 3. What the application branch adds

`git diff --stat main..ai-video-shorts` → **145 files, 40,242 insertions**, of which the only
non-application change is `README.md` (the portfolio README plus a pointer to the app).

Application shape at audit time:

| Area | Files / size |
| --- | --- |
| Server | 61 TypeScript files, ~27.4k lines (`index.ts` 1,193 · `scenes.ts` 1,954 · `anim/stage.ts` 1,575 · `db.ts` 1,523 · `anim/structure-frames.ts` 824 · `anim/stack.ts` 865 · `render/jobs.ts` 813) |
| Client | 25 TSX files, ~3.2k lines in pages plus components |
| Algorithms | 27 modules + 8 test files |
| Tests | 17 files, 149 tests (at this commit; 202 after the reliability work in `docs/operations/production-readiness.md`) |
| Content data | 28 concepts, 28 lessons (23 published), 1 roadmap / 4 modules / 23 items, 84 slides in 11 decks |

## 4. Findings

### Working and preserved
- Verified trace → scene → frame → encode → validate pipeline, with five output profiles and
  a quality gate that measures the encoded file.
- Role model (4 roles × 8 actions) enforced server-side through `requireAction`.
- Public learning site with progress and bookmarks; Studio with authoring, previews,
  narration, renders, captions and publishing queue.
- SQLite schema and content are data, not code; they live outside the repository.

### Technical debt found
| Item | Evidence | Disposition |
| --- | --- | --- |
| `server/index.ts` mixed nine domains | 1,193 lines, 47 routes inline | **Fixed** — split into `server/routes/*` (7 routers + shared helpers) |
| Two oversized engine modules | `scenes.ts` 1,954 · `anim/stage.ts` 1,575 | **Deferred** — see §6 for the reason and the plan |
| Baseline typecheck failure | 6 errors in `patterns.test.ts` (string literal widening) | **Fixed** — `as const` on the six config literals; `npm run typecheck` is now clean |
| Queue can wedge after a hang | A job sat in `rendering` for 3 days in this sandbox; the pump never released | **Documented** — operational workaround is a service restart (`resumeOnBoot` drops stale jobs and restarts the pump); a watchdog is the recommended next fix |
| Legacy portfolio identity at repo root | `workflows/`, `docs/*.md`, root README/CONTRIBUTING | **Removed / rewritten** |
| `.gitignore` carries automation notes | comment about exporting n8n workflows | **Cleaned** |

### Obsolete material removed
- `workflows/` — 16 files, n8n workflow exports, screenshots, sample data.
- `docs/automation-process.md`, `docs/client-use-cases.md`, `docs/tools-stack.md`,
  `docs/upwork-portfolio-notes.md`.
- Old root README and CONTRIBUTING (portfolio framing) — replaced with product documentation.

Kept deliberately: `LICENSE` (MIT), `SECURITY.md` (generic policy, still accurate),
`.github/workflows/security-scan.yml` (gitleaks, product-agnostic), `.gitignore`.

## 5. Risks of the requested changes

| Risk | Assessment | Mitigation taken |
| --- | --- | --- |
| Splitting `index.ts` breaks a Studio route | Route paths, guards, status codes and bodies were copied verbatim; the only change is which `Router` owns them | 149 tests, `tsc --noEmit`, boot check and live calls to `/api/overview`, `/api/lessons/:id`, `/api/inspect`, `/api/renders` after the split |
| Moving the app from `visual-cs-lab/` to the repository root | High: the sandbox compose file, Docker build context, `DATA_DIR`/`MEDIA_DIR` and every documented path depend on the subdirectory | **Deferred** — see §6; kept the working tree rather than a tidier one |
| Rewriting `main` | Irreversible if the remote tree is wrong; needs force-push and bypassing protection | **Not performed** — this workspace must not write to the default branch; exact commands in §7 |
| Losing content or media | Content lives in SQLite + `MEDIA_DIR`, outside Git | Nothing under `DATA_DIR`/`MEDIA_DIR` was touched by the cleanup |
| Removing a file that is still referenced | `workflows/` and the four legacy docs had no importer, no route and no build reference | Verified with `grep -r` over the application before deletion |

## 6. Decisions and deferred work

1. **Keep the application in `visual-cs-lab/`.** The user-facing goal is a clean product, and
   a root move is achievable later as a single mechanical change. Doing it now would break the
   preview environment and every documented path in one step, with no way to regression-test
   the Studio from here. The exact move is listed in §7.
2. **Split `index.ts`, not the engine.** `scenes.ts` and `anim/stage.ts` are cohesive engines
   whose functions call each other in tight loops; a split along arbitrary line counts would
   create cross-imports rather than boundaries. The recommended seams are documented in
   [visualization-engine.md](visualization-engine.md#known-seams).
3. **No framework changes.** Express + Vite + React + SQLite still fit the workload; the
   renderer's determinism and cost profile depend on it.

## 7. Git operations that require repository admin rights

This environment is not permitted to write to the default branch, and `main` may be
protected. Nothing below has been executed. Run it from a clone where you are an admin, and
read it before running it.

### a. Fetch the newer remote `main` first

`git ls-remote origin refs/heads/main` reported `9c54e75`, while the fetched ref is
`ed7b18c`. Inspect it before overwriting anything:

```bash
git fetch origin
git log --oneline -5 origin/main
git diff --stat origin/main..ai-video-shorts
```

### b. Back up both branches (recoverable refs, nothing deleted)

```bash
git branch backup/main-legacy      origin/main
git branch backup/app-before-merge ai-video-shorts
git push origin backup/main-legacy backup/app-before-merge
```

Record the hashes: `origin/main` at `ed7b18c` (remote tip `9c54e75`), application branch at
`9903edd`. No tags exist, so history is otherwise fully preserved: the application branch is
a strict descendant of `main`, and replacing `main` with it loses no commit.

### c. Make `main` the product

Because `ai-video-shorts` already contains `main` plus the application, promoting it keeps
every commit:

```bash
git checkout main
git merge --ff-only ai-video-shorts      # main becomes 9903edd's descendant line
git push origin main                     # if protection blocks it: open a PR from
                                         # ai-video-shorts into main and merge it
```

If a fast-forward is refused (remote `main` moved to `9c54e75`), merge instead of forcing:

```bash
git merge ai-video-shorts                # resolve any conflict in README.md only
```

### d. Optional, later: move the app to the repository root

Only worth doing with the sandbox compose file and CI updated in the same change:

```bash
git mv visual-cs-lab/* .                 # keep .gitignore, README.md, CONTRIBUTING.md
git mv visual-cs-lab/.* . 2>/dev/null    # .env.example etc.
rmdir visual-cs-lab
# then: docker-compose.base44.yml working dir, Dockerfile COPY paths, docs links
```

### e. Rename the repository (GitHub settings, not Git)

`Settings → Repository name` from `AI-Automation` to `visual-cs-lab`, then update
`visual-cs-lab/package.json` (`repository.url`) and the clone URLs in the docs. GitHub
redirects the old URL, so this is safe to do after merge.

## 8. Recommended next engineering priorities

1. **Queue watchdog** — a heartbeat per job so a hung encode retries instead of wedging the
   pump until a restart.
2. **Split `scenes.ts`** into `storyboard/plan.ts` (beats), `storyboard/validate.ts` and
   `storyboard/build.ts`; same for `anim/stage.ts` (palette, text fitting, primitives).
3. **Off-box media durability** — `/data` is a single volume; a job that re-renders on loss
   is expensive.
4. **Publishing integrations** — the queue is modelled end to end but no platform API is
   connected.
5. **UI regression coverage** — video output is tested; screen layout is verified by hand.
