/**
 * Two pointers: the verified converging scan behind the Two Pointers short.
 *
 * On a sorted array a pair summing to a target is found without checking every
 * pair: the left pointer starts at the first cell, the right at the last, and
 * each comparison decides which one moves. The sum only shrinks when the right
 * pointer steps left and only grows when the left pointer steps right, which is
 * why the whole scan is O(n). `validateTwoPointersTrace` replays the walk on a
 * plain array, so the animation can only show the pair the scan really found.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';
import type { StepsMeta, StepsStep, StepsTrace } from './steps.ts';

export type TwoPointersConfig = {
  kind: 'two-pointers';
  array: number[];
  target: number;
  expect?: { pair?: [number, number] | null; comparisons?: number };
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isTwoPointersConfig(config: unknown): config is TwoPointersConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'two-pointers' && Array.isArray(record.array) && Number.isFinite(Number(record.target));
}

export function traceTwoPointers(config: { array: unknown; target: unknown }): StepsTrace {
  const array = cleanArray(config.array);
  const target = Number(config.target);
  const cells = array.map(String);
  const steps: StepsStep[] = [];
  let left = 0;
  let right = array.length - 1;
  let pair: [number, number] | null = null;

  while (left < right) {
    const sum = array[left] + array[right];
    const hit = sum === target;
    const moveLeft = sum < target;
    steps.push({
      n: steps.length + 1,
      rows: [{ label: 'a[]', cells, active: [left, right], done: [] }],
      pointers: [
        { index: left, label: `L = ${left}`, tone: 'accent' },
        { index: right, label: `R = ${right}`, tone: 'coral' }
      ],
      message: hit
        ? `a[${left}] + a[${right}] = ${array[left]} + ${array[right]} = ${target} — the pair is found.`
        : `a[${left}] + a[${right}] = ${sum} is ${moveLeft ? 'below' : 'above'} ${target} — move ${
            moveLeft ? 'L right' : 'R left'
          }.`,
      hudLabel: `a[${left}] + a[${right}] = ${sum} · ${hit ? 'MATCH' : moveLeft ? 'too small' : 'too big'}`,
      hudDetail: `${steps.length + 1} sum${steps.length === 0 ? '' : 's'} tested · window ${right - left + 1} wide`
    });
    if (hit) {
      pair = [array[left], array[right]];
      break;
    }
    if (moveLeft) left += 1;
    else right -= 1;
  }

  const meta: StepsMeta = {
    label: 'TWO POINTERS',
    kickers: ['sorted array', 'L and R inward'],
    facts: [
      { label: 'Sums tested', value: String(steps.length) },
      { label: 'Pairs skipped', value: `${(array.length * (array.length - 1)) / 2 - steps.length}` },
      { label: 'Space', value: 'O(1)' }
    ],
    result: pair
      ? { title: `${pair[0]} + ${pair[1]} = ${target}`, sub: `${steps.length} sums instead of ${(array.length * (array.length - 1)) / 2} pairs` }
      : { title: 'No pair', sub: `${steps.length} sums tested on ${array.length} cells` },
    holdCaption: 'Each comparison discards a whole row of pairs — that is why the scan is O(n).',
    complexity: { time: 'O(n)', space: 'O(1)' },
    copy: {
      hook: 'Two pointers walk inward on a sorted array — and every step discards half the pairs.',
      setupTitle: 'L at the start, R at the end',
      setupCaption: 'The pair sum is too small → only moving L can grow it. Too big → only moving R can shrink it.',
      traceTitle: `Trace · pair sum ${target} on ${array.length} sorted values`,
      traceSubtitle: 'compare a[L] + a[R] · move one pointer · repeat',
      traceCaption: 'Every comparison removes one row of candidate pairs, so n steps replace n² pair checks.',
      complexityTitle: 'O(n) instead of O(n²)',
      complexityCaption: `${steps.length} sums tested to cover ${(array.length * (array.length - 1)) / 2} pairs. Space: O(1) — two indices.`
    }
  };

  return { steps, meta };
}

/** Replays the walk on the plain array and compares it with the recorded steps. */
export function validateTwoPointersTrace(trace: StepsTrace, config: TwoPointersConfig): Validation {
  const failures: string[] = [];
  const array = trace.steps[0]?.rows[0].cells.map(Number) ?? [];
  const target = config.target;

  let left = 0;
  let right = array.length - 1;
  let replays = 0;
  let found: [number, number] | null = null;

  while (left < right && replays < trace.steps.length) {
    const step = trace.steps[replays];
    const pointers = step.pointers || [];
    if (pointers[0]?.index !== left || pointers[1]?.index !== right) {
      failures.push(`step ${replays + 1} shows L=${pointers[0]?.index}, R=${pointers[1]?.index} but the walk is at ${left}, ${right}`);
      break;
    }
    const sum = array[left] + array[right];
    if (sum === target) {
      found = [array[left], array[right]];
      replays += 1;
      break;
    }
    if (sum < target) left += 1;
    else right -= 1;
    replays += 1;
  }

  if (replays !== trace.steps.length) {
    failures.push(`the trace has ${trace.steps.length} steps but the walk takes ${replays}`);
  }
  if (config.expect?.pair !== undefined) {
    const expected = config.expect.pair;
    const matches = expected === null ? found === null : Boolean(found && found[0] === expected[0] && found[1] === expected[1]);
    if (!matches) failures.push(`expected pair ${JSON.stringify(expected)}, the walk found ${JSON.stringify(found)}`);
  }
  if (config.expect?.comparisons !== undefined && config.expect.comparisons !== trace.steps.length) {
    failures.push(`expected ${config.expect.comparisons} comparisons, the trace has ${trace.steps.length}`);
  }

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}
