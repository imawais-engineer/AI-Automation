# Setup

## Prerequisites

- Node.js 20.19 or newer (22 LTS recommended)
- npm (the lockfile is the source of truth)
- Nothing else: `ffmpeg` arrives through `ffmpeg-static`, the video fonts are committed in
  `public/fonts/`, and storage is SQLite — no database server, no headless browser.

## First run

```bash
git clone https://github.com/imawais-engineer/AI-Automation.git
cd AI-Automation/visual-cs-lab
npm ci
npm run dev        # http://localhost:3000
```

`npm run dev` starts one process: Express serves `/api`, and Vite is mounted in middleware
mode on the same port, so the client hot-reloads on a single origin (no proxy setup, no CORS).

## First administrator

The Studio is empty until an account exists. On a fresh database, `/sign-in` offers
**create the first administrator**, which receives the `admin` role. Later sign-ups at
`/sign-up` are learners; an admin changes a role with
`PATCH /api/admin/users/:id`.

If the admin password is lost, reset it with a scrypt hash written directly to the `users`
row (see the audit's operational notes) rather than deleting accounts.

## Where data lives

The app writes to two directories:

| Path | Contains | Default |
| --- | --- | --- |
| `DATA_DIR/lab.db` | Concepts, lessons, storyboards, jobs, users, progress | `/tmp/visual-cs-lab` |
| `MEDIA_DIR` | Rendered MP4s, thumbnails, scene clips, audio | `$DATA_DIR/media` |

The defaults are under `/tmp`, which a reboot can clear. Point them somewhere permanent:

```bash
DATA_DIR=~/.visual-cs-lab MEDIA_DIR=~/.visual-cs-lab/media npm run dev
```

## Useful commands

```bash
npm run dev         # server + Vite middleware, port 3000
npm run build       # production client build into dist/
npm start           # server; serves dist/ when NODE_ENV=production
npm test            # 202 tests
npm run typecheck   # tsc --noEmit
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Boot exits with a font error | A bundled font in `public/fonts/` is missing or unreadable | Restore the font files — rendering with a substitute face would break every fitted text box, so the server refuses to start |
| "port 3000 already in use" | Another dev server is running | Stop it, or `PORT=3001 npm run dev` |
| Studio shows content but the public site is empty | Content is not published (`content_status`) | Publish the lesson in the Studio |
| Render stays at the same percentage for a long time | A hung encode holds the queue | Restart the service: boot drops the stale job and restarts the pump, then re-queue the video |
| `better-sqlite3` fails to load after a Node upgrade | Native module built for the previous ABI | `npm rebuild better-sqlite3` (or `npm ci` again) |
| Narration says "provider not configured" | No `DEEPGRAM_API_KEY` | Add the key to `.env`; everything except recording still works |
