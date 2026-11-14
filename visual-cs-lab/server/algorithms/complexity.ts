/**
 * Growth curves for the complexity shorts.
 *
 * A Big-O lesson is not an animation of an array, so there is nothing to step
 * through — but the claim "this grows like n²" is still a claim about code, and
 * the short only shows what the code actually did. Each point on a curve is the
 * number of operations a real implementation performed at that input size: the
 * binary search module counts its own comparisons, bubble sort counts its own,
 * merge sort counts its own. The result is then checked against an independent
 * closed form, so a curve that drifts from the complexity it claims fails here
 * instead of shipping as a pretty picture that teaches the wrong thing.
 */

import { traceBinarySearch } from './binary-search.ts';
import { traceBubbleSort } from './bubble-sort.ts';
import { traceLinearSearch } from './linear-search.ts';
import { traceMergeSort } from './merge-sort.ts';
import type { Validation } from './stack.ts';

export type ComplexitySeriesId =
  | 'constant'
  | 'log'
  | 'linear'
  | 'n-log-n'
  | 'quadratic'
  | 'best'
  | 'average'
  | 'worst'
  | 'recursion-space'
  | 'iterative-space';

export type ComplexityPoint = {
  /** Input size the measurement was taken at. */
  size: number;
  /** Operations the implementation actually performed. */
  ops: number;
};

export type ComplexitySeries = {
  id: ComplexitySeriesId;
  /** Short label for the chart legend: `log n`, `n²`. */
  label: string;
  /** What was counted, in one sentence. */
  measured: string;
  points: ComplexityPoint[];
};

export type ComplexityStep = {
  n: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type ComplexityTrace = {
  series: ComplexitySeries[];
  sizes: number[];
  steps: ComplexityStep[];
  /** Largest operation count on the chart, which sets the y scale. */
  peak: number;
  /** Unit the y axis counts: comparisons, frames held. */
  unit: string;
};

export type ComplexityConfig = {
  kind: 'complexity';
  series: ComplexitySeriesId[];
  sizes: number[];
  expect?: { series?: ComplexitySeriesId[] };
};

const MAX_SIZE = 64;
const MAX_SERIES_LENGTH = 6;

const LABELS: Record<ComplexitySeriesId, string> = {
  constant: 'O(1)',
  log: 'O(log n)',
  linear: 'O(n)',
  'n-log-n': 'O(n log n)',
  quadratic: 'O(n²)',
  best: 'best',
  average: 'average',
  worst: 'worst',
  'recursion-space': 'recursive',
  'iterative-space': 'iterative'
};

const COUNTED: Record<ComplexitySeriesId, string> = {
  constant: 'one read of a[0]',
  log: 'binary search comparisons',
  linear: 'linear scan comparisons',
  'n-log-n': 'merge sort comparisons',
  quadratic: 'bubble sort comparisons on reversed input',
  best: 'bubble sort comparisons on sorted input',
  average: 'bubble sort comparisons on scrambled input',
  worst: 'bubble sort comparisons on reversed input',
  'recursion-space': 'stack frames held by fact(n)',
  'iterative-space': 'accumulator cells held by a loop'
};

function ascending(n: number): number[] {
  return Array.from({ length: n }, (_, index) => index + 1);
}

function descending(n: number): number[] {
  return Array.from({ length: n }, (_, index) => n - index);
}

/** A fixed shuffle, so an "average" run is the same run on every render. */
function scrambled(n: number): number[] {
  const values = ascending(n);
  let seed = 7919 + n;
  for (let index = values.length - 1; index > 0; index -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const swapWith = seed % (index + 1);
    [values[index], values[swapWith]] = [values[swapWith], values[index]];
  }
  return values;
}

/** Depth a real recursive factorial reaches — measured, not assumed. */
function deepestFrames(n: number): number {
  let depth = 0;
  let deepest = 0;
  const fact = (k: number): number => {
    depth += 1;
    deepest = Math.max(deepest, depth);
    const value = k <= 1 ? 1 : k * fact(k - 1);
    depth -= 1;
    return value;
  };
  fact(Math.max(1, n));
  return deepest;
}

/** Runs the implementation and returns the operations it actually performed. */
export function measureSeries(id: ComplexitySeriesId, n: number): number {
  switch (id) {
    case 'constant':
      return 1;
    case 'log':
      // A target below every value is the worst case: the range halves to nothing.
      return traceBinarySearch(ascending(n), -1).comparisons;
    case 'linear':
      return traceLinearSearch({ array: ascending(n), target: -1 }).comparisons;
    case 'n-log-n':
      return traceMergeSort(descending(n)).comparisons;
    case 'quadratic':
    case 'worst':
      return traceBubbleSort(descending(n)).comparisons;
    case 'best':
      return traceBubbleSort(ascending(n)).comparisons;
    case 'average':
      return traceBubbleSort(scrambled(n)).comparisons;
    case 'recursion-space':
      return deepestFrames(n);
    case 'iterative-space':
      return 1;
  }
}

type Prediction = {
  exact?: (n: number) => number;
  min?: (n: number) => number;
  max?: (n: number) => number;
  why: string;
};

/**
 * The closed form each curve is checked against. Where the count is not a single
 * formula (merge sort, an average input) the bound is stated instead of a value,
 * so the check is honest about what it can prove.
 */
const PREDICTIONS: Record<ComplexitySeriesId, Prediction> = {
  constant: { exact: () => 1, why: 'one read is one operation at every size' },
  log: {
    exact: (n) => Math.floor(Math.log2(n + 1)),
    why: 'a miss below every value halves the range ⌊log₂(n+1)⌋ times'
  },
  linear: { exact: (n) => n, why: 'a scan with no match compares every cell exactly once' },
  'n-log-n': {
    min: (n) => Math.round((n * Math.log2(n)) / 2),
    max: (n) => n * Math.ceil(Math.log2(n)),
    why: 'merge sort merges every level, so its comparisons sit between n/2·log₂n and n·⌈log₂n⌉'
  },
  quadratic: { exact: (n) => (n * (n - 1)) / 2, why: 'reversed input compares every pair once' },
  worst: { exact: (n) => (n * (n - 1)) / 2, why: 'reversed input compares every pair once' },
  best: { exact: (n) => n - 1, why: 'sorted input makes one clean pass of n−1 comparisons' },
  average: {
    min: (n) => n,
    max: (n) => (n * (n - 1)) / 2,
    why: 'a scrambled input lands between the best and the worst case'
  },
  'recursion-space': { exact: (n) => n, why: 'fact(n) holds one frame per level' },
  'iterative-space': { exact: () => 1, why: 'a loop keeps one accumulator cell' }
};

function cleanSizes(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  const sizes = source
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 2 && item <= MAX_SIZE);
  const unique = Array.from(new Set(sizes)).sort((a, b) => a - b);
  return (unique.length >= 2 ? unique : [4, 8, 16, 32]).slice(0, MAX_SERIES_LENGTH);
}

