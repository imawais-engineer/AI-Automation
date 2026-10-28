# Visual CS Lab

Code-driven educational shorts: a Computer Science concept becomes a **verified
algorithm trace**, the trace becomes a **continuous animation timeline**, and that
timeline is drawn frame by frame into a **branded, silent vertical MP4**.

The product is deliberately small: **Create → Videos → Style**. Create verifies an
input with the trusted implementation, generates the animation and offers a preview
render; Videos previews, exports and downloads finished MP4s; Style owns the brand
palette and typography. Library routes (concepts, lessons, render manager, publishing
queue) stay available behind the navigation's Library group.

Two shorts ship complete end to end, both silent 45 second verticals:

- **Stacks** — PUSH 10, 20, 30 · PEEK · POP · POP · PUSH 40, watched as one continuous
  tower with a moving TOP pointer and a labelled underflow example.
- **Binary Search** — `[1, 3, 5, 7, 9]` and target `7`, with LOW/HIGH/MID, the active
  range and the discarded half driven by the verified trace.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 18 + TypeScript + Vite | Component-driven pages, one dev server with HMR |
| Motion | `server/anim/` — a deterministic 2.5D engine on Skia | One plan, one renderer for preview and export |
| API | Express, mounted with Vite in middleware mode | One origin on port 3000: no CORS, API and video downloads share the session |
| Data | SQLite (`better-sqlite3`) at `DATA_DIR` | Concepts, lessons, storyboards, render jobs, publishing entries persist across restarts |
| Frames | `@napi-rs/canvas` (Skia) | Real 2160×3840 drawing with no headless Chromium download |
| Encode | `ffmpeg-static`, raw RGBA piped to stdin | H.264/yuv420p, `+faststart`, nothing to install in the image |

## Pipeline (matches the product spec)

1. Load the lesson and its concept. A lesson may carry its own animation input
   (`animation_input`), which overrides the concept's demo configuration.
2. Validate the lesson (`lessonIssues` in `server/scenes.ts`): hook, takeaway, duration,
   animation configuration, verified trace, expected result, stored storyboard, timings,
   one operation beat per verified event, and the lesson/concept reference.
3. Run the concept's **trusted** animation configuration — `kind: 'stack'` uses
   `server/algorithms/stack.ts`, `kind: 'binary-search'` uses
   `server/algorithms/binary-search.ts`.
4. Emit a trace: stack events (`push`/`pop`/`top`) or binary search steps
   (`low`/`high`/`mid`/comparison/eliminated range).
5. Validate the trace against the concept's expected results — a mismatch blocks rendering.
6. Build the beat list (`server/scenes.ts`): hook, setup, one beat per verified
   operation, LIFO takeaway, complexity, brand — 45 seconds of weights for the demos.
7. Build the **motion plan** (`server/anim/plan.ts`) from the stored beat durations plus
   the freshly verified trace: every block, marker and camera key is positioned in time.
8. Render frames from that plan, one canvas reused, each frame written once the
   previous write has drained. The same `drawMoment()` produces the preview, the
   storyboard stills and the exported master — there is no slideshow renderer.
9. Encode and stream to ffmpeg (H.264, `yuv420p`, `+faststart`, no audio track).
10. Validate the encoded file (`server/render/quality.ts`): MP4 container, H.264,
    yuv420p, even dimensions, exact resolution, silence, duration within one frame, a
    full decode pass whose frame count matches the timeline, a **bitrate floor**
    (0.55 Mbit/s at 1080×1920, 2.2 Mbit/s at 4K), and five sampled frames
    (6 % / 28 % / 50 % / 74 % / 94 %) that are neither blank nor a repeated still.
11. Only then mark the job `done`; anything else is a failed job with the failing
    check, a readable log and a retry button.

## The animation engine (`server/anim/`)

One continuous stage per video. The camera pushes and drifts, but the environment never
cuts away between operations: blocks, markers and the TOP pointer move because the
algorithm's state changed, not because a new scene arrived.

