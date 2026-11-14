/**
 * Quick sort: the verified partitions behind the Quick Sort short.
 *
 * Quick sort picks the last value of a range as the pivot, walks the range once
 * moving every smaller value to the left of a growing boundary, then swaps the
 * pivot into that boundary. Everything left of the pivot is smaller and
 * everything right of it is larger, so each side can be sorted independently.
 * The trace records one beat per comparison plus one placement beat per
 * partition, and `validateQuickSortTrace` replays the same partitioning on a
 * plain array, so the animation can only show a partition the algorithm made.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type QuickStep = {
  /** 1-based step number. */
  n: number;
  /** First index of the range being partitioned. */
  lo: number;
  /** Last index of the range being partitioned. */
  hi: number;
  /** The pivot value for this range. */
  pivot: number;
  /** The index the pivot currently sits at. */
  pivotIndex: number;
  /** The index compared with the pivot, or -1 on the placement beat. */
  j: number;
  /** The boundary between smaller values and the rest. */
  boundary: number;
  compared: number | null;
  swapped: boolean;
  /** True on the beat that swaps the pivot into its final index. */
  placed: boolean;
  /** The array after this beat. */
  array: number[];
  comparisons: number;
  swaps: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type QuickTrace = {
  array: number[];
  steps: QuickStep[];
  sorted: number[];
  partitions: number;
  comparisons: number;
  swaps: number;
};

export type QuickExpectation = {
  sorted?: number[];
  partitions?: number;
};

export type QuickSortConfig = {
  kind: 'quick-sort';
  array: number[];
  expect?: QuickExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isQuickSortConfig(config: unknown): config is QuickSortConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'quick-sort' && Array.isArray(record.array);
}

/** Partitions around the last value, then recurses into both sides. */
export function traceQuickSort(input: unknown): QuickTrace {
  const source = cleanArray(input);
  const array = [...source];
  const steps: QuickStep[] = [];
  let comparisons = 0;
  let swaps = 0;
  let partitions = 0;

  const partition = (lo: number, hi: number): number => {
    const pivot = array[hi];
    let boundary = lo;

    for (let j = lo; j < hi; j += 1) {
      comparisons += 1;
      const compared = array[j];
      const swapped = compared < pivot;
      if (swapped && boundary !== j) {
        const held = array[boundary];
        array[boundary] = array[j];
        array[j] = held;
        swaps += 1;
      }
      steps.push({
        n: steps.length + 1,
        lo,
        hi,
        pivot,
        pivotIndex: hi,
        j,
        boundary,
        compared,
        swapped,
        placed: false,
        array: [...array],
        comparisons,
        swaps,
        message: swapped
          ? `${compared} < ${pivot}, so it swaps left of the boundary at ${boundary}.`
          : `${compared} ≥ ${pivot}, so it stays on the right of the boundary.`,
        hudLabel: swapped ? `${compared} → LEFT` : `${compared} STAYS RIGHT`,
        hudDetail: `range ${lo}–${hi} · pivot ${pivot} · ${comparisons} comparison${comparisons === 1 ? '' : 's'}`
      });
      if (swapped) boundary += 1;
    }

    const pivotIndex = boundary;
    if (pivotIndex !== hi) {
      const held = array[pivotIndex];
      array[pivotIndex] = array[hi];
      array[hi] = held;
      swaps += 1;
    }
    partitions += 1;
    steps.push({
      n: steps.length + 1,
      lo,
      hi,
      pivot,
      pivotIndex,
      j: -1,
      boundary: pivotIndex,
      compared: null,
      swapped: false,
      placed: true,
      array: [...array],
      comparisons,
      swaps,
      message: `The pivot ${pivot} moves to index ${pivotIndex}: everything left is smaller, everything right is larger.`,
      hudLabel: `PIVOT ${pivot} AT ${pivotIndex}`,
      hudDetail: `range ${lo}–${hi} settled · ${swaps} swap${swaps === 1 ? '' : 's'}`
    });
    return pivotIndex;
  };

  const sort = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const pivotIndex = partition(lo, hi);
    sort(lo, pivotIndex - 1);
    sort(pivotIndex + 1, hi);
  };

  sort(0, array.length - 1);

  return { array: source, steps, sorted: [...array], partitions, comparisons, swaps };
}

