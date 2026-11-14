/**
 * Trusted stack implementation and event tracer.
 *
 * The visualizer and the video renderer both consume the event list produced
 * here; nothing is hand-animated. `validate()` is the correctness gate a lesson
 * has to pass before it can be rendered.
 */

export type StackOp =
  | { op: 'push'; value: number }
  | { op: 'pop' }
  | { op: 'top' };

export type StackEvent = {
  /** 1-based step number. */
  n: number;
  op: 'push' | 'pop' | 'top';
  /** Operand for push, otherwise null. */
  value: number | null;
  /** Result for pop/top, otherwise null. */
  returned: number | null;
  /** Snapshot of the stack contents after the operation, bottom first. */
  items: number[];
  /** Value on top after the operation, or null when empty. */
  top: number | null;
  /** Human readable explanation of what changed. */
  message: string;
};

export type StackExpectation = {
  finalStack?: number[];
  top?: number | null;
  popReturns?: number | null;
};

export type Validation = { ok: boolean; failures: string[] };

class NumberStack {
  private items: number[] = [];

  push(value: number): void {
    this.items.push(value);
  }

  pop(): number | null {
    if (this.items.length === 0) return null;
    return this.items.pop() as number;
  }

  peek(): number | null {
    return this.items.length === 0 ? null : this.items[this.items.length - 1];
  }

  snapshot(): number[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }
}

function describe(items: number[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

export function trace(ops: StackOp[]): { events: StackEvent[]; errors: string[] } {
  const stack = new NumberStack();
  const events: StackEvent[] = [];
  const errors: string[] = [];

  if (ops.length === 0) {
    return { events, errors: ['No operations to trace.'] };
  }

  ops.forEach((operation, index) => {
    const n = index + 1;
    if (operation.op === 'push') {
      const value = Number(operation.value);
      if (!Number.isFinite(value)) {
        errors.push(`Step ${n}: PUSH needs a numeric value.`);
        return;
      }
      stack.push(value);
      events.push({
        n,
        op: 'push',
        value,
        returned: null,
        items: stack.snapshot(),
        top: stack.peek(),
        message: `PUSH(${value}) puts ${value} on top — stack is ${describe(stack.snapshot())}.`
      });
      return;
    }

    if (operation.op === 'pop') {
      const had = stack.peek();
      const returned = stack.pop();
      events.push({
        n,
        op: 'pop',
        value: null,
        returned,
        items: stack.snapshot(),
        top: stack.peek(),
        message:
          returned === null
            ? 'POP on an empty stack returns EMPTY — the size does not change.'
            : `POP removes ${returned}, the most recently pushed value — stack is ${describe(stack.snapshot())}.`
      });
      if (returned === null && had !== null) {
        errors.push(`Step ${n}: POP on an empty stack.`);
      }
      return;
    }

    const returned = stack.peek();
    events.push({
      n,
      op: 'top',
      value: null,
      returned,
      items: stack.snapshot(),
      top: returned,
      message:
        returned === null
          ? 'TOP on an empty stack is EMPTY.'
          : `TOP points at ${returned}, the value that POP will return next.`
    });
  });

  return { events, errors };
}

/**
 * Checks the trace against the concept's expected results. This is what stops a
 * lesson from rendering with an unverified demonstration.
 */
export function validate(events: StackEvent[], expectation: StackExpectation): Validation {
  const failures: string[] = [];
  if (events.length === 0) {
    return { ok: false, failures: ['The trace is empty.'] };
  }

  const last = events[events.length - 1];

  if (expectation.finalStack !== undefined) {
    const expected = JSON.stringify(expectation.finalStack);
    const actual = JSON.stringify(last.items);
    if (expected !== actual) failures.push(`Final stack ${actual} does not match ${expected}.`);
  }

  if (expectation.top !== undefined && expectation.top !== last.top) {
    failures.push(`TOP is ${String(last.top)} but ${String(expectation.top)} was expected.`);
  }

  if (expectation.popReturns !== undefined) {
    const pops = events.filter((event) => event.op === 'pop');
    if (pops.length === 0) {
      failures.push('No POP step exists, so the expected POP result cannot be verified.');
    } else if (pops[0].returned !== expectation.popReturns) {
      failures.push(
        `POP returned ${String(pops[0].returned)} but ${String(expectation.popReturns)} was expected.`
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

export function parseOps(input: unknown): StackOp[] {
  if (!Array.isArray(input)) return [];
  const ops: StackOp[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    if (candidate.op === 'push') ops.push({ op: 'push', value: Number(candidate.value) });
    else if (candidate.op === 'pop') ops.push({ op: 'pop' });
    else if (candidate.op === 'top') ops.push({ op: 'top' });
  }
  return ops;
}

export const DEFAULT_STACK_OPS: StackOp[] = [
  { op: 'push', value: 10 },
  { op: 'push', value: 20 },
  { op: 'push', value: 30 },
  { op: 'pop' }
];
