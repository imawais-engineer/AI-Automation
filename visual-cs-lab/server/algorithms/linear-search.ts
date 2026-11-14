/**
 * Linear search: the verified scan behind the Linear Search short.
 *
 * Linear search needs no ordering: it compares the target with each cell in turn
 * and stops at the first match. The trace records one step per comparison with
 * the running comparison count, and `validateLinearSearchTrace` replays the scan
 * on a plain array, so the animation can only highlight cells the search really
 * checked.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type LinearSearchStep = {
  /** 1-based comparison number. */
  n: number;
  index: number;
  value: number;
  /** Comparisons made so far, including this one. */
  comparisons: number;
  found: boolean;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type LinearSearchTrace = {
  array: number[];
  target: number;
  steps: LinearSearchStep[];
  foundIndex: number | null;
  comparisons: number;
};

export type LinearSearchExpectation = {
  foundIndex?: number | null;
  comparisons?: number;
};

export type LinearSearchConfig = {
  kind: 'linear-search';
  array: number[];
  target: number;
  expect?: LinearSearchExpectation;
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isLinearSearchConfig(config: unknown): config is LinearSearchConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'linear-search' && Array.isArray(record.array) && Number.isFinite(Number(record.target));
}

/** Scans left to right and stops at the first cell equal to the target. */
export function traceLinearSearch(input: { array: unknown; target: unknown }): LinearSearchTrace {
  const array = cleanArray(input.array);
  const target = Number(input.target);
  const steps: LinearSearchStep[] = [];
  let foundIndex: number | null = null;

  for (let index = 0; index < array.length; index += 1) {
    const value = array[index];
    const found = value === target;
    steps.push({
      n: steps.length + 1,
      index,
      value,
      comparisons: steps.length + 1,
      found,
      message: found
        ? `a[${index}] = ${value} matches ${target} — the scan stops here.`
        : `a[${index}] = ${value} is not ${target} — move one cell right.`,
      hudLabel: found ? `a[${index}] = ${value} · MATCH` : `a[${index}] = ${value} ≠ ${target}`,
      hudDetail: `${steps.length + 1} comparison${steps.length === 0 ? '' : 's'} · ${
        found ? 'found' : `${array.length - index - 1} cell${array.length - index - 1 === 1 ? '' : 's'} left`
      }`
    });
    if (found) {
      foundIndex = index;
      break;
    }
  }

  return { array, target, steps, foundIndex, comparisons: steps.length };
}

/**
 * Proves the trace is a real scan: an independent walk has to agree with every
 * recorded index, value and comparison count, and with the index the search
 * claims to have found.
 */
export function validateLinearSearchTrace(
  trace: LinearSearchTrace,
  expectation: LinearSearchExpectation | undefined,
  array: number[],
  target: number
): Validation {
  const failures: string[] = [];
  const source = cleanArray(array);

  if (source.length === 0) return { ok: false, failures: ['The array is empty, so there is nothing to scan.'] };

  const expectedIndex = source.findIndex((value) => value === target);
  const expectedComparisons = expectedIndex === -1 ? source.length : expectedIndex + 1;

  if (trace.array.join(',') !== source.join(',')) {
    failures.push(`The trace scans [${trace.array.join(', ')}] where the array holds [${source.join(', ')}].`);
  }
  if (trace.steps.length !== expectedComparisons) {
    failures.push(
      `The trace takes ${trace.steps.length} comparisons but the scan needs ${expectedComparisons}.`
    );
  }
  trace.steps.forEach((step, index) => {
    if (step.index !== index) failures.push(`Step ${index + 1} looks at index ${step.index} instead of ${index}.`);
    if (step.value !== source[index]) {
      failures.push(`Step ${index + 1} reads ${step.value} where the array holds ${source[index]}.`);
    }
    if (step.comparisons !== index + 1) {
      failures.push(`Step ${index + 1} reports ${step.comparisons} comparisons instead of ${index + 1}.`);
    }
    const matches = source[index] === target;
    if (step.found !== matches) {
      failures.push(`Step ${index + 1} says ${matches ? 'no match' : 'match'} where a[${index}] is ${source[index]}.`);
    }
  });

  const foundIndex = expectedIndex === -1 ? null : expectedIndex;
  if (trace.foundIndex !== foundIndex) {
    failures.push(`The trace found index ${String(trace.foundIndex)} where the scan finds ${String(foundIndex)}.`);
  }
  if (trace.comparisons !== expectedComparisons) {
    failures.push(`The trace counts ${trace.comparisons} comparisons where the scan makes ${expectedComparisons}.`);
  }
  if (expectation?.foundIndex !== undefined && expectation.foundIndex !== foundIndex) {
    failures.push(`The scan finds index ${String(foundIndex)} but ${String(expectation.foundIndex)} was expected.`);
  }
  if (expectation?.comparisons !== undefined && expectation.comparisons !== expectedComparisons) {
    failures.push(`The scan makes ${expectedComparisons} comparisons but ${expectation.comparisons} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}
