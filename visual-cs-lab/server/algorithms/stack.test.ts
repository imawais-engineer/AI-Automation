import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STACK_OPS, parseOps, trace, validate } from './stack.ts';

test('PUSH then POP obeys LIFO order', () => {
  const { events, errors } = trace(DEFAULT_STACK_OPS);
  assert.deepEqual(errors, []);
  assert.equal(events.length, 4);

  assert.deepEqual(events[2].items, [10, 20, 30]);
  assert.equal(events[2].top, 30);

  assert.equal(events[3].op, 'pop');
  assert.equal(events[3].returned, 30);
  assert.deepEqual(events[3].items, [10, 20]);
  assert.equal(events[3].top, 20);
});

test('POP on an empty stack returns null and keeps the size at zero', () => {
  const { events, errors } = trace([{ op: 'pop' }]);
  assert.equal(events[0].returned, null);
  assert.deepEqual(events[0].items, []);
  assert.equal(events[0].top, null);
  assert.deepEqual(errors, []);
});

test('event snapshots are immutable copies', () => {
  const { events } = trace([{ op: 'push', value: 1 }, { op: 'push', value: 2 }]);
  events[0].items.push(99);
  assert.deepEqual(events[1].items, [1, 2]);
});

test('validation accepts the documented stack expectation', () => {
  const { events } = trace(DEFAULT_STACK_OPS);
  const result = validate(events, { finalStack: [10, 20], top: 20, popReturns: 30 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('validation reports a wrong expectation instead of passing', () => {
  const { events } = trace(DEFAULT_STACK_OPS);
  const result = validate(events, { finalStack: [10, 20, 30], popReturns: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
});

test('validation flags a missing POP step', () => {
  const { events } = trace([{ op: 'push', value: 5 }]);
  const result = validate(events, { popReturns: 5 });
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /No POP step/);
});

test('parseOps rejects malformed input without throwing', () => {
  assert.deepEqual(parseOps('nope'), []);
  assert.deepEqual(parseOps([{ op: 'jump' }, null, { op: 'push', value: '7' }]), [
    { op: 'push', value: 7 }
  ]);
});