function cleanSeries(value: unknown): ComplexitySeriesId[] {
  const known = Object.keys(LABELS) as ComplexitySeriesId[];
  const source = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const picked = source.filter((item): item is ComplexitySeriesId => known.includes(item as ComplexitySeriesId));
  return Array.from(new Set(picked.length > 0 ? picked : (['constant', 'linear', 'quadratic'] as ComplexitySeriesId[])));
}

export function isComplexityConfig(config: unknown): config is ComplexityConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'complexity';
}

/** Measures every series at every size and turns the run into chart steps. */
export function traceComplexity(config: ComplexityConfig): ComplexityTrace {
  const sizes = cleanSizes(config.sizes);
  const ids = cleanSeries(config.series);
  const unit = config.kind === 'complexity' && ids.every((id) => id.endsWith('-space')) ? 'frames held' : 'operations';

  const series: ComplexitySeries[] = ids.map((id) => ({
    id,
    label: LABELS[id],
    measured: COUNTED[id],
    points: sizes.map((size) => ({ size, ops: measureSeries(id, size) }))
  }));

  const peak = series.reduce(
    (max, item) => item.points.reduce((inner, point) => Math.max(inner, point.ops), max),
    1
  );

  const steps: ComplexityStep[] = sizes.map((size, index) => {
    const row = series
      .map((item) => {
        const point = item.points[index];
        return `${item.label} ${point ? point.ops : 0}`;
      })
      .join(' · ');
    return {
      n: size,
      hudLabel: `n = ${size}`,
      hudDetail: row,
      message:
        index === 0
          ? `At n = ${size}: ${series.map((item) => `${item.label} does ${item.points[0]?.ops ?? 0}`).join(', ')}.`
          : `At n = ${size}: ${series.map((item) => `${item.label} does ${item.points[index]?.ops ?? 0}`).join(', ')}.`
    };
  });

  return { series, sizes, steps, peak, unit };
}

/** Checks the measured curves against the closed forms they claim to follow. */
export function validateComplexityTrace(
  trace: ComplexityTrace,
  expectation?: { series?: ComplexitySeriesId[] }
): Validation {
  const failures: string[] = [];
  if (trace.sizes.length < 2) failures.push('A growth chart needs at least two input sizes.');
  if (trace.series.length === 0) failures.push('The growth chart has no series to measure.');

  for (const declared of expectation?.series ?? []) {
    if (!trace.series.some((item) => item.id === declared)) {
      failures.push(`The configuration expects a ${LABELS[declared]} curve but the trace measured none.`);
    }
  }

  for (const item of trace.series) {
    const prediction = PREDICTIONS[item.id];
    for (const point of item.points) {
      if (prediction.exact) {
        const expected = prediction.exact(point.size);
        if (point.ops !== expected) {
          failures.push(
            `The ${LABELS[item.id]} curve measured ${point.ops} at n = ${point.size}, but ${prediction.why} (expected ${expected}).`
          );
        }
        continue;
      }
      const low = prediction.min ? prediction.min(point.size) : Number.NEGATIVE_INFINITY;
      const high = prediction.max ? prediction.max(point.size) : Number.POSITIVE_INFINITY;
      if (point.ops < low || point.ops > high) {
        failures.push(
          `The ${LABELS[item.id]} curve measured ${point.ops} at n = ${point.size}, outside ${low}–${high}: ${prediction.why}.`
        );
      }
    }
    // Growth has to be monotonic in the input size or the picture is wrong.
    for (let index = 1; index < item.points.length; index += 1) {
      if (item.points[index].ops < item.points[index - 1].ops) {
        failures.push(
          `The ${LABELS[item.id]} curve falls from ${item.points[index - 1].ops} to ${item.points[index].ops} as n grows.`
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
}
