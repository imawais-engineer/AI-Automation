/**
 * The four structure traces: each one has to reproduce the rule of its data
 * structure, and its validator has to reject a trace that drifts from it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseQueueOps, traceQueue, validateQueueTrace } from './queues.ts';
import { hashBucket, traceHashTable, validateHashTrace } from './hash-tables.ts';
import { checkTreeShape, traceTree, validateTreeTrace } from './trees.ts';
import { traceBst, validateBstTrace } from './binary-search-trees.ts';

/* ------------------------------------------------------------------- queue */

const QUEUE_OPS = parseQueueOps([
  { op: 'enqueue', value: 4 },
  { op: 'enqueue', value: 8 },
  { op: 'enqueue', value: 15 },
  { op: 'front' },
  { op: 'dequeue' },
  { op: 'enqueue', value: 16 },
  { op: 'dequeue' }
]);

test('a queue serves values in arrival order', () => {
  const trace = traceQueue(QUEUE_OPS);
  const validation = validateQueueTrace(trace, {
    finalQueue: [15, 16],
    front: 15,
    dequeueReturns: [4, 8]
  });
  assert.equal(validation.ok, true, validation.failures.join(' '));
  assert.deepEqual(trace.dequeued, [4, 8]);
  assert.deepEqual(trace.final, [15, 16]);
  assert.equal(trace.steps[3].returned, 4, 'FRONT reads the oldest value without removing it');
  assert.deepEqual(trace.steps[3].items, [4, 8, 15]);
  assert.equal(trace.steps[4].returned, 4, 'DEQUEUE takes the same value FRONT pointed at');
});

test('a queue trace that returns a newer value is rejected', () => {
  const trace = traceQueue(QUEUE_OPS);
  const broken = {
    ...trace,
    steps: trace.steps.map((step, index) => (index === 4 ? { ...step, returned: 15 } : step))
  };
  const validation = validateQueueTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => /reports 15/.test(failure)));
});

/* -------------------------------------------------------------------- hash */

const HASH_OPS = [
  { op: 'put' as const, key: 12 },
  { op: 'put' as const, key: 25 },
  { op: 'put' as const, key: 37 },
  { op: 'put' as const, key: 18 },
  { op: 'get' as const, key: 37 }
];

test('a hash table chains colliding keys and finds them by comparison', () => {
  const trace = traceHashTable({ size: 5, ops: HASH_OPS });
  const validation = validateHashTrace(trace, { found: 37, bucket: 2, probes: 2 });
  assert.equal(validation.ok, true, validation.failures.join(' '));
  assert.equal(hashBucket(37, 5), 2);
  assert.deepEqual(trace.buckets[2], [12, 37]);
  const last = trace.steps[trace.steps.length - 1];
  assert.equal(last.slot, 1);
  assert.equal(last.probes, 2);
  assert.equal(trace.collisions, 1);
});

test('a hash trace that invents a probe count is rejected', () => {
  const trace = traceHashTable({ size: 5, ops: HASH_OPS });
  const broken = {
    ...trace,
    steps: trace.steps.map((step, index) => (index === 4 ? { ...step, probes: 1 } : step))
  };
  const validation = validateHashTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => /probes/.test(failure)));
});

/* -------------------------------------------------------------------- tree */

const TREE_NODES = [
  { id: 'n8', value: 8, parent: null },
  { id: 'n3', value: 3, parent: 'n8' },
  { id: 'n10', value: 10, parent: 'n8' },
  { id: 'n1', value: 1, parent: 'n3' },
  { id: 'n6', value: 6, parent: 'n3' },
  { id: 'n14', value: 14, parent: 'n10' }
];

test('breadth-first visits the tree level by level', () => {
  const trace = traceTree(TREE_NODES);
  const validation = validateTreeTrace(trace, { order: [8, 3, 10, 1, 6, 14], levels: 3 });
  assert.equal(validation.ok, true, validation.failures.join(' '));
  assert.deepEqual(trace.order, [8, 3, 10, 1, 6, 14]);
  assert.equal(trace.steps[0].depth, 0);
  assert.deepEqual(trace.steps[0].frontier, ['n3', 'n10']);
  assert.equal(trace.steps[trace.steps.length - 1].frontier.length, 0);
});

test('a tree with two roots or a cycle is rejected', () => {
  const twoRoots = checkTreeShape([...TREE_NODES, { id: 'n99', value: 99, parent: null }]);
  assert.ok(twoRoots.failures.some((failure) => /exactly one root/.test(failure)));

  const cyclic = checkTreeShape([
    { id: 'a', value: 1, parent: 'b' },
    { id: 'b', value: 2, parent: 'a' }
  ]);
  assert.ok(cyclic.failures.some((failure) => /cycle|root/.test(failure)));
});

test('a depth-first order cannot pass as breadth-first', () => {
  const trace = traceTree(TREE_NODES);
  const broken = {
    ...trace,
    steps: trace.steps.map((step) => ({ ...step })),
    order: [8, 3, 1, 6, 10, 14]
  };
  const validation = validateTreeTrace(broken, undefined);
  assert.equal(validation.ok, false);
});

/* --------------------------------------------------------------------- bst */

test('a BST inserts by comparison and finds the target down one path', () => {
  const trace = traceBst({ insert: [8, 3, 10, 1, 6, 14], search: 10 });
  const validation = validateBstTrace(trace, {
    found: true,
    comparisons: 2,
    inorder: [1, 3, 6, 8, 10, 14]
  });
  assert.equal(validation.ok, true, validation.failures.join(' '));
  assert.equal(trace.found, true);
  assert.equal(trace.comparisons, 2);
  assert.deepEqual(trace.inorder, [1, 3, 6, 8, 10, 14]);
  assert.equal(trace.steps.filter((step) => step.op === 'insert').length, 6);
  assert.deepEqual(trace.steps[1].path, ['n8'], '3 compares against the root before it lands');
});

test('a BST trace with a wrong comparison direction is rejected', () => {
  const trace = traceBst({ insert: [8, 3, 10, 1, 6, 14], search: 10 });
  const firstCompare = trace.steps.findIndex((step) => step.op === 'compare');
  const broken = {
    ...trace,
    steps: trace.steps.map((step, index) =>
      index === firstCompare ? { ...step, direction: 'left' as const } : step
    )
  };
  const validation = validateBstTrace(broken, undefined);
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) => /turns left/.test(failure)));
});
