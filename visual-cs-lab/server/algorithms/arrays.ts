/**
 * Array traversal: the verified trace behind the Arrays short.
 *
 * Reading a cell by index is one step — the address is base + i × size — but
 * summing every cell is a walk of the whole row. The trace is the second half:
 * one step per cell, each carrying the running total, so the animation can only
 * show sums the array actually produced.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type ArrayStep = {
  /** 1-based visit count. */
  n: number;
  index: number;
  value: number;
  /** Running total after adding this cell. */
  sum: number;
  message: string;
};

export type ArrayTrace = {
  array: number[];
  sum: number;
  steps: ArrayStep[];
};

export type ArrayExpectation = {
  sum?: number;
};

export type ArrayConfig = {
  array: number[];
  expect?: ArrayExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isArrayConfig(config: unknown): config is ArrayConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  // A configuration with a target is a search (binary search), not a traversal.
  return (
    Array.isArray(record.array) &&
    cleanArray(record.array).length > 0 &&
    !record.ops &&
    record.target === undefined &&
    record.kind === undefined
  );
}

/** Walks the array once, left to right, accumulating a total. */
export function traceArray(input: number[]): ArrayTrace {
  const array = cleanArray(input);
  const steps: ArrayStep[] = [];
  let sum = 0;
  array.forEach((value, index) => {
    sum += value;
    steps.push({
      n: index + 1,
      index,
      value,
      sum,
      message: `sum += a[${index}] (${value}) → ${sum}`
    });
  });
  return { array, sum, steps };
}

/**
 * Proves the trace is a real walk of this array: one step per cell in index
 * order, each total equal to the prefix sum, and the final total equal to the
 * value the concept claims.
 */
export function validateArrayTrace(
  trace: ArrayTrace,
  expectation: ArrayExpectation | undefined,
  array: number[]
): Validation {
  const failures: string[] = [];
  const source = cleanArray(array);

  if (source.length === 0) return { ok: false, failures: ['The array is empty, so there is nothing to traverse.'] };
  if (trace.steps.length !== source.length) {
    failures.push(`The trace visits ${trace.steps.length} cells but the array holds ${source.length}.`);
  }

  let running = 0;
  source.forEach((value, index) => {
    running += value;
    const step = trace.steps[index];
    if (!step) return;
    if (step.index !== index) failures.push(`Step ${index + 1} visits index ${step.index} instead of ${index}.`);
    if (step.value !== value) failures.push(`Step ${index + 1} reads ${step.value} where the array holds ${value}.`);
    if (step.sum !== running) failures.push(`Step ${index + 1} reports ${step.sum} where the prefix sum is ${running}.`);
  });

  if (trace.sum !== running) failures.push(`The final total is ${trace.sum} where the array sums to ${running}.`);
  if (expectation?.sum !== undefined && expectation.sum !== trace.sum) {
    failures.push(`The trace totals ${trace.sum} but ${expectation.sum} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}

/** The array a concept animates, or an empty list when it has none. */
export function arrayFromConfig(config: Record<string, unknown>): number[] {
  return cleanArray(config.array);
}

export const DEFAULT_ARRAY = [4, 8, 15, 16, 23];
