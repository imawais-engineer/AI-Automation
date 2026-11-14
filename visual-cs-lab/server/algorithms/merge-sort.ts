/**
 * Merge sort: the verified merges behind the Merge Sort short.
 *
 * Merge sort splits the array in half until each piece holds one value, then
 * merges neighbouring sorted runs back together in linear time. The trace
 * records one beat per merge: the range being joined, its two halves' boundary
 * and the array afterwards. `validateMergeSortTrace` replays the same recursion
 * on a plain array and compares every recorded snapshot, so the animation can
 * only show a merge the algorithm actually performed.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type MergeStep = {
  /** 1-based merge number. */
  n: number;
  /** First index of the range being merged. */
  lo: number;
  /** Last index of the left half. */
  mid: number;
  /** Last index of the range (inclusive). */
  hi: number;
  /** How deep in the recursion tree this merge happens. */
  depth: number;
  /** The array after the merge. */
  array: number[];
  /** The merged values for [lo..hi]. */
  merged: number[];
  comparisons: number;
  merges: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type MergeTrace = {
  array: number[];
  steps: MergeStep[];
  sorted: number[];
  merges: number;
  comparisons: number;
  depth: number;
};

export type MergeExpectation = {
  sorted?: number[];
  merges?: number;
};

export type MergeSortConfig = {
  kind: 'merge-sort';
  array: number[];
  expect?: MergeExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isMergeSortConfig(config: unknown): config is MergeSortConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'merge-sort' && Array.isArray(record.array);
}

/** Recurses to single values, then records one beat per merge back up. */
export function traceMergeSort(input: unknown): MergeTrace {
  const source = cleanArray(input);
  const array = [...source];
  const steps: MergeStep[] = [];
  let comparisons = 0;
  let merges = 0;
  let deepest = 0;

  const sort = (lo: number, hi: number): void => {
    if (hi - lo <= 1) return;
    const mid = lo + Math.floor((hi - lo) / 2);
    sort(lo, mid);
    sort(mid, hi);

    const left = array.slice(lo, mid);
    const right = array.slice(mid, hi);
    let i = 0;
    let j = 0;
    let write = lo;
    while (i < left.length && j < right.length) {
      comparisons += 1;
      if (left[i] <= right[j]) {
        array[write] = left[i];
        i += 1;
      } else {
        array[write] = right[j];
        j += 1;
      }
      write += 1;
    }
    while (i < left.length) {
      array[write] = left[i];
      i += 1;
      write += 1;
    }
    while (j < right.length) {
      array[write] = right[j];
      j += 1;
      write += 1;
    }

    merges += 1;
    const depth = Math.ceil(Math.log2(Math.max(1, hi - lo)));
    deepest = Math.max(deepest, depth);
    const merged = array.slice(lo, hi);
    steps.push({
      n: merges,
      lo,
      mid,
      hi,
      depth,
      array: [...array],
      merged,
      comparisons,
      merges,
      message: `Merge [${left.join(', ')}] with [${right.join(', ')}] into [${merged.join(', ')}] for indices ${lo}–${hi - 1}.`,
      hudLabel: `MERGE ${lo}–${hi - 1}`,
      hudDetail: `${merged.length} values · ${comparisons} comparison${comparisons === 1 ? '' : 's'} · depth ${depth}`
    });
  };

  if (array.length > 1) sort(0, array.length);

  return { array: source, steps, sorted: [...array], merges, comparisons, depth: deepest };
}

/**
 * Proves the trace is a real merge sort: an independent recursive replay has to
 * agree with every recorded range and snapshot, the result has to be the sorted
 * input, and the merge count has to match.
 */
export function validateMergeSortTrace(
  trace: MergeTrace,
  expectation: MergeExpectation | undefined,
  array: number[]
): Validation {
  const failures: string[] = [];
  const source = cleanArray(array);

  if (source.length === 0) return { ok: false, failures: ['The array is empty, so there is nothing to sort.'] };
  if (trace.array.join(',') !== source.join(',')) {
    failures.push(`The trace starts on [${trace.array.join(', ')}] where the array holds [${source.join(', ')}].`);
  }

  const values = [...source];
  let merges = 0;
  let comparisons = 0;
  let stepIndex = 0;

  const sort = (lo: number, hi: number): void => {
    if (hi - lo <= 1) return;
    const mid = lo + Math.floor((hi - lo) / 2);
    sort(lo, mid);
    sort(mid, hi);

    const joined: number[] = [];
    let i = lo;
    let j = mid;
    while (i < mid && j < hi) {
      comparisons += 1;
      if (values[i] <= values[j]) {
        joined.push(values[i]);
        i += 1;
      } else {
        joined.push(values[j]);
        j += 1;
      }
    }
    while (i < mid) {
      joined.push(values[i]);
      i += 1;
    }
    while (j < hi) {
      joined.push(values[j]);
      j += 1;
    }
    for (let k = 0; k < joined.length; k += 1) values[lo + k] = joined[k];

    merges += 1;
    const step = trace.steps[stepIndex];
    if (step) {
      if (step.lo !== lo || step.mid !== mid || step.hi !== hi) {
        failures.push(`Step ${stepIndex + 1} merges ${step.lo}–${step.hi} around ${step.mid} where the sort merges ${lo}–${hi - 1} around ${mid}.`);
      }
      if (step.array.join(',') !== values.join(',')) {
        failures.push(`Step ${stepIndex + 1} shows [${step.array.join(', ')}] where the sort holds [${values.join(', ')}].`);
      }
      if (step.merged.join(',') !== values.slice(lo, hi).join(',')) {
        failures.push(`Step ${stepIndex + 1} reports [${step.merged.join(', ')}] for ${lo}–${hi - 1} where the sort produced [${values.slice(lo, hi).join(', ')}].`);
      }
    }
    stepIndex += 1;
  };

  if (values.length > 1) sort(0, values.length);

  if (trace.steps.length !== merges) {
    failures.push(`The trace has ${trace.steps.length} merges but the recursion performs ${merges}.`);
  }
  if (trace.merges !== merges) {
    failures.push(`The trace reports ${trace.merges} merges but the recursion performs ${merges}.`);
  }
  if (trace.comparisons !== comparisons) {
    failures.push(`The trace reports ${trace.comparisons} comparisons but the merges make ${comparisons}.`);
  }
  const expected = [...source].sort((a, b) => a - b);
  if (trace.sorted.join(',') !== expected.join(',')) {
    failures.push(`The trace ends on [${trace.sorted.join(', ')}] where the sorted array is [${expected.join(', ')}].`);
  }
  if (expectation?.sorted && expectation.sorted.join(',') !== expected.join(',')) {
    failures.push(`The sorted array is [${expected.join(', ')}] but [${expectation.sorted.join(', ')}] was expected.`);
  }
  if (expectation?.merges !== undefined && expectation.merges !== merges) {
    failures.push(`The recursion performs ${merges} merges but ${expectation.merges} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
