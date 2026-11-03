/**
 * Dynamic programming: the verified table behind the Dynamic Programming short.
 *
 * Fibonacci has overlapping subproblems: each value needs the two before it, and
 * a naive recursion recomputes both branches again and again. Bottom-up
 * tabulation fills one array from the base cases forward, so every state is
 * solved exactly once. The trace records one step per filled cell, and
 * `validateDpTrace` recomputes the table independently and checks every cell
 * against the recurrence, so the animation can only show values the recurrence
 * produced.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type DpStep = {
  /** 1-based step number. */
  n: number;
  /** The table index this beat fills. */
  index: number;
  /** The value written into that cell. */
  value: number;
  /** The two operands this cell was built from, null for the base cases. */
  operands: [number, number] | null;
  /** The table after this beat, with null for cells not filled yet. */
  table: (number | null)[];
  /** How many cells hold a value after this beat. */
  filled: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type DpTrace = {
  problem: 'fibonacci';
  n: number;
  steps: DpStep[];
  table: number[];
  result: number;
};

export type DpExpectation = {
  result?: number;
};

export type DpConfig = {
  kind: 'dp-table';
  problem: 'fibonacci';
  n: number;
  expect?: DpExpectation;
};

export function isDpConfig(config: unknown): config is DpConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'dp-table' && String(record.problem || 'fibonacci') === 'fibonacci';
}

function cleanN(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(2, Math.min(12, n)) : 8;
}

/** Fills a fibonacci table from the two base cases forward. */
export function traceDp(input: { n: unknown }): DpTrace {
  const n = cleanN(input.n);
  const table: (number | null)[] = Array.from({ length: n + 1 }, () => null);
  const steps: DpStep[] = [];

  const write = (index: number, value: number, operands: [number, number] | null): void => {
    table[index] = value;
    const filled = table.filter((cell) => cell !== null).length;
    const cells = `[${table.map((cell) => (cell === null ? '·' : String(cell))).join(', ')}]`;
    steps.push({
      n: steps.length + 1,
      index,
      value,
      operands,
      table: [...table],
      filled,
      message:
        operands === null
          ? `dp[${index}] = ${value} is a base case, so it needs no other cell.`
          : `dp[${index}] = dp[${index - 1}] + dp[${index - 2}] = ${operands[0]} + ${operands[1]} = ${value} — computed once and written down.`,
      hudLabel: operands === null ? `BASE dp[${index}] = ${value}` : `dp[${index}] = ${value}`,
      hudDetail: `table now ${cells}`
    });
  };

  write(0, 0, null);
  write(1, 1, null);
  for (let index = 2; index <= n; index += 1) {
    const left = table[index - 1] as number;
    const right = table[index - 2] as number;
    write(index, left + right, [left, right]);
  }

  return { problem: 'fibonacci', n, steps, table: table as number[], result: table[n] as number };
}

/**
 * Proves the trace is a real bottom-up fibonacci table: the sequence is rebuilt
 * independently, every recorded cell has to equal the recurrence applied to the
 * two cells before it, and the last cell has to be fib(n).
 */
export function validateDpTrace(trace: DpTrace, expectation: DpExpectation | undefined): Validation {
  const failures: string[] = [];
  const n = cleanN(trace.n);

  const sequence: number[] = [0, 1];
  for (let index = 2; index <= n; index += 1) sequence.push(sequence[index - 1] + sequence[index - 2]);
  const expected = sequence[n];

  if (trace.problem !== 'fibonacci') failures.push('The trace does not describe a fibonacci table.');
  if (trace.table.length !== n + 1) {
    failures.push(`The table has ${trace.table.length} cells where fib(${n}) needs ${n + 1}.`);
  }
  if (trace.result !== expected) {
    failures.push(`The trace reports ${trace.result} where fib(${n}) is ${expected}.`);
  }
  if (expectation?.result !== undefined && expectation.result !== expected) {
    failures.push(`fib(${n}) is ${expected} but ${expectation.result} was expected.`);
  }
  if (trace.steps.length !== n + 1) {
    failures.push(`The trace has ${trace.steps.length} beats where the table has ${n + 1} cells to fill.`);
  }

  trace.steps.forEach((step, index) => {
    if (step.index !== index) {
      failures.push(`Step ${index + 1} fills dp[${step.index}] where the next unfilled cell is dp[${index}].`);
    }
    if (step.value !== sequence[index]) {
      failures.push(`Step ${index + 1} writes ${step.value} where the recurrence gives ${sequence[index]}.`);
    }
    if (step.table[index] !== step.value) {
      failures.push(`Step ${index + 1} shows ${String(step.table[index])} at dp[${index}] where it just wrote ${step.value}.`);
    }
    if (index < 2) {
      if (step.operands !== null) failures.push(`Step ${index + 1} uses operands where dp[${index}] is a base case.`);
      return;
    }
    const left = sequence[index - 1];
    const right = sequence[index - 2];
    if (!step.operands || step.operands[0] !== left || step.operands[1] !== right) {
      failures.push(`Step ${index + 1} adds ${String(step.operands?.[0])} + ${String(step.operands?.[1])} where dp[${index}] needs ${left} + ${right}.`);
    }
  });

  return { ok: failures.length === 0, failures };
}