| Module | Responsibility |
| --- | --- |
| `easing.ts` | Pure time functions: cubic/quint easing, settle, bump, envelope |
| `plan.ts` | Builds the plan: beat windows, stack block lifetimes, binary step windows |
| `stage.ts` | Visual language: backdrop, floor grid, 2.5D blocks, pointers, overlays, brand end |
| `stack.ts` | Stack stage: arriving/leaving blocks, TOP pointer, LIFO demo, underflow inset |
| `binary.ts` | Binary stage: array row, range bracket, LOW/HIGH/MID markers, discarded half |
| `index.ts` | `planFor()` and `drawMoment()` — the only render entry point |

Visual rules the engine follows:

- Blocks are solids with a lit top plane, a vertical front gradient, a shadow side and a
  contact shadow; light comes from above and the camera parallax matches the floor grid.
- Motion is driven by verified values: a PUSH drops a block into slot
  `items.length - 1`, a POP lifts the block the trace says was removed, MID travels to
  the index the comparison actually used.
- Text is restrained to a label system: operation banner, TOP pointer, value badges,
  range/marker chips, one caption line. Nothing is a paragraph on a slide.
- There is **no audio track at all** — `-an` on the encoder and a quality check that the
  file has no audio stream.

## Render lifecycle and the quality gate

`queued → rendering → encoding → validating → done`, plus `error` and `cancelled`.

Each job stores the lesson id, output profile, resolution, frame rate, expected
duration and frame count, storyboard hash, the scene snapshot, progress based on
frames actually written, timestamps, output path, byte size, media metadata and the
full validation report. Only one job renders at a time (the worker is a single
in-process pump), frames are streamed and never collected into an array, and a
second queued render for the same lesson is rejected.

`server/pipeline.ts` derives the lesson stage from that data — `draft`,
`trace_verified`, `storyboard_ready`, `rendered`, `quality_checked`,
`ready_to_publish` — and a lesson only becomes **ready to publish** when a
quality-checked render exists *and* the review status is approved. Machine checks
cannot judge legibility or educational accuracy, so those stay on the publication
checklist as explicit human-review items instead of being reported as passed.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Readiness probe |
| `GET /api/algorithms` | Algorithms the Create screen can animate, with default inputs |
| `POST /api/create` | Verify an input, create the lesson, store its beats, report readiness |
| `GET /api/overview` | Dashboard counts, recent lessons and jobs |
| `GET/POST /api/concepts`, `GET/PATCH /api/concepts/:id` | Concept library |
| `POST /api/concepts/:id/trace` | Run the trusted trace (visualizer + validation) |
| `GET/POST /api/lessons`, `PATCH /api/lessons/:id` | Lesson scripts |
| `POST /api/lessons/:id/storyboard` | Build and store scenes from the verified trace |
| `PATCH /api/lessons/:id/scenes` | Edit stored scene durations and captions, and/or reorder (`order: [ids]`) |
| `POST /api/lessons/:id/scenes/:sceneId/duplicate` | Duplicate a scene after itself |
| `GET /api/lessons/:id/scene/:i.png?w=540` | Real rendered frame from the beat (360–1080px) |
| `GET /api/lessons/:id/scene/:i/clip.mp4` | Motion preview of one scene (cached encode) |
| `GET/PATCH /api/brand` | Brand template read by the renderer |
| `POST /api/renders`, `GET /api/renders/:id` | Render jobs, progress, logs, errors, validation report |
| `POST /api/renders/:id/cancel` | Cancel a queued or in-flight job |
| `GET /api/renders/:id/stream` | Inline playback of the finished MP4 |
| `GET /api/renders/:id/video` | The finished MP4 as a download |
| `GET/POST /api/publishes`, `PATCH /api/publishes/:id` | Manual publishing queue per platform |

## Binary Search (end-to-end slice)

The concept carries its trusted animation configuration:

```json
{
  "kind": "binary-search",
  "array": [1, 3, 5, 7, 9],
  "target": 7,
  "expect": { "foundIndex": 3, "steps": 2 }
}
```

`server/algorithms/binary-search.ts` is the trusted implementation: inclusive
`low`/`high`, `mid = floor((low + high) / 2)`, one recorded step per comparison, and
the index it returns is checked against an independent linear scan. **Precondition:**
the input must be sorted ascending — an unsorted configuration is reported as an error
instead of being traced. `binary-search.test.ts` covers the example (index 3 after two
comparisons), empty arrays, a target below the minimum, above the maximum, missing from
the middle, a single-element array, duplicates, unsorted input and wrong expectations.

