# Architecture overview

Visual CS Lab is one Node process that serves three things: a public learning site, a
role-gated Creator Studio, and an in-process video renderer. The client is a Vite/React
SPA; the API is Express; storage is SQLite plus files on disk.

```
Browser ──► Express (:3000)
              ├── /api            public learning API (published content, learner writes)
              ├── /api/admin      administration (users, roles, review)
              ├── /api/*          Studio routers (content, preview, narration, brand,
              │                   create, renders, system)
              └── /*              React SPA (Vite middleware in dev, dist/ in production)
                     │
                     ├── SQLite (DATA_DIR/lab.db)
                     └── Media  (MEDIA_DIR: mp4, thumbnails, clips, audio)
```

## Domain boundaries

| Domain | Lives in | Owns | Must not |
| --- | --- | --- | --- |
| **Learning platform** | `src/pages/public/*`, `server/public-api.ts` | Home, Explore, roadmaps, lesson reader, progress, bookmarks, settings | Reach into render or authoring tables |
| **Computer Science** | `server/algorithms/*` | Algorithms, data structures, traces, complexity | Paint, encode or touch HTTP |
| **Trace & visualization** | `server/scenes.ts`, `server/anim/*`, `server/motion.ts` | Trace → animation plan → frames | Read HTTP requests or job rows |
| **Rendering** | `server/render/*` | Scene planning, encoding, validation, thumbnails, job queue | Decide whether an algorithm is correct |
| **Creator Studio** | `src/pages/admin/*`, `src/pages/LessonEditor.tsx`, `server/routes/*` | Authoring, previews, narration, renders, captions, publishing | Duplicate algorithm logic |
| **Core infrastructure** | `server/auth.ts`, `server/roles.ts`, `server/db.ts`, `server/env.ts` | Sessions, permissions, schema, configuration | Contain educational content rules |

These boundaries are enforced by imports, not by folders alone: `algorithms/` never imports
`render/`, `anim/` never imports Express, and the routes layer is the only place where HTTP
concerns appear.

## Server layout (after refactor)

```
server/
├── index.ts            wiring only: middleware, router mounts, client, boot (~150 lines)
├── env.ts              .env loading before anything reads process.env
├── db.ts               schema, migrations, seeds
├── auth.ts             session resolution (attachUser)
├── roles.ts            roles × actions permission table
├── public-api.ts       public learning endpoints
├── admin-api.ts        administration endpoints
├── routes/
│   ├── shared.ts       field allow-lists, pick/slugify, row lookups
│   ├── system.ts       /health, /overview
│   ├── content.ts      concepts, lessons, storyboards, scene edits
│   ├── preview.ts      plan inspection, scene stills, scene clips
│   ├── narration.ts    voice-over scripts, takes, audio export
│   ├── brand.ts        brand settings, rebuild, thumbnails
│   ├── create.ts       algorithm catalogue and the Create flow
│   └── renders.ts      render jobs, delivery, captions, publishing
├── scenes.ts           lesson → beats → scenes; validation of a storyboard
├── motion.ts           scenes → motion plan for the renderer
├── pipeline.ts         readiness/stage reporting for the Studio
├── content-bootstrap.ts derived lesson content upkeep
└── anim/, render/, tts/, algorithms/
```

`index.ts` was 1,193 lines and mixed nine concerns; the routers above split it by domain
without changing a single route path, status code or response shape.

## Client layout

- `src/App.tsx` — router, public shell, Studio shell, role gates.
- `src/pages/public/*` — the learning experience, each page one route.
- `src/pages/admin/*`, `src/pages/LessonEditor.tsx`, `src/pages/Renders.tsx` — Studio.
- `src/components/*` — Studio panels (scene timeline, narration, voice-over, quality,
  pipeline strip, captions); `src/components/public/*` — learner-facing blocks.
- `src/styles.css` — tokens and both shells; `public/fonts/*` — the exact faces the
  renderer draws with, so the editor previews real type.

## Data flow for a video

1. `POST /api/create` or the lesson editor verifies an input with the trusted algorithm.
2. `buildScenes` turns the trace into beats; the storyboard is stored on the lesson row.
3. `POST /api/renders` queues a job; the in-process worker paints frames with Skia and pipes
   them to ffmpeg.
4. The encoded file is validated (container, codec, pixel format, resolution, duration,
   sampled frames) before the job is marked `done`.
5. The finished MP4 is downloadable, streamable, captioned per platform and queued for
   publishing.

## Deliberate constraints

- **One process, one queue.** Rendering is sequential by design; a second concurrent render
  would compete for the same CPU and disk. Scale-out would need a job runner and shared
  storage (see the audit's technical-debt section).
- **No browser rendering.** Skia + ffmpeg is deterministic, headless and roughly 100×
  cheaper than a Chromium pipeline for these frames.
- **No ORM.** Prepared statements keep SQL visible and fast; the cost is manual migration
  code in `db.ts`.
