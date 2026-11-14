/**
 * Bubble sort: the verified passes behind the Bubble Sort short.
 *
 * Bubble sort compares neighbours and swaps them when they are out of order, so
 * after each pass the largest remaining value has bubbled to the end of the
 * unsorted run. The trace records one step per comparison with the array after
 * the comparison, and `validateBubbleSortTrace` replays the same passes on a
 * plain array before checking the result is genuinely sorted — the animation can
 * only show swaps the algorithm actually made.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type BubbleStep = {
  /** 1-based comparison number. */
  n: number;
  /** 1-based pass number. */
  pass: number;
  /** Left index of the compared pair. */
  i: number;
  /** Right index of the compared pair. */
  j: number;
  left: number;
  right: number;
  swapped: boolean;
  /** The array after this comparison. */
  array: number[];
  /** Indices from here to the end are already final. */
  sortedFrom: number;
  comparisons: number;
  swaps: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type BubbleTrace = {
  array: number[];
  steps: BubbleStep[];
  sorted: number[];
  passes: number;
  comparisons: number;
  swaps: number;
};

export type BubbleExpectation = {
  sorted?: number[];
  swaps?: number;
};

export type BubbleSortConfig = {
  kind: 'bubble-sort';
  array: number[];
  expect?: BubbleExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isBubbleSortConfig(config: unknown): config is BubbleSortConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'bubble-sort' && Array.isArray(record.array);
}

/** Sorts by repeated neighbour comparison, stopping early on a clean pass. */
export function traceBubbleSort(input: unknown): BubbleTrace {
  const array = cleanArray(input);
  const steps: BubbleStep[] = [];
  let comparisons = 0;
  let swaps = 0;
  let passes = 0;

  for (let pass = 1; pass <= array.length - 1; pass += 1) {
    let swapped = false;
    for (let i = 0; i < array.length - pass; i += 1) {
      const j = i + 1;
      const left = array[i];
      const right = array[j];
      comparisons += 1;
      const didSwap = left > right;
      if (didSwap) {
        array[i] = right;
        array[j] = left;
        swaps += 1;
        swapped = true;
      }
      steps.push({
        n: steps.length + 1,
        pass,
        i,
        j,
        left,
        right,
        swapped: didSwap,
        array: [...array],
        sortedFrom: array.length - (pass - 1),
        comparisons,
        swaps,
        message: didSwap
          ? `${left} > ${right}, so the pair swaps — ${right} moves left, ${left} bubbles right.`
          : `${left} ≤ ${right}, already in order — leave the pair alone.`,
        hudLabel: didSwap ? `SWAP ${left} ↔ ${right}` : `KEEP ${left}, ${right}`,
        hudDetail: `pass ${pass} · ${comparisons} comparison${comparisons === 1 ? '' : 's'} · ${swaps} swap${
          swaps === 1 ? '' : 's'
        }`
      });
    }
    passes = pass;
    if (!swapped) break;
  }

  return { array: cleanArray(input), steps, sorted: [...array], passes, comparisons, swaps };
}

/**
 * Proves the trace is a real bubble sort: an independent pass-by-pass replay has
 * to agree with every recorded snapshot, the result has to be the sorted input,
 * and the swap count has to match the swaps in the trace.
 */
export function validateBubbleSortTrace(
  trace: BubbleTrace,
  expectation: BubbleExpectation | undefined,
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
  let stepIndex = 0;

  for (let pass = 1; pass <= values.length - 1; pass += 1) {
    let swapped = false;
    for (let i = 0; i < values.length - pass; i += 1) {
      const j = i + 1;
      const left = values[i];
      const right = values[j];
      comparisons += 1;
      if (left > right) {
        values[i] = right;
        values[j] = left;
        swaps += 1;
        swapped = true;
      }
      const step = trace.steps[stepIndex];
      if (step) {
        if (step.i !== i || step.j !== j) {
          failures.push(`Step ${stepIndex + 1} compares (${step.i}, ${step.j}) where the pass compares (${i}, ${j}).`);
        }
        if (step.left !== left || step.right !== right) {
          failures.push(`Step ${stepIndex + 1} compares ${step.left} and ${step.right} where the pass compares ${left} and ${right}.`);
        }
        if (step.swapped !== left > right) {
          failures.push(`Step ${stepIndex + 1} ${step.swapped ? 'swaps' : 'keeps'} a pair that should ${left > right ? 'swap' : 'stay'}.`);
        }
        if (step.array.join(',') !== values.join(',')) {
          failures.push(`Step ${stepIndex + 1} shows [${step.array.join(', ')}] where the pass holds [${values.join(', ')}].`);
        }
      }
      stepIndex += 1;
    }
    if (!swapped) break;
  }

  if (trace.steps.length !== comparisons) {
    failures.push(`The trace has ${trace.steps.length} comparisons but the passes make ${comparisons}.`);
  }
  if (trace.swaps !== swaps) {
    failures.push(`The trace reports ${trace.swaps} swaps but the passes make ${swaps}.`);
  }
  const expected = [...source].sort((a, b) => a - b);
  if (trace.sorted.join(',') !== expected.join(',')) {
    failures.push(`The trace ends on [${trace.sorted.join(', ')}] where the sorted array is [${expected.join(', ')}].`);
  }
  values.forEach((value, index) => {
    if (value !== expected[index]) failures.push(`The replay leaves ${value} at index ${index} where ${expected[index]} belongs.`);
  });
  if (expectation?.sorted && expectation.sorted.join(',') !== expected.join(',')) {
    failures.push(`The array sorts to [${expected.join(', ')}] but [${expectation.sorted.join(', ')}] was expected.`);
  }
  if (expectation?.swaps !== undefined && expectation.swaps !== swaps) {
    failures.push(`The passes make ${swaps} swaps but ${expectation.swaps} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