`buildScenes` gives a 45 second binary search short exactly five beats and exactly
45000 ms (1350 frames at 30 fps):

| # | Beat | Duration | Content |
| --- | --- | --- | --- |
| 1 | Hook | 3.0 s | "Searching a sorted array? Check the middle first." |
| 2 | Setup | 5.0 s | The sorted array and target 7, with the sorted-input precondition |
| 3 | Trace | 27.5 s | Array settles, MID moves to 2, `5 < 7`, indices 0–1 discarded, LOW → 3, range contracts, MID → 3, `FOUND · INDEX 3`, then the halving demonstration |
| 4 | Complexity | 7.0 s | O(log n) time, O(1) auxiliary space, n → n/2 bars |
| 5 | Brand | 2.5 s | Visual CS Lab and "Understand the algorithm. Don't just memorize it." |

Beat durations use largest-remainder allocation, so any lesson length adds up exactly to
the lesson duration. Beat timings and captions can be edited in the lesson editor
(`PATCH /api/lessons/:id/scenes`); the plan is rebuilt from the **stored** beats, and
validation reports when the timings no longer match the lesson duration.

Inside the trace beat the verified steps split their window into an intro, one share per
comparison and a closing halving share. The markers, the range bracket and the discarded
half are read from `binaryStateAt(plan, t)`, so what you see is the trace's own state.

## Editor, motion and output profiles

The storyboard section shows a real frame per scene; each card can play that scene's
actual motion (a cached mp4 encoded by the same engine as the export) and can be moved
earlier/later or duplicated. Reordering keeps the storyboard valid; duplicating adds
time, so the timeline total has to be rebalanced before rendering.

Output profiles (`server/render/profiles.ts`), all vertical 9:16 at 30 fps:

| Profile | Resolution | Purpose |
| --- | --- | --- |
| Preview | 540 × 960 | Fast iteration and scene previews |
| HD | 1080 × 1920 | Default publication output |
| 4K | 2160 × 3840 | Optional master; slow, more memory |

`drawMoment(plan, t)` is a pure function of the plan and the timestamp, so preview and
export frames are identical and a re-render is deterministic. The camera follows the
tower as it grows, blocks settle with a small squash on landing, the TOP pointer travels
to the real top element, and every overlay fades with an envelope instead of cutting.
All text is measured and wrapped inside the 64px safe margin at 1080 width; the smallest
overlay type is 22px at that scale, which stays legible on a phone.

Frames are drawn with Skia (`@napi-rs/canvas`), which draws **no text at all** when the
machine has no fonts — the slim Node image has none. The app therefore registers the
bundled `dejavu-fonts-ttf` faces at boot (`server/render/typography.ts`); no system
font package is needed.

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
npm test           # traces, storyboard timing, frame maths, output quality, pipeline
npm run typecheck
```

Test files cover the trusted algorithms (`server/algorithms/*.test.ts`), storyboard
construction and lesson validation (`server/scenes.test.ts`), frame allocation and
profiles (`server/render/profiles.test.ts`), the file-level quality checks
(`server/render/quality.test.ts`) and the stage derivation (`server/pipeline.test.ts`).

Environment variables: `PORT` (3000), `DATA_DIR` (SQLite), `MEDIA_DIR` (MP4 output).

## Known gaps (deliberately not faked)

- Only Stacks and Binary Search have a trusted animation configuration; Linear Search,
  Bubble Sort and tree/graph primitives are **planned**, not implemented. Rendering is
  blocked for every concept without a verified trace.
- The renderer runs in-process (one job at a time). There is no external render worker:
  this sandbox has no Chromium, and a Remotion/Chrome worker would need its own host.
- 4K is selectable but has only been validated at HD; expect a slow render and more
  memory, and check the output before publishing it.
- AI-assisted drafting is not wired yet; `OPENAI_API_KEY` / `OPENAI_BASE_URL` are
  stored for that phase and nothing reads them.
- Automated publishing and platform analytics APIs are not implemented; the queue is
  a manual workflow that records a real post URL.
