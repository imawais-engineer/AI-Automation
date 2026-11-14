/**
 * Sliding window: the verified expand/shrink scan behind the Sliding Window short.
 *
 * A window keeps one invariant — here the sum of its cells stays at or below a
 * limit. The right edge adds one cell at a time; while the invariant breaks, the
 * left edge removes cells. Each cell enters and leaves once, so the walk is O(n)
 * even though it looks like a nested loop. `validateSlidingWindowTrace` replays
 * the walk on a plain array, so the animation can only show a window the rule
 * really produced.
 *
 * Keep this module dependency-free apart from the shared trace vocabulary: the
 * storyboard builder, the renderer and the API all read it.
 */

import type { Validation } from './stack.ts';
import type { StepsMeta, StepsStep, StepsTrace } from './steps.ts';

export type SlidingWindowConfig = {
  kind: 'sliding-window';
  array: number[];
  limit: number;
  expect?: { longest?: number; adds?: number; removes?: number };
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isSlidingWindowConfig(config: unknown): config is SlidingWindowConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'sliding-window' && Array.isArray(record.array) && Number.isFinite(Number(record.limit));
}

export function traceSlidingWindow(config: { array: unknown; limit: unknown }): StepsTrace {
  const array = cleanArray(config.array);
  const limit = Number(config.limit);
  const cells = array.map(String);
  const steps: StepsStep[] = [];
  let left = 0;
  let sum = 0;
  let longest = 0;
  let adds = 0;
  let removes = 0;

  for (let right = 0; right < array.length; right += 1) {
    sum += array[right];
    adds += 1;
    const over = sum > limit;
    steps.push({
      n: steps.length + 1,
      rows: [{ label: 'a[]', cells, active: array.map((_, i) => i).filter((i) => i >= left && i <= right) }],
      pointers: [
        { index: left, label: `L = ${left}`, tone: 'accent' },
        { index: right, label: `R = ${right}`, tone: 'coral' }
      ],
      message: over
        ? `a[${right}] = ${array[right]} pushes the sum to ${sum} > ${limit} — shrink left.`
        : `a[${right}] = ${array[right]} added · sum ${sum} ≤ ${limit}`,
      hudLabel: `sum ${sum} · window ${right - left + 1}`,
      hudDetail: `${adds} added · ${removes} removed`
    });

    while (sum > limit && left <= right) {
      sum -= array[left];
      left += 1;
      removes += 1;
      steps.push({
        n: steps.length + 1,
        rows: [{ label: 'a[]', cells, active: array.map((_, i) => i).filter((i) => i >= left && i <= right) }],
        pointers: [
          { index: left, label: `L = ${left}`, tone: 'accent' },
          { index: right, label: `R = ${right}`, tone: 'coral' }
        ],
        message:
          sum > limit
            ? `a[${left - 1}] removed · sum ${sum} still over ${limit}`
            : `a[${left - 1}] removed · sum ${sum} is legal again`,
        hudLabel: `sum ${sum} · window ${Math.max(0, right - left + 1)}`,
        hudDetail: `${adds} added · ${removes} removed`
      });
    }
    longest = Math.max(longest, right - left + 1);
  }

  const meta: StepsMeta = {
    label: 'SLIDING WINDOW',
    kickers: ['expand right', 'shrink left'],
    facts: [
      { label: 'Limit', value: `sum ≤ ${limit}` },
      { label: 'Longest window', value: `${longest} cells` },
      { label: 'Cells added', value: `${adds}, removed ${removes}` }
    ],
    result: { title: `longest ${longest}`, sub: `${adds} adds, ${removes} removes — each cell touched twice at most` },
    holdCaption: 'Each cell enters and leaves the window once, so the nested-looking walk is still O(n).',
    complexity: { time: 'O(n)', space: 'O(1)' },
    copy: {
      hook: 'One window, two edges: grow while it is legal, shrink until it is again.',
      setupTitle: 'Keep one invariant',
      setupCaption: `The window may hold any cells as long as their sum stays at or below ${limit}.`,
      traceTitle: `Trace · longest window under a sum limit of ${limit}`,
      traceSubtitle: 'add a[right] · shrink from the left · record the width',
      traceCaption: 'The right edge only moves right and the left edge only moves right, so both edges travel n cells in total.',
      complexityTitle: 'O(n), not O(n²)',
      complexityCaption: `${adds} adds and ${removes} removes cover ${array.length} cells. Space: O(1) — two indices and a running sum.`
    }
  };

  return { steps, meta };
}

/** Replays the expand/shrink walk and compares it with the recorded steps. */
export function validateSlidingWindowTrace(trace: StepsTrace, config: SlidingWindowConfig): Validation {
  const failures: string[] = [];
  const array = trace.steps[0]?.rows[0].cells.map(Number) ?? [];
  const limit = config.limit;

  let left = 0;
  let sum = 0;
  let longest = 0;
  let index = 0;

  for (let right = 0; right < array.length; right += 1) {
    sum += array[right];
    index += 1;
    while (sum > limit && left <= right) {
      sum -= array[left];
      left += 1;
      index += 1;
    }
    longest = Math.max(longest, right - left + 1);
  }

  if (index !== trace.steps.length) failures.push(`the walk takes ${index} steps but the trace has ${trace.steps.length}`);
  if (config.expect?.longest !== undefined && config.expect.longest !== longest) {
    failures.push(`expected a longest window of ${config.expect.longest}, the walk finds ${longest}`);
  }
  if (!trace.meta.result.title.includes(String(longest))) {
    failures.push(`the result line says “${trace.meta.result.title}” but the walk finds ${longest}`);
  }

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}
