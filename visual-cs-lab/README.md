# Visual CS Lab

Code-driven educational shorts: a Computer Science concept becomes a **verified
algorithm trace**, the trace becomes a **structured storyboard**, and the storyboard
is drawn frame by frame into a **branded vertical MP4**.

The first vertical slice covers **Stacks** end to end: step through PUSH/POP, verify
LIFO, build a lesson, render 1080×1920 or 2160×3840 H.264, download the file.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 18 + TypeScript + Vite | Component-driven pages, one dev server with HMR |
| API | Express, mounted with Vite in middleware mode | One origin on port 3000: no CORS, API and video downloads share the session |
| Data | SQLite (`better-sqlite3`) at `DATA_DIR` | Concepts, lessons, storyboards, render jobs, publishing entries persist across restarts |
| Frames | `@napi-rs/canvas` (Skia) | Real 2160×3840 drawing with no headless Chromium download |
| Encode | `ffmpeg-static`, raw RGBA piped to stdin | H.264/yuv420p, `+faststart`, nothing to install in the image |

## Pipeline (matches the product spec)

1. Load the lesson and its concept.
2. Validate required lesson fields.
3. Run the concept's **trusted** animation configuration (`server/algorithms/stack.ts`).
4. Emit an event trace (`push`/`pop`/`top` with stack snapshots).
5. Validate the trace against the concept's expected results — a mismatch blocks rendering.
6. Build scenes (`server/scenes.ts`): hook, concept, implementation, one scene per event, complexity, summary, brand.
7. Render frames (`server/render/draw.ts`).
8. Encode and stream to ffmpeg.
9. Probe the output: resolution must match the preset, duration must match the storyboard within 0.75 s.
10. Only then mark the job `done`; anything else is a failed job with a readable log and a retry button.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Readiness probe |
| `GET /api/overview` | Dashboard counts, recent lessons and jobs |
| `GET/POST /api/concepts`, `GET/PATCH /api/concepts/:id` | Concept library |
| `POST /api/concepts/:id/trace` | Run the trusted trace (visualizer + validation) |
| `GET/POST /api/lessons`, `PATCH /api/lessons/:id` | Lesson scripts |
| `POST /api/lessons/:id/storyboard` | Build and store scenes from the verified trace |
| `GET /api/lessons/:id/scene/:i.png` | Real rendered storyboard frame |
| `GET/PATCH /api/brand` | Brand template read by the renderer |
| `POST /api/renders`, `GET /api/renders/:id` | Render jobs, progress, logs, errors |
| `GET /api/renders/:id/video` | The finished MP4 |
| `GET/POST /api/publishes`, `PATCH /api/publishes/:id` | Manual publishing queue per platform |

## Rendering adapters

`server/render/` is the seam. The current adapter is `canvas + ffmpeg` running
in-process, which is what the sandbox supports today. A Remotion (headless Chrome)
worker would need a separate service with Chromium and far more memory; it is **not**
implemented, and the UI never pretends otherwise — a render is either a validated
MP4 or a failed job with an error.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # trusted algorithm trace + validation tests
npm run typecheck
```

Environment variables: `PORT` (3000), `DATA_DIR` (SQLite), `MEDIA_DIR` (MP4 output).

## Known gaps (deliberately not faked)

- Only Stacks has a trusted animation configuration; other concepts can be read and
  turned into lessons, but rendering is blocked until a trace exists for them.
- AI-assisted drafting is not wired yet; `OPENAI_API_KEY` / `OPENAI_BASE_URL` are
  stored for that phase and nothing reads them.
- Automated publishing and platform analytics APIs are not implemented; the queue is
  a manual workflow that records a real post URL.
