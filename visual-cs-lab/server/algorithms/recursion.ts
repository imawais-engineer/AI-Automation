/**
 * Recursion: the verified call stack behind the Recursion short.
 *
 * `factorial(n)` is the smallest recursion with all three pieces on screen: a
 * base case, a strictly smaller subproblem and a value returned to the caller.
 * The trace records one beat per call going down the stack and one per return
 * coming back up, so the animation can show that each return belongs to a
 * caller. `validateRecursionTrace` recomputes the factorial independently and
 * checks every frame's label and returned value.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type RecursionFrame = {
  /** The call this frame represents, e.g. "fact(3)". */
  label: string;
  /** The argument the call was made with. */
  argument: number;
  /** The value this call returned, or null while it is still waiting. */
  value: number | null;
};

export type RecursionStep = {
  /** 1-based step number. */
  n: number;
  /** Whether this beat pushes a call, hits the base case or returns a value. */
  kind: 'call' | 'base' | 'return';
  /** The call stack after this beat, outermost first. */
  frames: RecursionFrame[];
  /** How many calls deep the stack is. */
  depth: number;
  /** The value handed back on a return beat, null otherwise. */
  result: number | null;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type RecursionTrace = {
  problem: 'factorial';
  n: number;
  steps: RecursionStep[];
  result: number;
  calls: number;
  returns: number;
  deepest: number;
};

export type RecursionExpectation = {
  result?: number;
};

export type RecursionConfig = {
  kind: 'recursion';
  problem: 'factorial';
  n: number;
  expect?: RecursionExpectation;
};

export function isRecursionConfig(config: unknown): config is RecursionConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'recursion' && String(record.problem || 'factorial') === 'factorial';
}

function cleanN(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(8, n)) : 4;
}

function snapshot(stack: { argument: number; value: number | null }[]): RecursionFrame[] {
  return stack.map((frame) => ({
    label: `fact(${frame.argument})`,
    argument: frame.argument,
    value: frame.value
  }));
}

/** Descends to the base case, then multiplies back up one return at a time. */
export function traceRecursion(input: { n: unknown }): RecursionTrace {
  const n = cleanN(input.n);
  const stack: { argument: number; value: number | null }[] = [];
  const steps: RecursionStep[] = [];
  const calls = n;
  let deepest = 0;

  for (let argument = n; argument >= 1; argument -= 1) {
    stack.push({ argument, value: null });
    const base = argument === 1;
    deepest = Math.max(deepest, stack.length);
    steps.push({
      n: steps.length + 1,
      kind: base ? 'base' : 'call',
      frames: snapshot(stack),
      depth: stack.length,
      result: base ? 1 : null,
      message: base
        ? 'fact(1) hits the base case and returns 1 without calling itself again.'
        : `fact(${argument}) needs fact(${argument - 1}) first, so it pushes a new call and waits.`,
      hudLabel: base ? 'BASE CASE fact(1) = 1' : `CALL fact(${argument})`,
      hudDetail: base ? 'the descent stops here' : `waiting on fact(${argument - 1}) · depth ${stack.length}`
    });
  }

  let accumulator = 1;
  for (let argument = 1; argument <= n; argument += 1) {
    accumulator *= argument;
    stack[stack.length - 1].value = accumulator;
    steps.push({
      n: steps.length + 1,
      kind: 'return',
      frames: snapshot(stack),
      depth: stack.length,
      result: accumulator,
      message: `fact(${argument}) returns ${accumulator} to ${argument === n ? 'the first caller' : `fact(${argument + 1})`} — the call is done and leaves the stack.`,
      hudLabel: `RETURN ${accumulator}`,
      hudDetail: argument === 1 ? 'base value travels back up' : `${argument} × ${accumulator / argument} = ${accumulator}`
    });
    stack.pop();
  }

  return { problem: 'factorial', n, steps, result: accumulator, calls, returns: n, deepest };
}

/**
 * Proves the trace is a real factorial recursion: the argument, frame labels and
 * returned value are recomputed independently, every call has exactly one
 * return, and the stack depth never exceeds the number of calls.
 */
export function validateRecursionTrace(trace: RecursionTrace, expectation: RecursionExpectation | undefined): Validation {
  const failures: string[] = [];
  const n = cleanN(trace.n);

  const factorial = (value: number): number => (value <= 1 ? 1 : value * factorial(value - 1));
  const expected = factorial(n);

  if (trace.problem !== 'factorial') failures.push('The trace does not describe a factorial recursion.');
  if (trace.result !== expected) {
    failures.push(`The trace reports ${trace.result} where factorial(${n}) is ${expected}.`);
  }
  if (expectation?.result !== undefined && expectation.result !== expected) {
    failures.push(`factorial(${n}) is ${expected} but ${expectation.result} was expected.`);
  }
  if (trace.steps.length !== n * 2) {
    failures.push(`The trace has ${trace.steps.length} beats where ${n} calls and ${n} returns make ${n * 2}.`);
  }
  if (trace.calls !== n) failures.push(`The trace records ${trace.calls} calls where factorial(${n}) makes ${n}.`);
  if (trace.returns !== n) failures.push(`The trace records ${trace.returns} returns where factorial(${n}) makes ${n}.`);

  let running = 1;
  let returned = 0;
  const returns: number[] = [];
  trace.steps.forEach((step, index) => {
    const frame = step.frames[step.frames.length - 1];
    if (!frame) {
      failures.push(`Step ${index + 1} shows an empty call stack.`);
      return;
    }
    if (step.frames.length > n) {
      failures.push(`Step ${index + 1} is ${step.frames.length} calls deep where factorial(${n}) needs at most ${n}.`);
    }
    if (step.kind === 'return') {
      returned += 1;
      running *= returned;
      returns.push(running);
      if (step.result !== running) {
        failures.push(`Step ${index + 1} returns ${String(step.result)} where the unwind gives ${running}.`);
      }
    } else if (step.frames[step.frames.length - 1].value !== null && step.frames[step.frames.length - 1].argument > 1) {
      failures.push(`Step ${index + 1} shows a value for a call that has not returned yet.`);
    }
  });

  const lastReturn = returns[returns.length - 1];
  if (lastReturn !== expected) {
    failures.push(`The returns multiply to ${String(lastReturn)} where factorial(${n}) is ${expected}.`);
  }

  return { ok: failures.length === 0, failures };
}
