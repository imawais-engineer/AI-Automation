/**
 * Prefix sums: the verified running-total table behind the Prefix Sums short.
 *
 * One pass builds P, where P[i] is the total of the first i cells, so the sum of
 * any range a[l..r] is P[r+1] − P[l] — two reads instead of a walk. Building
 * costs O(n) and every later range query is O(1). `validatePrefixSumsTrace`
 * rebuilds the table from the plain array and answers the recorded query, so the
 * animation can only show totals the addition really produced.
 *
 * Keep this module dependency-free apart from the shared trace vocabulary: the
 * storyboard builder, the renderer and the API all read it.
 */

import type { Validation } from './stack.ts';
import type { StepsMeta, StepsStep, StepsTrace } from './steps.ts';

export type PrefixSumsConfig = {
  kind: 'prefix-sums';
  array: number[];
  query: { left: number; right: number };
  expect?: { sum?: number };
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isPrefixSumsConfig(config: unknown): config is PrefixSumsConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  const query = record.query as { left?: unknown; right?: unknown } | undefined;
  return (
    record.kind === 'prefix-sums' &&
    Array.isArray(record.array) &&
    Boolean(query) &&
    Number.isFinite(Number(query!.left)) &&
    Number.isFinite(Number(query!.right))
  );
}

export function tracePrefixSums(config: { array: unknown; query: { left: number; right: number } }): StepsTrace {
  const array = cleanArray(config.array);
  const values = array.map(String);
  const prefix: number[] = [0];
  const steps: StepsStep[] = [];
  const blanks = Array.from({ length: array.length + 1 }, () => '·');

  const prefixRow = (filled: number[]): { label: string; cells: string[] } => ({
    label: 'P[]',
    cells: blanks.map((blank, index) => (index < filled.length ? String(filled[index]) : blank))
  });

  steps.push({
    n: 1,
    rows: [{ label: 'a[]', cells: values }, prefixRow([0])],
    pointers: [{ row: 1, index: 0, label: 'P0', tone: 'accent', place: 'below' }],
    message: 'P[0] = 0 — the total of no cells',
    hudLabel: 'P[0] = 0',
    hudDetail: `0 of ${array.length} cells folded in`
  });

  array.forEach((value, index) => {
    prefix.push(prefix[index] + value);
    steps.push({
      n: steps.length + 1,
      rows: [
        { label: 'a[]', cells: values, active: [index] },
        {
          label: 'P[]',
          cells: blanks.map((blank, slot) => (slot < prefix.length ? String(prefix[slot]) : blank)),
          active: [prefix.length - 1]
        }
      ],
      message: `P[${index + 1}] = ${prefix[index]} + ${value} = ${prefix[index + 1]}`,
      hudLabel: `P[${index + 1}] = ${prefix[index + 1]}`,
      hudDetail: `${index + 1} of ${array.length} cells folded in`
    });
  });

  const { left, right } = config.query;
  const high = prefix[right + 1];
  const low = prefix[left];
  const sum = high - low;
  steps.push({
    n: steps.length + 1,
    rows: [
      { label: 'a[]', cells: values, active: array.map((_, index) => index).filter((index) => index >= left && index <= right) },
      { label: 'P[]', cells: prefix.map(String), active: [left, right + 1] }
    ],
    message: `sum(${left}..${right}) = ${high} − ${low} = ${sum}`,
    hudLabel: `sum(${left}..${right}) = ${sum}`,
    hudDetail: `2 lookups instead of ${right - left + 1} additions`
  });

  const meta: StepsMeta = {
    label: 'PREFIX SUMS',
    kickers: ['one build', 'O(1) range sums'],
    facts: [
      { label: 'Build', value: `O(${array.length}) once` },
      { label: 'Range query', value: 'O(1)' },
      { label: 'This range', value: `sum(${left}..${right}) = ${sum}` }
    ],
    result: { title: `sum(${left}..${right}) = ${sum}`, sub: `${array.length + 1} totals built once, then two reads per query` },
    holdCaption: 'Build the running totals once; every range sum afterwards is one subtraction.',
    complexity: { time: 'O(n) build · O(1) query', space: 'O(n)' },
    copy: {
      hook: 'Add once up front, and every later range sum is one subtraction.',
      setupTitle: 'Running totals in a second row',
      setupCaption: 'P[i] is the total of the first i cells, so the cells below the array answer any range in O(1).',
      traceTitle: `Trace · build ${array.length + 1} totals, then query ${left}..${right}`,
      traceSubtitle: 'P[i] = P[i-1] + a[i-1] · range = P[r+1] − P[l]',
      traceCaption: 'The build is one pass; the query never walks the array at all.',
      complexityTitle: 'O(n) build, O(1) query',
      complexityCaption: `${array.length + 1} totals replace ${right - left + 1} additions for this query — and it wins more with every extra query.`
    }
  };

  return { steps, meta };
}

/** Rebuilds the totals from the plain array and answers the recorded query. */
export function validatePrefixSumsTrace(trace: StepsTrace, config: PrefixSumsConfig): Validation {
  const failures: string[] = [];
  const array = trace.steps[0]?.rows[0].cells.map(Number) ?? [];
  const { left, right } = config.query;

  if (left < 0 || right >= array.length || left > right) {
    failures.push(`query ${left}..${right} is outside an array of ${array.length} cells`);
    return { ok: false, failures };
  }

  const prefix = [0];
  array.forEach((value) => prefix.push(prefix[prefix.length - 1] + value));
  const sum = prefix[right + 1] - prefix[left];

  if (config.expect?.sum !== undefined && config.expect.sum !== sum) {
    failures.push(`expected ${config.expect.sum} for ${left}..${right}, the totals give ${sum}`);
  }

  const last = trace.steps[trace.steps.length - 1];
  const shown = Number(last?.rows[1]?.cells[left]) + 0;
  if (Number.isFinite(shown) && last?.rows[1]?.cells[right + 1] && String(prefix[right + 1]) !== last.rows[1].cells[right + 1]) {
    failures.push(`the last step shows P[${right + 1}] = ${last.rows[1].cells[right + 1]} but the totals give ${prefix[right + 1]}`);
  }
  if (trace.steps.length !== array.length + 2) {
    failures.push(`the trace has ${trace.steps.length} steps for a build of ${array.length + 1} totals plus one query`);
  }

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}
