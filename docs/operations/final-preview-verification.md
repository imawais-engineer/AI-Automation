# Final preview verification

Date: 2026-11-14 · Branch: `main`

## Status

| Item | State |
| --- | --- |
| Visual CS Lab app starts and serves `/` from this repository | **Verified** (local production run, section 2) |
| Base44 preview shows the Visual CS Lab homepage | **NOT VERIFIED.** I had no access to the Base44 preview or its settings. The owner must check it (section 4). |

## 1. Why the old documentation viewer appeared

The repository contains no documentation-browser app (see `docs/architecture/final-codebase-audit.md`, section 2). Before this change the repository root held only Markdown and no `package.json`, so a preview pointed at the root had nothing to run and fell back to a Markdown docs viewer. The application has always lived in `visual-cs-lab/`. The Base44 environment's own `SETUP.md` / `environment.json` were already recorded as describing the old docs-only preview (finding R13 in `pre-consolidation-verification.md`). Those files are outside this repository.

## 2. What was verified locally

Run with `NODE_ENV=production PORT=3100 DATA_DIR=<empty dir> npx tsx server/index.ts` in `visual-cs-lab/`, after `npm run build`:

- `GET /`, `/explore`, `/roadmaps`, `/my-learning`, `/admin`, `/admin/renders` return the SPA shell (HTTP 200) whose `<title>` is "Visual CS Lab — Computer science, one concept at a time".
- `GET /api/learn/home` returns topics (Data Structures, Complexity Analysis, Algorithms), the featured roadmap "DSA Foundations" (13 lessons) and recent lessons.
- `GET /api/learn/concepts` and `/api/learn/roadmaps` return real seeded data.
- `GET /api/learn/me` and `GET /api/admin/lessons` return 401 when anonymous.
- `npm test` 202/202, `npm run typecheck`, `npm run build` pass, from the app directory and through the new root scripts.

This was not a browser check. Visible headline text, navigation clicks and sign-in were not exercised in a real browser.

## 3. Correct runtime

The app is a single Node process (Express serves the API and the React client; SQLite and MP4 output live in `DATA_DIR` / `MEDIA_DIR`). It is not a static site.

```bash
# from the repository root (delegates to visual-cs-lab/)
npm install
npm run dev            # development, port 3000, live reload
# or production
npm run build && NODE_ENV=production npm start
```

Equivalent from `visual-cs-lab/`: `npm ci`, then `npm run dev` or `npm run build && NODE_ENV=production npm start`.

Base44 can only host this if it runs a long-lived Node process with a persistent volume for `DATA_DIR`. If it only offers static hosting, Visual CS Lab cannot run there and no mock frontend should be substituted.

## 4. Settings to apply in Base44 (external, owner action)

I cannot see the Base44 UI, so field names may differ. Use these values:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Project / working directory | `visual-cs-lab` (or the repository root, which now delegates) |
| Install command | `npm ci` (in `visual-cs-lab`) or `npm install` (at root) |
| Dev / preview command | `npm run dev` |
| Production command | `npm run build` then `NODE_ENV=production npm start` |
| Port | `3000` (or set `PORT`) |
| Entry route | `/` |
| Persistent data | `DATA_DIR` and `MEDIA_DIR` on a mounted volume |
| Optional env | `DEEPGRAM_API_KEY`; `BASE44_PREVIEW_MODE=1` only for the HTTP preview cookie behavior |
| Environment repo (`SETUP.md`, `environment.json`, `docker-compose.base44.yml`) | Update so they describe and start the Lab, not the docs viewer. Compose working dir must be the `visual-cs-lab/` directory of the cloned repo. |

After saving, restart the preview and clear any cached build or stale container.

## 5. Checklist for the owner after applying the settings

- [ ] `/` shows the VL mark, "Visual CS Lab" and "Computer science, one concept at a time".
- [ ] No "AW", "AI Automation Workflows", "Search docs" or Markdown browser appears.
- [ ] Home, Explore, Roadmaps and My Learning navigate; Explore lists lessons; a lesson page opens.
- [ ] Anonymous `/admin` shows the sign-in prompt; a signed-in editor sees the Studio link and `/admin/content`.
- [ ] Sign-in and sign-up work (cookies need HTTPS or `BASE44_PREVIEW_MODE=1`).

If the old viewer still appears after these settings, the cause is outside this repository (the Base44 project is not running the app), and the Base44 start logs should be checked for the command it actually executes.