/**
 * Proves the trace is a real quick sort: an independent partitioning replay has
 * to agree with every recorded range, boundary and snapshot, the result has to
 * be the sorted input, and the partition count has to match.
 */
export function validateQuickSortTrace(
  trace: QuickTrace,
  expectation: QuickExpectation | undefined,
  array: number[]
): Validation {
  const failures: string[] = [];
  const source = cleanArray(array);

  if (source.length === 0) return { ok: false, failures: ['The array is empty, so there is nothing to sort.'] };
  if (trace.array.join(',') !== source.join(',')) {
    failures.push(`The trace starts on [${trace.array.join(', ')}] where the array holds [${source.join(', ')}].`);
  }

  const values = [...source];
  let comparisons = 0;
  let swaps = 0;
  let partitions = 0;
  let stepIndex = 0;

  const partition = (lo: number, hi: number): number => {
    const pivot = values[hi];
    let boundary = lo;
    for (let j = lo; j < hi; j += 1) {
      comparisons += 1;
      const smaller = values[j] < pivot;
      if (smaller) {
        if (boundary !== j) {
          const held = values[boundary];
          values[boundary] = values[j];
          values[j] = held;
          swaps += 1;
        }
        boundary += 1;
      }
      const step = trace.steps[stepIndex];
      if (step) {
        if (step.lo !== lo || step.hi !== hi || step.j !== j) {
          failures.push(`Step ${stepIndex + 1} compares ${step.j} in ${step.lo}–${step.hi} where the partition compares ${j} in ${lo}–${hi}.`);
        }
        if (step.swapped !== smaller) {
          failures.push(`Step ${stepIndex + 1} ${step.swapped ? 'moves' : 'keeps'} a value that should ${smaller ? 'move left' : 'stay right'}.`);
        }
        if (step.array.join(',') !== values.join(',')) {
          failures.push(`Step ${stepIndex + 1} shows [${step.array.join(', ')}] where the partition holds [${values.join(', ')}].`);
        }
      }
      stepIndex += 1;
    }

    const pivotIndex = boundary;
    if (pivotIndex !== hi) {
      const held = values[pivotIndex];
      values[pivotIndex] = values[hi];
      values[hi] = held;
      swaps += 1;
    }
    partitions += 1;
    const placing = trace.steps[stepIndex];
    if (placing) {
      if (!placing.placed) failures.push(`Step ${stepIndex + 1} should be the pivot placement for ${lo}–${hi}.`);
      if (placing.pivotIndex !== pivotIndex) {
        failures.push(`Step ${stepIndex + 1} places the pivot at ${placing.pivotIndex} where the partition puts it at ${pivotIndex}.`);
      }
      if (placing.array.join(',') !== values.join(',')) {
        failures.push(`Step ${stepIndex + 1} shows [${placing.array.join(', ')}] where the partition holds [${values.join(', ')}].`);
      }
    }
    stepIndex += 1;
    return pivotIndex;
  };

  const sort = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const pivotIndex = partition(lo, hi);
    sort(lo, pivotIndex - 1);
    sort(pivotIndex + 1, hi);
  };

  sort(0, values.length - 1);

  if (trace.steps.length !== comparisons + partitions) {
    failures.push(`The trace has ${trace.steps.length} beats but the partitions make ${comparisons + partitions}.`);
  }
  if (trace.comparisons !== comparisons) {
    failures.push(`The trace reports ${trace.comparisons} comparisons but the partitions make ${comparisons}.`);
  }
  if (trace.swaps !== swaps) {
    failures.push(`The trace reports ${trace.swaps} swaps but the partitions make ${swaps}.`);
  }
  if (trace.partitions !== partitions) {
    failures.push(`The trace reports ${trace.partitions} partitions but the recursion makes ${partitions}.`);
  }
  const expected = [...source].sort((a, b) => a - b);
  if (trace.sorted.join(',') !== expected.join(',')) {
    failures.push(`The trace ends on [${trace.sorted.join(', ')}] where the sorted array is [${expected.join(', ')}].`);
  }
  if (expectation?.sorted && expectation.sorted.join(',') !== expected.join(',')) {
    failures.push(`The sorted array is [${expected.join(', ')}] but [${expectation.sorted.join(', ')}] was expected.`);
  }
  if (expectation?.partitions !== undefined && expectation.partitions !== partitions) {
    failures.push(`The recursion makes ${partitions} partitions but ${expectation.partitions} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
