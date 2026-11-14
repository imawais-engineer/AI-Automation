# Testing

```bash
cd visual-cs-lab
npm test           # 149 tests, 17 files, node:test through tsx
npm run typecheck  # tsc --noEmit over server, client and tests
npm run build      # production client build
```

Baseline on this branch: **149 passing, 0 failing**, typecheck clean, build clean.

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

## What is *not* covered automatically

- Screen layout and Studio flows (no DOM test harness). Verified by hand or with the preview
  tools during a change.
- Actual encoding on every profile: the pipeline is exercised by real renders, not by tests,
  because encoding dominates runtime. A rendering change must be verified by rendering.

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
