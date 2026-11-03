/**
 * The six structure traces added for Insertion Sort, Merge Sort, Quick Sort,
 * Depth-First Search, Recursion and Dynamic Programming. Each is verified
 * against its own expectation, and each validator has to reject a trace that
 * disagrees with the algorithm.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { traceDp, validateDpTrace } from './dynamic-programming.ts';
import { traceDfs, validateDfsTrace } from './graph-dfs.ts';
import { traceInsertionSort, validateInsertionSortTrace } from './insertion-sort.ts';
import { traceMergeSort, validateMergeSortTrace } from './merge-sort.ts';
import { traceQuickSort, validateQuickSortTrace } from './quick-sort.ts';
import { traceRecursion, validateRecursionTrace } from './recursion.ts';

const SORTS_ARRAY = [5, 1, 4, 2, 8, 7, 3, 6];
const SORTS_SORTED = [1, 2, 3, 4, 5, 6, 7, 8];

test('insertion sort grows a sorted prefix and records a placement per pass', () => {
  const trace = traceInsertionSort(SORTS_ARRAY);
  const validation = validateInsertionSortTrace(trace, { sorted: SORTS_SORTED }, SORTS_ARRAY);
  assert.deepEqual(validation.failures, []);
  assert.deepEqual(trace.sorted, SORTS_SORTED);
  assert.equal(trace.steps.filter((step) => step.placed).length, SORTS_ARRAY.length - 1);
  // Every recorded prefix really is sorted.
  for (const step of trace.steps) {
    const prefix = step.array.slice(0, step.sortedTo + 1);
    assert.deepEqual(prefix, [...prefix].sort((a, b) => a - b), `step ${step.n} shows an unsorted prefix`);
  }
});

test('the insertion validator rejects a snapshot the inserts never produced', () => {
  const trace = traceInsertionSort(SORTS_ARRAY);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step, array: [...step.array] })) };
  broken.steps[4].array = [...SORTS_ARRAY];
  const validation = validateInsertionSortTrace(broken, undefined, SORTS_ARRAY);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the insert holds')));
});

test('merge sort records one beat per merge and sorts the array', () => {
  const trace = traceMergeSort(SORTS_ARRAY);
  const validation = validateMergeSortTrace(trace, { sorted: SORTS_SORTED, merges: 7 }, SORTS_ARRAY);
  assert.deepEqual(validation.failures, []);
  assert.deepEqual(trace.sorted, SORTS_SORTED);
  assert.equal(trace.steps.length, 7);
  // Every merge writes a sorted run into its own range.
  for (const step of trace.steps) {
    assert.deepEqual(step.merged, [...step.merged].sort((a, b) => a - b), `merge ${step.n} is not sorted`);
  }
});

test('the merge validator rejects a range the recursion never merged', () => {
  const trace = traceMergeSort(SORTS_ARRAY);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step })) };
  broken.steps[0].mid = broken.steps[0].mid + 1;
  const validation = validateMergeSortTrace(broken, undefined, SORTS_ARRAY);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the sort merges')));
});

test('quick sort partitions around the pivot and leaves it in its final place', () => {
  const trace = traceQuickSort(SORTS_ARRAY);
  const validation = validateQuickSortTrace(trace, { sorted: SORTS_SORTED }, SORTS_ARRAY);
  assert.deepEqual(validation.failures, []);
  assert.deepEqual(trace.sorted, SORTS_SORTED);
  assert.ok(trace.partitions > 0);
  // Once placed, everything left of the pivot is smaller and everything right is larger.
  for (const step of trace.steps.filter((entry) => entry.placed)) {
    for (let index = step.lo; index < step.pivotIndex; index += 1) {
      assert.ok(step.array[index] <= step.pivot, `step ${step.n} leaves a larger value left of the pivot`);
    }
    for (let index = step.pivotIndex + 1; index <= step.hi; index += 1) {
      assert.ok(step.array[index] >= step.pivot, `step ${step.n} leaves a smaller value right of the pivot`);
    }
  }
});

test('the quick sort validator rejects a pivot placed in the wrong slot', () => {
  const trace = traceQuickSort(SORTS_ARRAY);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step })) };
  const placing = broken.steps.find((step) => step.placed);
  assert.ok(placing);
  placing.pivotIndex = placing.pivotIndex + 1;
  const validation = validateQuickSortTrace(broken, undefined, SORTS_ARRAY);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('places the pivot')));
});

const GRAPH = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'D'],
    ['C', 'D'],
    ['D', 'E'],
    ['E', 'F']
  ] as [string, string][],
  start: 'A'
};

test('depth-first search follows one branch and records the call stack', () => {
  const trace = traceDfs(GRAPH);
  const validation = validateDfsTrace(trace, { order: ['A', 'B', 'D', 'C', 'E', 'F'] });
  assert.deepEqual(validation.failures, []);
  assert.deepEqual(trace.order, ['A', 'B', 'D', 'C', 'E', 'F']);
  assert.deepEqual(trace.steps[0].stack, ['A']);
  assert.equal(trace.steps[2].depth, 2);
});

test('the dfs validator rejects a call stack the walk never had', () => {
  const trace = traceDfs(GRAPH);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step, stack: [...step.stack] })) };
  broken.steps[1].stack = ['A', 'C'];
  const validation = validateDfsTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the calls hold')));
});

test('the factorial recursion descends to the base case and unwinds every value', () => {
  const trace = traceRecursion({ n: 4 });
  const validation = validateRecursionTrace(trace, { result: 24 });
  assert.deepEqual(validation.failures, []);
  assert.equal(trace.result, 24);
  assert.equal(trace.calls, 4);
  assert.equal(trace.deepest, 4);
  assert.equal(trace.steps[0].kind, 'call');
  assert.equal(trace.steps.at(-1)?.result, 24);
});

test('the recursion validator rejects a wrong returned value', () => {
  const trace = traceRecursion({ n: 4 });
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step })) };
  const returning = broken.steps.filter((step) => step.kind === 'return');
  returning[1].result = 99;
  const validation = validateRecursionTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the unwind gives')));
});

test('the fibonacci table fills every state once and reuses the two before it', () => {
  const trace = traceDp({ n: 8 });
  const validation = validateDpTrace(trace, { result: 21 });
  assert.deepEqual(validation.failures, []);
  assert.equal(trace.result, 21);
  assert.equal(trace.table.length, 9);
  assert.deepEqual(trace.steps[0].operands, null);
  assert.deepEqual(trace.steps[4].operands, [2, 1]);
});

test('the dp validator rejects a cell the recurrence did not produce', () => {
  const trace = traceDp({ n: 8 });
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step, table: [...step.table] })) };
  broken.steps[5].value = 99;
  broken.steps[5].table[5] = 99;
  const validation = validateDpTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the recurrence gives')));
});
