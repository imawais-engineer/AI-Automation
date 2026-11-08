/**
 * The cell-row traces: strings, two pointers, sliding window, prefix sums and
 * selection sort. Each trace is checked against its own expectation, and each
 * validator has to reject a trace that disagrees with the algorithm.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { traceStrings, validateStringsTrace } from './strings.ts';
import { traceTwoPointers, validateTwoPointersTrace } from './two-pointers.ts';
import { traceSlidingWindow, validateSlidingWindowTrace } from './sliding-window.ts';
import { tracePrefixSums, validatePrefixSumsTrace } from './prefix-sums.ts';
import { traceSelectionSort, validateSelectionTrace } from './selection-sort.ts';
import { buildStepsRun, inspectStepsTrace, isStepsConfig } from './steps.ts';

test('the strings scan reads every character once and counts the vowels', () => {
  const trace = traceStrings({ text: 'VISUAL' });
  assert.equal(trace.steps.length, 6);
  assert.deepEqual(validateStringsTrace(trace, { vowels: 3, consonants: 3, length: 6 }).failures, []);
  assert.deepEqual(inspectStepsTrace(trace).failures, []);
  // Every step points at the cell it reads.
  trace.steps.forEach((step, index) => {
    assert.equal(step.rows[0].active?.[0], index);
    assert.equal(step.pointers?.[0]?.index, index);
  });
});

test('the strings validator rejects a wrong vowel count', () => {
  const trace = traceStrings({ text: 'VISUAL' });
  assert.equal(validateStringsTrace(trace, { vowels: 4 }).ok, false);
});

test('two pointers finds the pair in three sums', () => {
  const config = { kind: 'two-pointers', array: [2, 5, 8, 11, 14, 18], target: 19, expect: { pair: [5, 14] as [number, number], comparisons: 3 } };
  const trace = traceTwoPointers(config);
  assert.equal(trace.steps.length, 3);
  assert.deepEqual(validateTwoPointersTrace(trace, config).failures, []);
  // The pointers converge: L only grows, R only shrinks.
  const lefts = trace.steps.map((step) => step.pointers?.[0]?.index ?? -1);
  const rights = trace.steps.map((step) => step.pointers?.[1]?.index ?? -1);
  assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b));
  assert.deepEqual(rights, [...rights].sort((a, b) => b - a));
});

test('two pointers reports no pair when the target is impossible', () => {
  const config = { kind: 'two-pointers', array: [1, 2, 3], target: 99, expect: { pair: null } };
  const trace = traceTwoPointers(config);
  assert.deepEqual(validateTwoPointersTrace(trace, config).failures, []);
  assert.equal(trace.meta.result.title, 'No pair');
});

test('the sliding window keeps its sum under the limit and finds the longest run', () => {
  const config = { kind: 'sliding-window', array: [1, 2, 3, 1, 1, 1, 4, 2], limit: 10, expect: { longest: 6 } };
  const trace = traceSlidingWindow(config);
  assert.deepEqual(validateSlidingWindowTrace(trace, config).failures, []);
  assert.equal(trace.meta.result.title, 'longest 6');
  // Every settled window is legal; the step that adds an over-limit cell is the
  // frame the shrink repairs, and its message says so.
  for (const step of trace.steps) {
    const cells = step.rows[0];
    const sum = (cells.active || []).reduce((total, index) => total + Number(cells.cells[index]), 0);
    if (sum > config.limit) {
      assert.ok(/over|still over|>/.test(step.message), `step ${step.n} is over the limit at ${sum} without saying so`);
    }
  }
});

test('prefix sums answers the range with two lookups', () => {
  const config = { kind: 'prefix-sums', array: [3, 1, 4, 1, 5, 9], query: { left: 2, right: 4 }, expect: { sum: 10 } };
  const trace = tracePrefixSums(config);
  assert.deepEqual(validatePrefixSumsTrace(trace, config).failures, []);
  assert.equal(trace.steps.length, config.array.length + 2);
  const last = trace.steps[trace.steps.length - 1];
  assert.equal(last.rows[1].cells[2], '4');
  assert.equal(last.rows[1].cells[5], '14');
  assert.deepEqual(inspectStepsTrace(trace).failures, []);
});

test('selection sort settles every position with one swap per pass', () => {
  const config = { kind: 'selection-sort', array: [5, 2, 8, 1, 9, 3], expect: { sorted: [1, 2, 3, 5, 8, 9], comparisons: 15, swaps: 3 } };
  const trace = traceSelectionSort(config);
  assert.deepEqual(validateSelectionTrace(trace, config).failures, []);
  assert.deepEqual(inspectStepsTrace(trace).failures, []);
});

test('the selection validator rejects a trace that ends unsorted', () => {
  const config = { kind: 'selection-sort', array: [3, 1, 2] };
  const trace = traceSelectionSort(config);
  const tampered = { ...trace, steps: trace.steps.slice(0, -1) };
  assert.equal(validateSelectionTrace(tampered, config).ok, false);
});

test('a cell-row config is recognised and built by the shared dispatch', () => {
  const config = { kind: 'two-pointers', array: [1, 2, 3], target: 4 };
  assert.equal(isStepsConfig(config), true);
  const built = buildStepsRun(config);
  assert.ok(built);
  assert.equal(built!.validation.ok, true);
  assert.equal(isStepsConfig({ kind: 'heap' }), false);
});
