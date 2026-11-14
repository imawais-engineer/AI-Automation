/**
 * Insertion sort: the verified inserts behind the Insertion Sort short.
 *
 * The prefix a[0..pass-1] is already sorted. Each pass holds the next value as
 * the key, walks left comparing it with the sorted prefix and shifts every
 * larger value one cell right, then drops the key into the gap. The trace
 * records one step per comparison plus one placement beat per pass, and
 * `validateInsertionSortTrace` replays the same inserts on a plain array before
 * checking the result is genuinely sorted — the animation can only show shifts
 * the algorithm actually made.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type InsertionStep = {
  /** 1-based step number. */
  n: number;
  /** 1-based pass; the prefix before it is already sorted. */
  pass: number;
  /** The index compared with the key, or -1 on the placement beat. */
  j: number;
  /** The value being inserted. */
  key: number;
  /** The value at j, null on the placement beat. */
  compared: number | null;
  /** True when the compared value moved one cell right. */
  shifted: boolean;
  /** True on the beat that drops the key into its gap. */
  placed: boolean;
  /** The array after this beat. */
  array: number[];
  /** Highest index that is settled in the sorted prefix. */
  sortedTo: number;
  comparisons: number;
  shifts: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type InsertionTrace = {
  array: number[];
  steps: InsertionStep[];
  sorted: number[];
  passes: number;
  comparisons: number;
  shifts: number;
};

export type InsertionExpectation = {
  sorted?: number[];
  shifts?: number;
};

export type InsertionSortConfig = {
  kind: 'insertion-sort';
  array: number[];
  expect?: InsertionExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isInsertionSortConfig(config: unknown): config is InsertionSortConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'insertion-sort' && Array.isArray(record.array);
}

/** Grows a sorted prefix by shifting larger values right and dropping the key in. */
export function traceInsertionSort(input: unknown): InsertionTrace {
  const source = cleanArray(input);
  const array = [...source];
  const steps: InsertionStep[] = [];
  let comparisons = 0;
  let shifts = 0;
  let passes = 0;

  for (let pass = 1; pass < array.length; pass += 1) {
    passes = pass;
    const key = array[pass];
    let j = pass - 1;

    while (j >= 0) {
      comparisons += 1;
      const compared = array[j];
      const shifted = compared > key;
      if (shifted) {
        array[j + 1] = array[j];
        shifts += 1;
      }
      steps.push({
        n: steps.length + 1,
        pass,
        j,
        key,
        compared,
        shifted,
        placed: false,
        array: [...array],
        sortedTo: pass - 1,
        comparisons,
        shifts,
        message: shifted
          ? `${compared} > ${key}, so ${compared} shifts one cell right and the gap moves left.`
          : `${compared} ≤ ${key}, so the gap is where ${key} belongs.`,
        hudLabel: shifted ? `SHIFT ${compared} →` : `STOP AT ${compared}`,
        hudDetail: `pass ${pass} · key ${key} · ${comparisons} comparison${comparisons === 1 ? '' : 's'}`
      });
      if (!shifted) break;
      j -= 1;
    }

    array[j + 1] = key;
    steps.push({
      n: steps.length + 1,
      pass,
      j: -1,
      key,
      compared: null,
      shifted: false,
      placed: true,
      array: [...array],
      sortedTo: pass,
      comparisons,
      shifts,
      message: `Insert ${key} at index ${j + 1} — a[0..${pass}] is sorted again.`,
      hudLabel: `INSERT ${key} AT ${j + 1}`,
      hudDetail: `sorted prefix now ${pass + 1} value${pass + 1 === 1 ? '' : 's'} · ${shifts} shift${shifts === 1 ? '' : 's'}`
    });
  }

  return { array: source, steps, sorted: [...array], passes, comparisons, shifts };
}

/**
 * Proves the trace is a real insertion sort: an independent pass-by-pass replay
 * has to agree with every recorded snapshot, the result has to be the sorted
 * input, and the shift count has to match the shifts in the trace.
 */
export function validateInsertionSortTrace(
  trace: InsertionTrace,
  expectation: InsertionExpectation | undefined,
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
  let shifts = 0;
  let stepIndex = 0;

  for (let pass = 1; pass < values.length; pass += 1) {
    const key = values[pass];
    let j = pass - 1;
    while (j >= 0) {
      comparisons += 1;
      const moved = values[j] > key;
      if (moved) {
        values[j + 1] = values[j];
        shifts += 1;
      }
      const step = trace.steps[stepIndex];
      if (step) {
        if (step.pass !== pass || step.j !== j) {
          failures.push(`Step ${stepIndex + 1} compares pass ${step.pass} at ${step.j} where the insert compares pass ${pass} at ${j}.`);
        }
        if (step.shifted !== moved) {
          failures.push(`Step ${stepIndex + 1} ${step.shifted ? 'shifts' : 'keeps'} a value that should ${moved ? 'shift' : 'stay'}.`);
        }
        if (step.array.join(',') !== values.join(',')) {
          failures.push(`Step ${stepIndex + 1} shows [${step.array.join(', ')}] where the insert holds [${values.join(', ')}].`);
        }
      }
      stepIndex += 1;
      if (!moved) break;
      j -= 1;
    }

    values[j + 1] = key;
    const placing = trace.steps[stepIndex];
    if (placing) {
      if (!placing.placed) failures.push(`Step ${stepIndex + 1} should be the placement beat for pass ${pass}.`);
      if (placing.array.join(',') !== values.join(',')) {
        failures.push(`Step ${stepIndex + 1} shows [${placing.array.join(', ')}] after placing ${key} where the insert holds [${values.join(', ')}].`);
      }
    }
    stepIndex += 1;
  }

  const expectedSteps = comparisons + Math.max(0, source.length - 1);
  if (trace.steps.length !== expectedSteps) {
    failures.push(`The trace has ${trace.steps.length} beats but the inserts make ${expectedSteps}.`);
  }
  if (trace.shifts !== shifts) {
    failures.push(`The trace reports ${trace.shifts} shifts but the inserts make ${shifts}.`);
  }
  if (trace.comparisons !== comparisons) {
    failures.push(`The trace reports ${trace.comparisons} comparisons but the inserts make ${comparisons}.`);
  }
  const expected = [...source].sort((a, b) => a - b);
  if (trace.sorted.join(',') !== expected.join(',')) {
    failures.push(`The trace ends on [${trace.sorted.join(', ')}] where the sorted array is [${expected.join(', ')}].`);
  }
  if (expectation?.sorted && expectation.sorted.join(',') !== expected.join(',')) {
    failures.push(`The sorted array is [${expected.join(', ')}] but [${expectation.sorted.join(', ')}] was expected.`);
  }
  if (expectation?.shifts !== undefined && expectation.shifts !== shifts) {
    failures.push(`The inserts make ${shifts} shifts but ${expectation.shifts} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
