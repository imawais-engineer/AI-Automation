/**
 * The complexity shorts claim a growth class, so the counts behind the curves are
 * checked here against closed forms: a measurement that drifts from the class it
 * is drawn as is a wrong lesson, not a rounding error.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { traceComplexity, validateComplexityTrace, type ComplexityConfig } from './complexity.ts';

const base: ComplexityConfig = {
  kind: 'complexity',
  series: ['constant', 'log', 'linear', 'n-log-n', 'quadratic'],
  sizes: [4, 8, 16, 32],
  expect: { series: ['constant', 'log', 'linear', 'n-log-n', 'quadratic'] }
};

test('every measured curve matches the growth class it is drawn as', () => {
  const trace = traceComplexity(base);
  const validation = validateComplexityTrace(trace, base.expect);
  assert.deepEqual(validation.failures, []);
  assert.equal(validation.ok, true);
  assert.equal(trace.steps.length, base.sizes.length);
  assert.equal(trace.series.length, 5);
});

test('the measurements are real counts, not estimates', () => {
  const trace = traceComplexity(base);
  const linear = trace.series.find((item) => item.id === 'linear')!;
  const quadratic = trace.series.find((item) => item.id === 'quadratic')!;
  const constant = trace.series.find((item) => item.id === 'constant')!;

  // A full scan compares every cell; a reversed bubble sort compares every pair.
  assert.deepEqual(
    linear.points.map((point) => point.ops),
    [4, 8, 16, 32]
  );
  assert.deepEqual(
    quadratic.points.map((point) => point.ops),
    [6, 28, 120, 496]
  );
  assert.deepEqual(
    constant.points.map((point) => point.ops),
    [1, 1, 1, 1]
  );
});

test('the three bubble sort cases separate best from average from worst', () => {
  const trace = traceComplexity({
    kind: 'complexity',
    series: ['best', 'average', 'worst'],
    sizes: [4, 8, 16, 32]
  });
  const at = (id: string) => trace.series.find((item) => item.id === id)!.points.map((point) => point.ops);

  assert.deepEqual(at('best'), [3, 7, 15, 31]);
  for (let index = 0; index < at('best').length; index += 1) {
    assert.ok(at('best')[index] <= at('average')[index], 'best must not exceed average');
    assert.ok(at('average')[index] <= at('worst')[index], 'average must not exceed worst');
  }
  assert.equal(validateComplexityTrace(trace).ok, true);
});

test('space curves count stack frames held', () => {
  const trace = traceComplexity({
    kind: 'complexity',
    series: ['recursion-space', 'iterative-space'],
    sizes: [4, 8, 16, 32]
  });
  const recursive = trace.series.find((item) => item.id === 'recursion-space')!;
  const iterative = trace.series.find((item) => item.id === 'iterative-space')!;
  assert.deepEqual(
    recursive.points.map((point) => point.ops),
    [4, 8, 16, 32]
  );
  assert.deepEqual(
    iterative.points.map((point) => point.ops),
    [1, 1, 1, 1]
  );
  assert.equal(trace.unit, 'frames held');
  assert.equal(validateComplexityTrace(trace).ok, true);
});

test('a curve that does not follow its claimed class is rejected', () => {
  const trace = traceComplexity(base);
  // Pretend bubble sort was measured doing one comparison per cell: the quadratic
  // claim no longer holds, and the trace must not pass validation.
  const broken = {
    ...trace,
    series: trace.series.map((item) =>
      item.id === 'quadratic'
        ? { ...item, points: item.points.map((point) => ({ ...point, ops: point.size })) }
        : item
    )
  };
  const validation = validateComplexityTrace(broken);
  assert.equal(validation.ok, false);
  assert.match(validation.failures[0], /O\(n²\)/);
});

test('an unsupported size falls back to a readable demo range', () => {
  const trace = traceComplexity({ kind: 'complexity', series: ['linear'], sizes: [0, 1, 500] });
  assert.ok(trace.sizes.length >= 2);
  assert.ok(trace.sizes.every((size) => size >= 2 && size <= 64));
});
