/**
 * Trusted iterative binary search and event tracer.
 *
 * Precondition: the input array must be sorted in non-decreasing order. The
 * search uses inclusive `low` and `high` bounds and `mid = floor((low + high) / 2)`.
 *
 * The storyboard and the video renderer consume the step list produced here;
 * nothing is hand-animated. `validateBinarySearchTrace()` is the correctness gate
 * a lesson has to pass before it can be rendered.
 */

export type BinarySearchComparison = 'less' | 'greater' | 'equal';

export type BinarySearchStep = {
  /** 1-based step number. */
  n: number;
  /** Inclusive low bound before the comparison. */
  low: number;
  /** Inclusive high bound before the comparison. */
  high: number;
  mid: number;
  midValue: number;
  target: number;
  /** How a[mid] compares with the target. */
  comparison: BinarySearchComparison;
  /** Inclusive low bound after the step. */
  nextLow: number;
  /** Inclusive high bound after the step. */
  nextHigh: number;
  /** Indices the comparison discarded (empty for a match). */
  eliminated: number[];
  foundIndex: number | null;
  message: string;
};

export type BinarySearchExpectation = {
  foundIndex?: number | null;
  steps?: number;
};

export type BinarySearchConfig = {
  kind: 'binary-search';
  array: number[];
  target: number;
  expect?: BinarySearchExpectation;
};

export type BinarySearchTrace = {
  steps: BinarySearchStep[];
  foundIndex: number;
  comparisons: number;
  summary: string;
  errors: string[];
};

export type Validation = { ok: boolean; failures: string[] };

export function isSortedAscending(array: number[]): boolean {
  for (let i = 1; i < array.length; i++) {
    if (array[i - 1] > array[i]) return false;
  }
  return true;
}

export function isBinarySearchConfig(config: unknown): config is BinarySearchConfig {
  if (!config || typeof config !== 'object') return false;
  const candidate = config as Record<string, unknown>;
  return candidate.kind === 'binary-search' || Array.isArray(candidate.array);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function inputErrors(array: unknown, target: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(array)) {
    errors.push('The animation configuration needs an array of numbers.');
    return errors;
  }
  if (array.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push('Every value in the array must be a finite number.');
  }
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    errors.push('The animation configuration needs a numeric target.');
  }
  return errors;
}

/**
 * Runs the trusted search and records one step per comparison.
 *
 * Empty arrays, targets below the minimum, targets above the maximum and missing
 * targets all return `foundIndex: -1` with a message explaining where the range
 * collapsed. An unsorted array is reported as an error: the precondition is part
 * of the algorithm, not a suggestion.
 */
export function traceBinarySearch(array: number[], target: number): BinarySearchTrace {
  const errors = inputErrors(array, target);
  if (errors.length > 0) {
    return { steps: [], foundIndex: -1, comparisons: 0, summary: 'No trace could be produced.', errors };
  }

  if (!isSortedAscending(array)) {
    return {
      steps: [],
      foundIndex: -1,
      comparisons: 0,
      summary: 'The input is not sorted.',
      errors: [
        'Binary search requires a sorted array (ascending order). This configuration is not sorted, so no trace can be verified.'
      ]
    };
  }

  const steps: BinarySearchStep[] = [];
  let low = 0;
  let high = array.length - 1;
  let foundIndex = -1;

  if (array.length === 0) {
    return {
      steps,
      foundIndex,
      comparisons: 0,
      summary: 'The array is empty, so nothing can be found.',
      errors: []
    };
  }

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midValue = array[mid];

    if (midValue === target) {
      steps.push({
        n: steps.length + 1,
        low,
        high,
        mid,
        midValue,
        target,
        comparison: 'equal',
        nextLow: mid,
        nextHigh: mid,
        eliminated: [],
        foundIndex: mid,
        message: `a[${mid}] = ${midValue} equals ${target}: found at index ${mid}.`
      });
      foundIndex = mid;
      break;
    }

    if (midValue < target) {
      const nextLow = mid + 1;
      steps.push({
        n: steps.length + 1,
        low,
        high,
        mid,
        midValue,
        target,
        comparison: 'less',
        nextLow,
        nextHigh: high,
        eliminated: range(low, mid),
        foundIndex: null,
        message: `a[${mid}] = ${midValue} < ${target}: discard the left half, low = ${nextLow}.`
      });
      low = nextLow;
      continue;
    }

    const nextHigh = mid - 1;
    steps.push({
      n: steps.length + 1,
      low,
      high,
      mid,
      midValue,
      target,
      comparison: 'greater',
      nextLow: low,
      nextHigh,
      eliminated: range(mid, high),
      foundIndex: null,
      message: `a[${mid}] = ${midValue} > ${target}: discard the right half, high = ${nextHigh}.`
    });
    high = nextHigh;
  }

  const summary =
    foundIndex >= 0
      ? `${target} found at index ${foundIndex} after ${steps.length} comparison${steps.length === 1 ? '' : 's'}.`
      : `${target} is not in the array: the range collapsed after ${steps.length} comparison${steps.length === 1 ? '' : 's'}.`;

  return { steps, foundIndex, comparisons: steps.length, summary, errors: [] };
}

