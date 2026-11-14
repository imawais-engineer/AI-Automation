# Final codebase audit

Date: 2026-11-14 · Branch: `main` at `13f383b` (recovery tag `pre-final-cleanup-20261114`)

## 1. Git state

- `main` contains `ai-video-shorts`: `git rev-list --left-right --count origin/main...origin/ai-video-shorts` returned `1 0` (main is one merge commit ahead, the branch has nothing main lacks). No second merge was needed.
- The working tree was clean on arrival. No force-push, no history rewrite.
- Remote branches: `main`, `ai-video-shorts` (fully merged, kept).

## 2. Root cause of the old documentation preview

Evidence from this repository:

| Finding | Evidence |
| --- | --- |
| The repository root had **no runnable entry point**. | Root tracked files were only `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `.gitignore`, `docs/`, `.github/`. No `package.json`, `Dockerfile`, Compose file or `index.html`. |
| The application sits one level down. | Every runtime file (`package.json`, `vite.config.ts`, `index.html`, `Dockerfile`, `server/`, `src/`) is under `visual-cs-lab/`. |
| There is **no documentation-browser frontend in this repo**, current or historical. | `git log --all --diff-filter=D` shows only Markdown files removed from the old portfolio (`docs/tools-stack.md`, `docs/upwork-portfolio-notes.md`, ...). No React/HTML docs viewer was ever tracked. |
| No Base44 configuration is stored here. | The only `BASE44` references are the `BASE44_PREVIEW_MODE` cookie flag in `server/auth.ts` and prose in docs. `docker-compose.base44.yml`, `SETUP.md` and `environment.json` are not tracked in this repo. |
| The repo's own earlier verification already recorded the mismatch. | `docs/operations/pre-consolidation-verification.md` (finding R13): the Base44 environment's `SETUP.md`/`environment.json` "still describe the old docs-only preview", while its Compose file runs the Lab. |

Conclusion: the "AW / AI Automation Workflows / Search docs" viewer is rendered by the **Base44 environment's own repository-docs viewer**, which shows Markdown when the project root it is pointed at (the repository root) contains no runnable app. The application code is correct and starts fine from `visual-cs-lab/` (verified, section 6). I cannot inspect or edit the Base44 environment from here, so the external half of the fix is a settings change listed in `docs/operations/final-preview-verification.md`. A stale preview artifact is a possible contributing factor that I cannot confirm or rule out without Base44 access.

## 3. In-repo corrections made

| Change | Why |
| --- | --- |
| Added root `package.json` + `package-lock.json` with scripts `dev`, `start`, `build`, `test`, `typecheck`, `backup` that delegate to `visual-cs-lab/` (`postinstall` runs `npm ci` there). | A tool that starts from the repo root now finds and runs the real app instead of only Markdown. No code is duplicated. |
| `visual-cs-lab/index.html` title/description changed from "DSA lessons into branded shorts" to "Computer science, one concept at a time". | Stale pre-product tagline shown in the browser tab and in search/social metadata. |
| `src/pages/public/Learn.tsx` fallback `document.title` updated the same way. | Same stale tagline on lesson-page unmount. |
| Removed `visual-cs-lab/public/.preview-sheet.png`. | 1280x720 contact sheet of rendered frames, referenced nowhere (`grep` over source, docs, config), and it was shipped publicly in `dist/`. |
| README: root layout, install from root, test count removed from prose, seed-content figures corrected. | README described the root as docs-only and quoted deployment-specific counts. |
| `CONTRIBUTING.md`, `docs/development/setup.md`, `testing.md`: removed hard-coded test counts (149 / 202). | Stale counts drift; testing.md keeps one dated baseline. |
| Added a "Historical record" banner to `repository-audit.md`, `branch-consolidation.md`, `pre-consolidation-verification.md`. | They describe the pre-merge two-branch state and would otherwise contradict the current tree. They hold real engineering evidence, so they were kept. |

## 4. Legacy identity search

Case-insensitive search for `AI Automation`, `Automation Workflows`, `portfolio`, `Search docs`, `\bAW\b` outside `.git` and lockfiles: **no active product occurrence** remains. Remaining hits are:

- the repository URL `imawais-engineer/AI-Automation` (the GitHub repo name, not product identity; renaming the repo is the owner's decision, see section 8);
- historical docs describing the removed portfolio (now bannered);
- `docs/operations/production-readiness.md` line about a portfolio link (a to-do for owner contact info, kept).

There is no `AW` logo, favicon or asset in the tree. The favicon is an inline `VL` SVG.

## 5. Code and dependency audit

| Area | Result |
| --- | --- |
| Entry points | One server (`server/index.ts`), one client (`src/main.tsx` via `index.html`). No duplicate frontend or backend. |
| Routes | Public: `/`, `/explore`, `/roadmaps`, `/roadmaps/:slug`, `/learn/:slug`, `/my-learning`, `/settings`, `/sign-in`, `/sign-up`. Studio: `/admin/content`, `/admin/content/:id`, `/admin/lessons/:id`, `/admin/renders`. All page components are imported by `App.tsx`; no orphaned page or component was found. |
| Dependencies | Every runtime dependency has a real import (`@napi-rs/canvas` 16 files, `better-sqlite3`, `ffmpeg-static`, `express`, `react`, `react-dom`, `react-router-dom`). `jsdom` / `@types/jsdom` are used only by `server/ui/regression.test.ts` and are correctly dev dependencies. **No dependency removed**; none was demonstrably unused. |
| Fonts | `public/fonts/*` are loaded by the renderer (`assertFontsLoaded`); retained. |
| Docker | `visual-cs-lab/Dockerfile` copies from its own directory, so the build context must remain `visual-cs-lab/`. Unchanged. |
| CI | Only `.github/workflows/security-scan.yml` (gitleaks, full history). Retained. There is no build/test workflow (see risks). |
| Public vs Studio nav | The public header shows Home, Explore, Roadmaps, My Learning, and a **Studio** button only for signed-in users with a studio role. This is intentional and covered by `server/ui/regression.test.ts` (`assertNoStudioControls`). It was not changed because making Studio visible to everyone would alter a tested access-design decision. `/admin` is protected: anonymous users see a sign-in prompt and every `/api/admin` route returns 401. |

## 6. Verification results (this session, Node v22.23.4)

| Check | Result |
| --- | --- |
| `npm ci` (app dir and root) | passes |
| `npm test` | **202 tests, 202 pass, 0 fail** |
| `npm run typecheck` | clean |
| `npm run build` | passes, 61 modules, `dist/` has no `.preview-sheet.png` |
| Route contract (`api-contract.test.ts`) | 95 route rows, 11 public, 84 protected (matches baseline) |
| Fresh seeded database | 28 concepts, 28 lessons (13 published, 15 draft), 1 roadmap. The earlier "23 published" figure belongs to the Base44 data volume, not the seed, and cannot be re-checked from here. |
| Production server (`NODE_ENV=production`, empty data dir) | `/`, `/explore`, `/roadmaps`, `/my-learning`, `/admin`, `/admin/renders`: HTTP 200 (SPA shell). `/api/health` 200. `/api/learn/home` returns topics, featured roadmap "DSA Foundations" and recent lessons from the database. `/api/learn/me` and `/api/admin/lessons`: 401 when anonymous. |

Not re-run here: real MP4 rendering, backup/restore, SIGKILL recovery and the Docker image build (no Docker in this sandbox). The existing queue, backup and render tests passed inside the 202. Browser-level checks of the rendered homepage were not done; the DOM regression suite covers the public pages.

## 7. Repository structure decision

**Keep `visual-cs-lab/` nested.** Moving it to the root would change the Docker build context and `COPY` paths, the working directory used by `docker-compose.base44.yml` and the sandbox's process manager (both external and unverifiable from here), the `repository.directory` field, and many doc links, with no functional gain. The root `package.json` delegation gives root-based tooling an entry point without a move. If Base44 can set a root directory (see the verification doc), it should be set to `visual-cs-lab`.

## 8. Remaining risks and next actions

1. Base44 project root / run command must be set externally (see `docs/operations/final-preview-verification.md`). Until then the preview can still show the old viewer.
2. No CI workflow runs tests, typecheck or build. Recommended: add one (Node 22, `npm ci`, `npm test`, `npm run typecheck`, `npm run build`).
3. Repository name `AI-Automation` still reflects the old identity. Renaming (GitHub redirects old URLs) is recommended but needs the owner's decision; `package.json` `repository.url` and clone instructions would then change.
4. Items already open in `docs/operations/production-readiness.md` and `security-review.md` (legacy admin accounts, CSP/CSRF, manual publishing) are unchanged.
5. Root `postinstall` runs a nested `npm ci`; if a platform installs at the root and then sets the working directory to `visual-cs-lab`, it simply installs twice, which is harmless.
