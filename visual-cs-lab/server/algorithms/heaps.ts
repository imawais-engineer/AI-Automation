/**
 * Min-heap operations: the verified trace behind the Heaps short.
 *
 * A heap is one array read as a complete tree: the children of index i are
 * 2i+1 and 2i+2, so no pointers are stored. The guarantee is the heap property —
 * every parent is at most its children — which is why the root is always the
 * minimum. The trace records the array after each PUSH and POP and the indices
 * the sift walked, and `validateHeapTrace` replays the same operations on a
 * plain array, then checks the heap property on every recorded snapshot, so the
 * animation can only show a heap the operations actually produced.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type HeapOp = { op: 'push'; value: number } | { op: 'pop' };

export type HeapStep = {
  /** 1-based operation number. */
  n: number;
  op: HeapOp['op'];
  /** The value pushed, or the value POP removed. */
  value: number | null;
  /** The array after the operation, which is the tree's level order. */
  heap: number[];
  /** Comparisons made by this operation's sift. */
  comparisons: number;
  /** Indices the sift touched, in order. */
  path: number[];
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type HeapTrace = {
  ops: HeapOp[];
  steps: HeapStep[];
  final: number[];
  pushed: number[];
  popped: number[];
  comparisons: number;
  root: number | null;
};

export type HeapExpectation = {
  finalHeap?: number[];
  popReturns?: number[];
  root?: number | null;
};

export type HeapConfig = {
  kind: 'heap';
  ops: HeapOp[];
  expect?: HeapExpectation;
};

export function isHeapConfig(config: unknown): config is HeapConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'heap' && Array.isArray(record.ops);
}

/** Normalises raw operation JSON into the two legal heap operations. */
export function parseHeapOps(raw: unknown): HeapOp[] {
  if (!Array.isArray(raw)) return [];
  const ops: HeapOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const op = String(record.op || '').toLowerCase();
    if (op === 'push') {
      const value = Number(record.value);
      if (!Number.isFinite(value)) continue;
      ops.push({ op: 'push', value });
      continue;
    }
    if (op === 'pop') ops.push({ op: 'pop' });
  }
  return ops;
}

function describe(heap: number[]): string {
  return heap.length === 0 ? 'empty' : `[${heap.join(', ')}]`;
}

/** Restores the heap property upwards from the last leaf. */
function siftUp(heap: number[]): { comparisons: number; path: number[] } {
  let index = heap.length - 1;
  const path = [index];
  let comparisons = 0;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    comparisons += 1;
    if (heap[parent] <= heap[index]) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
    path.push(index);
  }
  return { comparisons, path };
}

/** Restores the heap property downwards from the root. */
function siftDown(heap: number[]): { comparisons: number; path: number[] } {
  let index = 0;
  const path = [index];
  let comparisons = 0;
  for (;;) {
    const left = index * 2 + 1;
    const right = index * 2 + 2;
    let smallest = index;
    if (left < heap.length) {
      comparisons += 1;
      if (heap[left] < heap[smallest]) smallest = left;
    }
    if (right < heap.length) {
      comparisons += 1;
      if (heap[right] < heap[smallest]) smallest = right;
    }
    if (smallest === index) break;
    [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
    index = smallest;
    path.push(index);
  }
  return { comparisons, path };
}

/** Runs the operations on an array-backed min-heap and records every state. */
export function traceHeap(input: HeapOp[]): HeapTrace {
  const ops = parseHeapOps(input);
  const heap: number[] = [];
  const steps: HeapStep[] = [];
  const pushed: number[] = [];
  const popped: number[] = [];
  let comparisons = 0;

  ops.forEach((operation, index) => {
    const n = index + 1;

    if (operation.op === 'push') {
      heap.push(operation.value);
      pushed.push(operation.value);
      const sift = siftUp(heap);
      comparisons += sift.comparisons;
      const resting = sift.path[sift.path.length - 1];
      steps.push({
        n,
        op: 'push',
        value: operation.value,
        heap: [...heap],
        comparisons: sift.comparisons,
        path: sift.path,
        message: `PUSH(${operation.value}) appends at index ${heap.length - 1}${
          sift.path.length > 1 ? ` and sifts up to index ${resting}` : ' and the heap property already holds'
        } — heap is ${describe(heap)}.`,
        hudLabel: `PUSH(${operation.value}) → index ${resting}`,
        hudDetail: `${sift.comparisons} comparison${sift.comparisons === 1 ? '' : 's'} · parent ≤ child · root ${heap[0]}`
      });
      return;
    }

    if (heap.length === 0) {
      steps.push({
        n,
        op: 'pop',
        value: null,
        heap: [],
        comparisons: 0,
        path: [],
        message: 'POP on an empty heap returns nothing — that is underflow.',
        hudLabel: 'POP · underflow',
        hudDetail: 'the heap is empty'
      });
      return;
    }

    const removed = heap[0];
    const last = heap.pop() as number;
    let sift = { comparisons: 0, path: [] as number[] };
    if (heap.length > 0) {
      heap[0] = last;
      sift = siftDown(heap);
    }
    popped.push(removed);
    comparisons += sift.comparisons;
    const resting = sift.path.length > 0 ? sift.path[sift.path.length - 1] : 0;
    steps.push({
      n,
      op: 'pop',
      value: removed,
      heap: [...heap],
      comparisons: sift.comparisons,
      path: sift.path,
      message:
        heap.length === 0
          ? `POP returns the root ${removed} and leaves the heap empty.`
          : `POP returns the root ${removed}; the last value ${last} moves to the root and sifts down to index ${resting} — heap is ${describe(heap)}.`,
      hudLabel: `POP → ${removed}`,
      hudDetail:
        heap.length === 0
          ? 'the removed value was the minimum'
          : `root is now ${heap[0]} · ${sift.comparisons} comparison${sift.comparisons === 1 ? '' : 's'}`
    });
  });

  return { ops, steps, final: [...heap], pushed, popped, comparisons, root: heap[0] ?? null };
}

/** True when every parent is at most its children — the invariant, not a replay. */
function heapPropertyHolds(heap: number[]): boolean {
  for (let index = 1; index < heap.length; index += 1) {
    const parent = (index - 1) >> 1;
    if (heap[parent] > heap[index]) return false;
  }
  return true;
}

/** A straightforward array replay, written independently of the recorder. */
function replay(ops: HeapOp[]): { heaps: number[][]; returns: (number | null)[] } {
  const heap: number[] = [];
  const heaps: number[][] = [];
  const returns: (number | null)[] = [];
  const bubbleUp = (start: number) => {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent] <= heap[index]) return;
      const value = heap[parent];
      heap[parent] = heap[index];
      heap[index] = value;
      index = parent;
    }
  };
  const bubbleDown = () => {
    let index = 0;
    while (index < heap.length) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;
      if (left < heap.length && heap[left] < heap[smallest]) smallest = left;
      if (right < heap.length && heap[right] < heap[smallest]) smallest = right;
      if (smallest === index) return;
      const value = heap[smallest];
      heap[smallest] = heap[index];
      heap[index] = value;
      index = smallest;
    }
  };

  for (const operation of ops) {
    if (operation.op === 'push') {
      heap.push(operation.value);
      bubbleUp(heap.length - 1);
      returns.push(null);
    } else if (heap.length === 0) {
      returns.push(null);
    } else {
      const removed = heap[0];
      const last = heap.pop() as number;
      if (heap.length > 0) {
        heap[0] = last;
        bubbleDown();
      }
      returns.push(removed);
    }
    heaps.push([...heap]);
  }
  return { heaps, returns };
}