/**
 * Re-checks a trace against the input, an independent linear-scan reference and
 * the concept's expected result. Anything that does not line up is a failure, so
 * a lesson cannot render from an unverified demonstration.
 */
export function validateBinarySearchTrace(
  trace: BinarySearchTrace,
  expectation: BinarySearchExpectation | undefined,
  array: number[],
  target: number
): Validation {
  const failures: string[] = [...trace.errors];

  if (!expectation || (expectation.foundIndex === undefined && expectation.steps === undefined)) {
    failures.push('The animation configuration has no expected result to verify against.');
  }

  // Independent reference: a linear scan of the same input.
  const reference = Array.isArray(array) ? array.indexOf(target) : -1;
  if (trace.foundIndex >= 0) {
    if (array[trace.foundIndex] !== target) {
      failures.push(`The trace reports index ${trace.foundIndex}, but a[${trace.foundIndex}] is not ${target}.`);
    }
    if (reference >= 0 && array[reference] !== target) {
      failures.push(`A linear scan of the same input reports index ${reference}, which does not hold ${target}.`);
    }
  } else if (reference >= 0) {
    failures.push(`The trace reports ${target} is missing, but a linear scan finds it at index ${reference}.`);
  }
  if (trace.foundIndex < 0 && trace.steps.some((step) => step.comparison === 'equal')) {
    failures.push('The trace compares as equal but does not report a found index.');
  }

  trace.steps.forEach((step) => {
    const label = `Step ${step.n}`;
    if (step.low > step.high) failures.push(`${label}: the search range is empty before the comparison.`);
    if (step.mid < step.low || step.mid > step.high) {
      failures.push(`${label}: mid ${step.mid} is outside the range ${step.low}–${step.high}.`);
    }
    if (step.mid !== Math.floor((step.low + step.high) / 2)) {
      failures.push(`${label}: mid must be floor((${step.low} + ${step.high}) / 2).`);
    }
    if (array[step.mid] !== step.midValue) {
      failures.push(`${label}: a[${step.mid}] is ${String(array[step.mid])} but the trace read ${step.midValue}.`);
    }
    if (step.comparison === 'equal' && step.midValue !== target) {
      failures.push(`${label}: a match is reported but ${step.midValue} is not ${target}.`);
    }
    if (step.comparison === 'less') {
      if (!(step.midValue < target)) failures.push(`${label}: a[${step.mid}] is not smaller than the target.`);
      if (step.nextLow !== step.mid + 1 || step.nextHigh !== step.high) {
        failures.push(`${label}: a smaller value must move low to ${step.mid + 1} and keep high at ${step.high}.`);
      }
    }
    if (step.comparison === 'greater') {
      if (!(step.midValue > target)) failures.push(`${label}: a[${step.mid}] is not larger than the target.`);
      if (step.nextHigh !== step.mid - 1 || step.nextLow !== step.low) {
        failures.push(`${label}: a larger value must move high to ${step.mid - 1} and keep low at ${step.low}.`);
      }
    }
    if (step.comparison === 'equal' && step.foundIndex !== step.mid) {
      failures.push(`${label}: a match must report index ${step.mid}.`);
    }
  });

  if (expectation?.foundIndex !== undefined && expectation.foundIndex !== trace.foundIndex) {
    failures.push(
      `The trace returns index ${trace.foundIndex} but the configuration expects ${String(expectation.foundIndex)}.`
    );
  }
  if (expectation?.steps !== undefined && expectation.steps !== trace.steps.length) {
    failures.push(
      `The trace runs ${trace.steps.length} comparisons but the configuration expects ${expectation.steps}.`
    );
  }

  return { ok: failures.length === 0, failures };
}
