/**
 * The four structure traces added for Heaps, Graphs, Linear Search and Bubble
 * Sort. Each is verified against its own expectation, and each validator has to
 * reject a trace that disagrees with the algorithm.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRAPH_EDGES,
  DEFAULT_GRAPH_NODES,
  traceGraph,
  validateGraphTrace
} from './graphs.ts';
import { DEFAULT_HEAP_OPS, traceHeap, validateHeapTrace } from './heaps.ts';
import { traceLinearSearch, validateLinearSearchTrace } from './linear-search.ts';
import { traceBubbleSort, validateBubbleSortTrace } from './bubble-sort.ts';

test('the heap trace keeps the heap property and pops in sorted order', () => {
  const trace = traceHeap(DEFAULT_HEAP_OPS);
  const validation = validateHeapTrace(trace, { finalHeap: [3, 5, 8], popReturns: [1, 2], root: 3 });
  assert.deepEqual(validation.failures, []);
  assert.equal(validation.ok, true);
  assert.deepEqual(trace.popped, [1, 2]);
  assert.equal(trace.root, 3);
  // Every snapshot is a min-heap: each parent is at most its children.
  for (const step of trace.steps) {
    step.heap.forEach((value, index) => {
      const parent = (index - 1) >> 1;
      if (index > 0) assert.ok(step.heap[parent] <= value, `step ${step.n} breaks the heap property`);
    });
  }
});

test('the heap validator rejects a snapshot that is not a heap', () => {
  const trace = traceHeap(DEFAULT_HEAP_OPS);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step, heap: [...step.heap] })) };
  broken.steps[3].heap = [5, 3, 8, 1];
  const validation = validateHeapTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('heap property')));
});

test('the graph trace walks breadth-first and records the frontier', () => {
  const trace = traceGraph({ nodes: DEFAULT_GRAPH_NODES, edges: DEFAULT_GRAPH_EDGES, start: 'A' });
  const validation = validateGraphTrace(trace, { order: ['A', 'B', 'C', 'D', 'E', 'F'] });
  assert.deepEqual(validation.failures, []);
  assert.deepEqual(trace.order, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(trace.steps[0].frontier, ['B', 'C']);
  assert.deepEqual(trace.steps[1].frontier, ['C', 'D']);
});

test('the graph validator rejects a walk that visits the wrong vertex', () => {
  const trace = traceGraph({ nodes: DEFAULT_GRAPH_NODES, edges: DEFAULT_GRAPH_EDGES, start: 'A' });
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step })) };
  broken.steps[1].nodeId = 'E';
  const validation = validateGraphTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('breadth-first visits')));
});

test('linear search stops at the first match and counts comparisons', () => {
  const array = [7, 12, 4, 9, 5, 21];
  const trace = traceLinearSearch({ array, target: 5 });
  const validation = validateLinearSearchTrace(trace, { foundIndex: 4, comparisons: 5 }, array, 5);
  assert.deepEqual(validation.failures, []);
  assert.equal(trace.foundIndex, 4);
  assert.equal(trace.comparisons, 5);
  assert.equal(trace.steps[trace.steps.length - 1].found, true);
});

test('linear search scans everything when the target is absent', () => {
  const array = [7, 12, 4];
  const trace = traceLinearSearch({ array, target: 5 });
  const validation = validateLinearSearchTrace(trace, { foundIndex: null, comparisons: 3 }, array, 5);
  assert.deepEqual(validation.failures, []);
  assert.equal(trace.foundIndex, null);
  assert.equal(trace.comparisons, 3);
});

test('bubble sort settles a value per pass and reports the sorted array', () => {
  const array = [5, 1, 4, 2, 8];
  const trace = traceBubbleSort(array);
  const validation = validateBubbleSortTrace(trace, { sorted: [1, 2, 4, 5, 8], swaps: 4 }, array);
  assert.deepEqual(validation.failures, []);
  assert.equal(trace.passes, 3);
  assert.equal(trace.comparisons, 9);
  assert.equal(trace.swaps, 4);
  assert.deepEqual(trace.sorted, [1, 2, 4, 5, 8]);
});

test('the bubble sort validator rejects a snapshot the passes never produced', () => {
  const array = [5, 1, 4, 2, 8];
  const trace = traceBubbleSort(array);
  const broken = { ...trace, steps: trace.steps.map((step) => ({ ...step, array: [...step.array] })) };
  broken.steps[2].array = [5, 1, 4, 2, 8];
  const validation = validateBubbleSortTrace(broken, undefined, array);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => failure.includes('where the pass holds')));
});