/**
 * Proves the trace is a real min-heap run: an independent replay has to agree
 * with every recorded snapshot and returned value, every snapshot has to satisfy
 * the heap property, and every POP has to return the current minimum.
 */
export function validateHeapTrace(trace: HeapTrace, expectation: HeapExpectation | undefined): Validation {
  const failures: string[] = [];
  const ops = parseHeapOps(trace.ops);

  if (ops.length === 0) return { ok: false, failures: ['The heap has no operations to trace.'] };
  if (trace.steps.length !== ops.length) {
    failures.push(`The trace has ${trace.steps.length} steps but ${ops.length} operations were given.`);
  }

  const { heaps, returns } = replay(ops);

  ops.forEach((operation, index) => {
    const step = trace.steps[index];
    const reference = heaps[index] ?? [];
    if (!step) return;

    if (step.heap.join(',') !== reference.join(',')) {
      failures.push(`Step ${index + 1} shows [${step.heap.join(', ')}] where the heap holds [${reference.join(', ')}].`);
    }
    if (!heapPropertyHolds(step.heap)) {
      failures.push(`Step ${index + 1} breaks the heap property: a parent is larger than a child.`);
    }
    const expectedReturn = returns[index] ?? null;
    if (operation.op === 'push' && step.value !== operation.value) {
      failures.push(`Step ${index + 1} reports ${String(step.value)} where the push added ${operation.value}.`);
    }
    if (operation.op === 'pop' && step.value !== expectedReturn) {
      failures.push(`Step ${index + 1} reports ${String(step.value)} where the heap returns ${String(expectedReturn)}.`);
    }
    if (operation.op === 'pop' && expectedReturn !== null && step.heap.length > 0) {
      const minimum = Math.min(...step.heap);
      if (expectedReturn > minimum) {
        failures.push(`Step ${index + 1} popped ${expectedReturn} but ${minimum} was still in the heap.`);
      }
    }
  });

  const last = heaps[heaps.length - 1] ?? [];
  if (trace.final.join(',') !== last.join(',')) {
    failures.push(`The final heap is [${trace.final.join(', ')}] where the run leaves [${last.join(', ')}].`);
  }
  if (expectation?.finalHeap && expectation.finalHeap.join(',') !== last.join(',')) {
    failures.push(
      `The trace ends on [${last.join(', ')}] but [${expectation.finalHeap.join(', ')}] was expected.`
    );
  }
  const popped = returns.filter((value): value is number => value !== null);
  if (expectation?.popReturns && expectation.popReturns.join(',') !== popped.join(',')) {
    failures.push(
      `POP returned [${popped.join(', ')}] where [${expectation.popReturns.join(', ')}] was expected.`
    );
  }
  if (expectation?.root !== undefined && expectation.root !== (last[0] ?? null)) {
    failures.push(`The root should be ${String(expectation.root)} but the heap holds ${String(last[0] ?? null)}.`);
  }

  return { ok: failures.length === 0, failures };
}

export const DEFAULT_HEAP_OPS: HeapOp[] = [
  { op: 'push', value: 5 },
  { op: 'push', value: 3 },
  { op: 'push', value: 8 },
  { op: 'push', value: 1 },
  { op: 'pop' },
  { op: 'push', value: 2 },
  { op: 'pop' }
];
