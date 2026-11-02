import assert from 'node:assert/strict';
import test from 'node:test';

import { isArrayConfig, traceArray, validateArrayTrace } from './arrays.ts';
import { isLinkedListConfig, traceLinkedList, validateLinkedListTrace } from './linked-lists.ts';

test('the array walk visits every cell and accumulates the prefix sums', () => {
  const trace = traceArray([4, 8, 15, 16, 23]);
  assert.equal(trace.steps.length, 5);
  assert.deepEqual(trace.steps.map((step) => step.sum), [4, 12, 27, 43, 66]);
  assert.equal(trace.sum, 66);
  assert.deepEqual(trace.steps.map((step) => step.index), [0, 1, 2, 3, 4]);
});

test('the array trace validates against its own total and rejects a wrong claim', () => {
  const array = [4, 8, 15, 16, 23];
  const trace = traceArray(array);
  assert.equal(validateArrayTrace(trace, { sum: 66 }, array).ok, true);
  const wrong = validateArrayTrace(trace, { sum: 65 }, array);
  assert.equal(wrong.ok, false);
  assert.match(wrong.failures.join(' '), /65/);
});

test('an array configuration without a target is a traversal, a search is not', () => {
  assert.equal(isArrayConfig({ array: [1, 2, 3], expect: { sum: 6 } }), true);
  assert.equal(isArrayConfig({ array: [1, 2, 3], target: 2 }), false);
  assert.equal(isArrayConfig({ ops: [] }), false);
});

test('the linked list walk stops at the match and never touches the tail', () => {
  const trace = traceLinkedList([4, 7, 9, 12, 20], 9);
  assert.equal(trace.foundIndex, 2);
  assert.equal(trace.steps.length, 3);
  assert.deepEqual(trace.steps.map((step) => step.nodeIndex), [0, 1, 2]);
  assert.equal(trace.steps.every((step) => step.match === (step.nodeIndex === 2)), true);
  assert.equal(trace.steps[2].nextIndex, null);
});

test('a missing value is proven by visiting every node', () => {
  const trace = traceLinkedList([4, 7, 9], 11);
  assert.equal(trace.foundIndex, null);
  assert.equal(trace.steps.length, 3);
  assert.equal(trace.steps.every((step) => step.match === false), true);
});

test('the linked list trace rejects a claimed index the list does not hold', () => {
  const values = [4, 7, 9, 12, 20];
  const trace = traceLinkedList(values, 9);
  assert.equal(validateLinkedListTrace(trace, { foundIndex: 2 }, values, 9).ok, true);
  const wrong = validateLinkedListTrace(trace, { foundIndex: 3 }, values, 9);
  assert.equal(wrong.ok, false);
  assert.match(wrong.failures.join(' '), /finds 2 but 3 was expected/);
});

test('a linked list configuration needs values and a target', () => {
  assert.equal(isLinkedListConfig({ values: [1, 2], target: 2 }), true);
  assert.equal(isLinkedListConfig({ array: [1, 2], target: 2 }), false);
  assert.equal(isLinkedListConfig({ values: [1, 2] }), false);
});
