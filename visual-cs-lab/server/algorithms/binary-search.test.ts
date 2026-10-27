import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSortedAscending,
  traceBinarySearch,
  validateBinarySearchTrace
} from './binary-search.ts';

const EXAMPLE = [1, 3, 5, 7, 9];

test('example: target 7 in [1,3,5,7,9] is at index 3 after two comparisons', () => {
  const run = traceBinarySearch(EXAMPLE, 7);

  assert.deepEqual(run.errors, []);
  assert.equal(run.foundIndex, 3);
  assert.equal(run.comparisons, 2);
  assert.equal(run.steps.length, 2);

  const [first, second] = run.steps;
  assert.deepEqual(
    { low: first.low, high: first.high, mid: first.mid, value: first.midValue },
    { low: 0, high: 4, mid: 2, value: 5 }
  );
  assert.equal(first.comparison, 'less');
  assert.deepEqual(first.eliminated, [0, 1, 2]);
  assert.equal(first.nextLow, 3);
  assert.equal(first.nextHigh, 4);

  assert.deepEqual(
    { low: second.low, high: second.high, mid: second.mid, value: second.midValue },
    { low: 3, high: 4, mid: 3, value: 7 }
  );
  assert.equal(second.comparison, 'equal');
  assert.equal(second.foundIndex, 3);
  assert.deepEqual(second.eliminated, []);
});

test('example: the configured expectation verifies', () => {
  const run = traceBinarySearch(EXAMPLE, 7);
  const result = validateBinarySearchTrace(run, { foundIndex: 3, steps: 2 }, EXAMPLE, 7);
  assert.deepEqual(result, { ok: true, failures: [] });
});

test('every step uses floor((low + high) / 2) inside the inclusive range', () => {
  const run = traceBinarySearch([2, 4, 6, 8, 10, 12, 14], 14);
  for (const step of run.steps) {
    assert.equal(step.mid, Math.floor((step.low + step.high) / 2));
    assert.ok(step.low <= step.mid && step.mid <= step.high);
  }
  assert.equal(run.foundIndex, 6);
});

test('empty array: nothing to search, index -1 and no steps', () => {
  const run = traceBinarySearch([], 7);
  assert.deepEqual(run.errors, []);
  assert.equal(run.foundIndex, -1);
  assert.equal(run.steps.length, 0);
  assert.match(run.summary, /empty/i);

  const result = validateBinarySearchTrace(run, { foundIndex: -1, steps: 0 }, [], 7);
  assert.equal(result.ok, true);
});

test('target smaller than the minimum returns -1', () => {
  const run = traceBinarySearch(EXAMPLE, 0);
  assert.equal(run.foundIndex, -1);
  assert.ok(run.steps.every((step) => step.comparison === 'greater'));
  assert.equal(validateBinarySearchTrace(run, { foundIndex: -1 }, EXAMPLE, 0).ok, true);
});

test('target larger than the maximum returns -1', () => {
  const run = traceBinarySearch(EXAMPLE, 10);
  assert.equal(run.foundIndex, -1);
  assert.ok(run.steps.every((step) => step.comparison === 'less'));
  assert.equal(validateBinarySearchTrace(run, { foundIndex: -1 }, EXAMPLE, 10).ok, true);
});

test('target missing from inside the range returns -1', () => {
  const run = traceBinarySearch(EXAMPLE, 6);
  assert.equal(run.foundIndex, -1);
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0].comparison, 'less');
  assert.equal(run.steps[1].comparison, 'greater');
  assert.equal(validateBinarySearchTrace(run, { foundIndex: -1 }, EXAMPLE, 6).ok, true);
});

test('single-element array: found and not found', () => {
  const found = traceBinarySearch([4], 4);
  assert.equal(found.foundIndex, 0);
  assert.equal(found.steps.length, 1);

  const missing = traceBinarySearch([4], 9);
  assert.equal(missing.foundIndex, -1);
  assert.equal(missing.steps.length, 1);
});

test('an unsorted array is rejected as a precondition failure', () => {
  const run = traceBinarySearch([5, 1, 9], 9);
  assert.equal(run.foundIndex, -1);
  assert.equal(run.steps.length, 0);
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0], /sorted/i);
  const result = validateBinarySearchTrace(run, { foundIndex: 2 }, [5, 1, 9], 9);
  assert.equal(result.ok, false);
});

test('non-numeric input is reported instead of traced', () => {
  const run = traceBinarySearch([1, Number.NaN, 3], 3);
  assert.ok(run.errors.length > 0);
  assert.equal(run.steps.length, 0);
});

test('duplicates stay valid as long as the reported index holds the target', () => {
  const array = [1, 3, 3, 7, 9];
  const run = traceBinarySearch(array, 3);
  assert.ok(run.foundIndex >= 0);
  assert.equal(array[run.foundIndex], 3);
  assert.equal(validateBinarySearchTrace(run, { foundIndex: run.foundIndex }, array, 3).ok, true);
});

test('a wrong expected index or step count fails validation', () => {
  const run = traceBinarySearch(EXAMPLE, 7);
  const wrongIndex = validateBinarySearchTrace(run, { foundIndex: 2 }, EXAMPLE, 7);
  assert.equal(wrongIndex.ok, false);
  assert.match(wrongIndex.failures.join(' '), /index 3/);

  const wrongSteps = validateBinarySearchTrace(run, { steps: 5 }, EXAMPLE, 7);
  assert.equal(wrongSteps.ok, false);
  assert.match(wrongSteps.failures.join(' '), /comparisons/);
});

test('a configuration without an expected result cannot be verified', () => {
  const run = traceBinarySearch(EXAMPLE, 7);
  const result = validateBinarySearchTrace(run, {}, EXAMPLE, 7);
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /no expected result/i);
});

test('isSortedAscending accepts duplicates and rejects descents', () => {
  assert.equal(isSortedAscending([1, 1, 2]), true);
  assert.equal(isSortedAscending([2, 1]), false);
  assert.equal(isSortedAscending([]), true);
});
