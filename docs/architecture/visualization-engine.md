# Visualization engine

The engine turns an algorithm run into something a learner can watch — and into the same
plan the renderer paints. Nothing on screen is decorative: every value comes from the trace.

```
algorithm(input) ──► trace ──► motion plan ──► frames ──► MP4
                        │
                        └────────► interactive lesson animation
```

## 1. Trace contract (`server/algorithms/*`)

Each algorithm module exports a `trace*` function and a `validate*Trace` function:

- `trace` returns a deterministic run: `steps`, `meta`, result data (`foundIndex`,
  `comparisons`, …) and `errors`. Same input → identical steps, no randomness, no clock.
- `validate` compares a trace against the expectation the lesson stores (`expect` in
  `animation_config`), returning `{ ok, failures }`. A failure blocks a render instead of
  shipping a wrong animation.

A step is presentation-neutral: rows of cells, highlighted indices, named pointers, a
message, and optional meta. It has no color, font, position or duration — those belong to
the animation layer, so the same step can be drawn as a vertical stack, a horizontal array or
a graph.

Modules today: arrays, binary search, binary search trees, trees, heaps, linked lists,
stacks, queues, hash tables, graphs, DFS, linear search, bubble/insertion/selection/merge/
quick sort, recursion, dynamic programming, strings, two-pointers, sliding window, prefix
sums, complexity analysis, plus a shared `steps.ts` dispatcher for cell-row patterns.

## 2. Storyboard (`server/scenes.ts`)

`buildScenes(lesson, concept, branding)` converts a trace into **beats** — hook, concept,
worked example, step-by-step walkthrough, result, complexity, takeaway, closing — each with a
caption, subtitle and duration derived from its content and narration length. The result is
stored as JSON on the lesson row.

- Durations are content-driven; there is no fixed "45 second" slot.
- `lessonIssues()` reports what would block a render (missing narration, unsupported
  animation, failed trace validation) so the Studio shows the blocker instead of a broken
  video.
- `storyboardHash()` lets the UI tell "rendered from this storyboard" from "rendered from an
  older one".

## 3. Motion plan (`server/motion.ts`, `server/anim/*`)

`motionForLesson` maps scenes onto animation kinds:

| Kind | Used for | Module |
| --- | --- | --- |
| `structure` | Arrays, lists, stacks, queues, trees, heaps, graphs, hash tables | `anim/structure.ts`, `anim/structure-frames.ts` |
| `cell-row` | Two-pointers, sliding window, prefix sums, selection/insertion/bubble sort | pattern engine in `anim/` |
| `curve` | Complexity growth | `anim/facts.ts` |
| `stack` | PUSH/PEEK/POP tower | `anim/stack.ts` |
| `binary` | Binary search with LOW/HIGH/MID | `anim/binary.ts` |
| `linked` | Pointer relinking | `anim/linked.ts` |
| `plan`/`stage` | Shared geometry, easing, text fitting, palettes | `anim/plan.ts`, `anim/stage.ts` |

`anim/stage.ts` owns the drawing primitives (fitted text, pills, cards, gradient scrims);
`anim/plan.ts` and `anim/easing.ts` own geometry and timing; `anim/anchors.ts` and
`anim/audit.ts` check that a pointer sits on the element it names and that a frame is
readable. `inspectPlan()` surfaces that audit to the Studio before a render is queued.

## 4. Determinism

Given the same lesson and input, the trace, the storyboard and the frame plan are identical.
That property is what makes the tests meaningful: `scenes.test.ts`, `pipeline.test.ts`,
`anim`-level tests and the caption-contrast regression test compare computed output against
hand-checked expectations without encoding a video. Timing is derived from data (frames per
scene allocated by largest remainder), never from wall-clock during rendering.

## 5. Adding an algorithm

1. Write `server/algorithms/<name>.ts` with `traceName(input)` and `validateNameTrace`.
2. Add a test that checks a hand-verified run *and* that the validator rejects a tampered
   trace.
3. Teach `runConcept`/`effectiveConcept` in `scenes.ts` to dispatch the animation kind.
4. Only if the visual vocabulary is genuinely new, add an animation module; otherwise reuse
   `structure` or `cell-row`.
5. Create the concept and lesson in the Studio and render one video to confirm it.

Hardcoding a one-off animation for a single lesson is the failure mode to avoid: if two
lessons would draw the same shape, the shape belongs in a primitive.

## Known seams

`scenes.ts` (1,954 lines) and `anim/stage.ts` (1,575 lines) are cohesive but large. The
natural split — deferred in this pass to avoid churn inside a working engine — is:

- `scenes.ts` → `storyboard/plan.ts` (beat construction), `storyboard/caption.ts` (wording),
  `storyboard/validate.ts` (`lessonIssues`), `storyboard/build.ts` (public API).
- `anim/stage.ts` → `stage/text.ts` (fitting), `stage/palette.ts`, `stage/primitives.ts`
  (cells, pills, cards), `stage/canvas.ts` (compositing).
