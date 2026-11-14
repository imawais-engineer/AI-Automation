# Testing

```bash
cd visual-cs-lab
npm test           # node:test through tsx — the whole suite
npm run test:api   # route contract: paths, methods, gates, validation, shapes
npm run test:queue # render watchdog rules + crash recovery + child-process timeouts
npm run test:backup# backup, verification, restore and retention
npm run test:ui    # React pages in jsdom: render, navigation, Studio gate
npm run typecheck  # tsc --noEmit over server, client and tests
npm run build      # production client build
```

Baseline verified on `main` on 2026-11-14: **202 passing, 0 failing**, typecheck clean, build clean.

## What the suite covers

| File | Verifies |
| --- | --- |
| `algorithms/binary-search.test.ts` | Verified search trace against hand-checked runs |
| `algorithms/structures.test.ts` | Arrays, linked lists, stacks, queues, hash tables |
| `algorithms/traversal.test.ts` | Trees, heaps, graphs, DFS |
| `algorithms/sorts-and-recursion.test.ts` | Bubble, insertion, selection, merge, quick sort, recursion, DP |
| `algorithms/patterns.test.ts` | Strings, two pointers, sliding window, prefix sums, cell-row dispatch |
| `algorithms/complexity.test.ts` | Complexity analysis output |
| `algorithms/shorts.test.ts` | Short-form lesson trace expectations |
| `scenes.test.ts` | Beats, durations, captions, storyboard validation |
| `pipeline.test.ts` | Render readiness and stage reporting |
| `render/profiles.test.ts` | Profile dimensions and frame allocation (no frame lost or gained) |
| `render/quality.test.ts` | Quality-report parsing and thresholds |
| `render/layout.test.ts` | Fitted text and geometry |
| `render/theme-contrast.test.ts` | Theme contrast |
| `render/caption-contrast.test.ts` | Caption contrast measured on real painted frames at 1080×1920 |
| `branding.test.ts` | Brand tokens → render branding |
| `voiceover.test.ts` | Script generation, freshness, copyable format |
| `routes/api-contract.test.ts` | 95 route entries: method, path, 401/403 by role, validation, response shapes, middleware order, each router alone and in the whole app |
| `render/watchdog.test.ts` | Stall detection, per-stage timeouts, single abort per job, configurable limits |
| `render/queue-reliability.test.ts` | One active render per lesson, crash recovery, partial-file sweep, real ffmpeg timeout, finished files preserved |
| `ops/backup.test.ts` | Consistent snapshot, atomic set, integrity/hash verification, retention, restore refusal paths |
| `ui/regression.test.ts` | Home, Explore, Roadmaps, lesson reader, My Learning, Sign-in, Studio gate and dashboard in jsdom; public pages expose no Studio controls |

## What is *not* covered automatically

- **Pixels and layout.** `test:ui` runs the real components in jsdom: routing, data rendering and
  permission gates. It does not apply CSS, measure contrast or paint. Visual changes still need the
  preview or a screenshot check.
- **Actual encoding on every profile.** Encoding dominates runtime; the queue tests cover the
  mechanics (timeouts, abort, partial files) with one real ffmpeg call, and a real render verifies
  the pipeline. A rendering change must be verified by rendering.
- **Backups against production data.** The backup suite uses synthetic trees; the restore drill in
  `docs/operations/backup-and-recovery.md` is the production procedure.

## Adding tests

- New algorithm → a test with a hand-verified trace **and** a tampered-trace rejection, so the
  validator is proven to do something.
- New rendering rule → extend `render/profiles.test.ts` or `render/layout.test.ts` with the
  arithmetic, not a screenshot.
- Bug fix → reproduce first, then fix; the failing test is the evidence.

## Reporting

Paste the command and the tail of its output in the pull request. "Tests pass" without output
is treated as unverified. A pre-existing failure is documented separately from a regression —
never silenced.
