# Visual CS Lab

Code-driven educational shorts: a Computer Science concept becomes a **verified
algorithm trace**, the trace becomes a **structured storyboard**, and the storyboard
is drawn frame by frame into a **branded vertical MP4**.

Two vertical slices are complete end to end, each from concept to downloaded file:

- **Stacks** — step through PUSH/POP, verify LIFO, build a lesson, render H.264.
- **Binary Search** — trace low/high/mid over a sorted array, verify the index, build
  the fixed five-scene 20 second storyboard, render and download the MP4.

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
2. Validate the lesson (`lessonIssues` in `server/scenes.ts`): hook, takeaway, duration,
   animation configuration, verified trace, expected result, stored storyboard, timings
   and the lesson/concept reference.
3. Run the concept's **trusted** animation configuration — `kind: 'stack'` uses
   `server/algorithms/stack.ts`, `kind: 'binary-search'` uses
   `server/algorithms/binary-search.ts`.
4. Emit a trace: stack events (`push`/`pop`/`top`) or binary search steps
   (`low`/`high`/`mid`/comparison/eliminated range).
5. Validate the trace against the concept's expected results — a mismatch blocks rendering.
6. Build scenes (`server/scenes.ts`): hook, concept, implementation, one scene per event,
   complexity, summary, brand. Binary Search uses its own five-scene plan.
7. Snapshot the stored storyboard into the job, so the MP4 always matches the
   scenes that were validated at enqueue time.
8. Render frames (`server/render/draw.ts`) from that snapshot, allocating frames per
   scene with largest-remainder maths: a 20 s lesson at 30 fps is exactly 600
   frames, never 599 or 601.
9. Encode and stream to ffmpeg (H.264, `yuv420p`, `+faststart`, no audio track).
10. Validate the encoded file (`server/render/quality.ts`): MP4 container, H.264,
    yuv420p, even dimensions, exact resolution, duration within one frame, a full
    decode pass whose frame count matches the timeline, and three sampled frames
    (10 % / 50 % / 90 %) that are neither blank nor a repeated still.
11. Only then mark the job `done`; anything else is a failed job with the failing
    check, a readable log and a retry button.

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
| `GET /api/overview` | Dashboard counts, recent lessons and jobs |
| `GET/POST /api/concepts`, `GET/PATCH /api/concepts/:id` | Concept library |
| `POST /api/concepts/:id/trace` | Run the trusted trace (visualizer + validation) |
| `GET/POST /api/lessons`, `PATCH /api/lessons/:id` | Lesson scripts |
| `POST /api/lessons/:id/storyboard` | Build and store scenes from the verified trace |
| `PATCH /api/lessons/:id/scenes` | Edit stored scene durations and captions, and/or reorder (`order: [ids]`) |
| `POST /api/lessons/:id/scenes/:sceneId/duplicate` | Duplicate a scene after itself |
| `GET /api/lessons/:id/scene/:i.png` | Real rendered storyboard frame |
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

`buildScenes` gives a 20 second binary search lesson exactly five scenes and exactly
20000 ms:

| # | Scene | Duration | Content |
| --- | --- | --- | --- |
| 1 | Hook | 2.5 s | "Searching a sorted array? Check the middle first." |
| 2 | Concept | 3.5 s | The sorted array and target 7, with the sorted-input precondition |
| 3 | Trace | 7.0 s | low/high/mid, the comparison with 5, range reduction, the match at index 3 |
| 4 | Complexity | 4.0 s | O(log n) time, O(1) auxiliary space, key takeaway |
| 5 | Brand | 3.0 s | Visual CS Lab and "Understand the algorithm. Don't just memorize it." |

Durations use largest-remainder allocation, so any lesson length adds up exactly to the
lesson duration. Scene timings and captions can be edited in the lesson editor
(`PATCH /api/lessons/:id/scenes`); the renderer draws the **stored** storyboard, and
validation reports when the timings no longer match the lesson duration.

The trace scene animates inside a single scene: every verified step gets an equal
slice, showing the comparison and pointers first, then fading the eliminated half and
moving `low`/`high`.

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

Motion comes from scene time only (`drawFrame` is a pure function of scene, frame time
and brand), so a re-render is deterministic: content fades and rises in, the accent rule
under a hook grows, code lines stagger, complexity facts slide in as cards, the match
pulses, the brand mark and underline sweep, and captions slide up. Each scene fades out
over its last 200 ms so transitions never hide an algorithm state. Long status text in
the trace panel is measured and shrunk/wrapped inside the safe margin.

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
