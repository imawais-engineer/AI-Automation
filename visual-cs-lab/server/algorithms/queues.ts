/**
 * Queue operations: the verified trace behind the Queues short.
 *
 * A queue is defined by its order guarantee, so the trace has to be the
 * guarantee: every DEQUEUE returns the value that has waited longest. The trace
 * records the contents, the front and the value each operation returned, and
 * `validateQueueTrace` replays the same operations on a plain array and fails if
 * any step disagrees — the animation can only show a queue the operations
 * actually produced.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type QueueOp =
  | { op: 'enqueue'; value: number }
  | { op: 'dequeue' }
  | { op: 'front' };

export type QueueStep = {
  /** 1-based operation number. */
  n: number;
  op: QueueOp['op'];
  /** The value this ENQUEUE added, otherwise null. */
  value: number | null;
  /** What DEQUEUE removed or FRONT read, otherwise null. */
  returned: number | null;
  /** Contents after the operation, front first. */
  items: number[];
  front: number | null;
  rear: number | null;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type QueueTrace = {
  ops: QueueOp[];
  steps: QueueStep[];
  final: number[];
  front: number | null;
  enqueued: number[];
  dequeued: number[];
};

export type QueueExpectation = {
  finalQueue?: number[];
  front?: number | null;
  dequeueReturns?: number[];
};

export type QueueConfig = {
  kind: 'queue';
  ops: QueueOp[];
  expect?: QueueExpectation;
};

export function isQueueConfig(config: unknown): config is QueueConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'queue' && Array.isArray(record.ops);
}

/** Normalises raw operation JSON into the three legal queue operations. */
export function parseQueueOps(raw: unknown): QueueOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: QueueOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const op = String(record.op || '').toLowerCase();
    if (op === 'enqueue') {
      const value = Number(record.value);
      if (!Number.isFinite(value)) continue;
      ops.push({ op: 'enqueue', value });
      continue;
    }
    if (op === 'dequeue' || op === 'front') ops.push({ op });
  }
  return ops;
}

function describe(items: number[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

/** Runs the operations on an array-backed FIFO and records every state. */
export function traceQueue(input: QueueOp[]): QueueTrace {
  const ops = parseQueueOps(input);
  const items: number[] = [];
  const steps: QueueStep[] = [];
  const enqueued: number[] = [];
  const dequeued: number[] = [];

  ops.forEach((operation, index) => {
    const n = index + 1;

    if (operation.op === 'enqueue') {
      const value = Number(operation.value);
      items.push(value);
      enqueued.push(value);
      const front = items[0] ?? null;
      const rear = items[items.length - 1] ?? null;
      steps.push({
        n,
        op: 'enqueue',
        value,
        returned: null,
        items: [...items],
        front,
        rear,
        message: `ENQUEUE(${value}) joins the rear — queue is ${describe(items)}.`,
        hudLabel: `ENQUEUE(${value}) · joins the rear`,
        hudDetail: `front ${String(front)} · ${items.length} waiting · ${items.length === 1 ? 'it is also last' : `${value} now waits behind ${front}`}`
      });
      return;
    }

    if (operation.op === 'dequeue') {
      const returned = items.length > 0 ? (items.shift() as number) : null;
      if (returned !== null) dequeued.push(returned);
      const front = items[0] ?? null;
      steps.push({
        n,
        op: 'dequeue',
        value: null,
        returned,
        items: [...items],
        front,
        rear: items[items.length - 1] ?? null,
        message:
          returned === null
            ? 'DEQUEUE on an empty queue returns nothing — that is underflow.'
            : `DEQUEUE removes ${returned} from the front — it waited longest, so it leaves first.`,
        hudLabel: returned === null ? 'DEQUEUE · underflow' : `DEQUEUE → ${returned}`,
        hudDetail:
          returned === null
            ? 'nothing was waiting in line'
            : `${returned} arrived before everything still here · queue is ${describe(items)}`
      });
      return;
    }

    const front = items[0] ?? null;
    steps.push({
      n,
      op: 'front',
      value: null,
      returned: front,
      items: [...items],
      front,
      rear: items[items.length - 1] ?? null,
      message:
        front === null
          ? 'FRONT on an empty queue has nothing to read.'
          : `FRONT reads ${front} without removing it — it is still first in line.`,
      hudLabel: front === null ? 'FRONT · empty' : `FRONT → ${front}`,
      hudDetail: front === null ? 'the queue is empty' : `${front} stays put · ${items.length} waiting`
    });
  });

  return {
    ops,
    steps,
    final: [...items],
    front: items[0] ?? null,
    enqueued,
    dequeued
  };
}

/**
 * Proves the trace is a real FIFO run: an independent array replay has to agree
 * with every recorded contents snapshot, front pointer and returned value.
 */
export function validateQueueTrace(trace: QueueTrace, expectation: QueueExpectation | undefined): Validation {
  const failures: string[] = [];
  const ops = parseQueueOps(trace.ops);

  if (ops.length === 0) return { ok: false, failures: ['The queue has no operations to trace.'] };
  if (trace.steps.length !== ops.length) {
    failures.push(`The trace has ${trace.steps.length} steps but ${ops.length} operations were given.`);
  }

  const reference: number[] = [];
  const returns: number[] = [];

  ops.forEach((operation, index) => {
    let expectedReturn: number | null = null;
    if (operation.op === 'enqueue') {
      reference.push(Number(operation.value));
    } else if (operation.op === 'dequeue') {
      expectedReturn = reference.length > 0 ? (reference.shift() as number) : null;
      if (expectedReturn !== null) returns.push(expectedReturn);
    } else {
      expectedReturn = reference[0] ?? null;
    }

    const step = trace.steps[index];
    if (!step) return;

    if (step.items.join(',') !== reference.join(',')) {
      failures.push(
        `Step ${index + 1} shows [${step.items.join(', ')}] where the FIFO holds [${reference.join(', ')}].`
      );
    }
    if (step.returned !== expectedReturn) {
      failures.push(
        `Step ${index + 1} reports ${String(step.returned)} where the FIFO returns ${String(expectedReturn)}.`
      );
    }
    if (step.front !== (reference[0] ?? null)) {
      failures.push(`Step ${index + 1} puts FRONT on ${String(step.front)} where ${String(reference[0] ?? null)} is first.`);
    }
  });

  if (trace.final.join(',') !== reference.join(',')) {
    failures.push(`The final queue is [${trace.final.join(', ')}] where FIFO leaves [${reference.join(', ')}].`);
  }
  if (expectation?.finalQueue && expectation.finalQueue.join(',') !== reference.join(',')) {
    failures.push(
      `The trace ends on [${reference.join(', ')}] but [${expectation.finalQueue.join(', ')}] was expected.`
    );
  }
  if (expectation?.front !== undefined && expectation.front !== (reference[0] ?? null)) {
    failures.push(`FRONT should be ${String(expectation.front)} but the queue holds ${String(reference[0] ?? null)} first.`);
  }
  if (expectation?.dequeueReturns) {
    if (expectation.dequeueReturns.join(',') !== returns.join(',')) {
      failures.push(
        `DEQUEUE returned [${returns.join(', ')}] where [${expectation.dequeueReturns.join(', ')}] was expected.`
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

export const DEFAULT_QUEUE_OPS: QueueOp[] = [
  { op: 'enqueue', value: 4 },
  { op: 'enqueue', value: 8 },
  { op: 'enqueue', value: 15 },
  { op: 'front' },
  { op: 'dequeue' },
  { op: 'enqueue', value: 16 },
  { op: 'dequeue' }
];
