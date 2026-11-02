/**
 * What a structure trace carries into the rest of the app.
 *
 * The trace modules know the algorithm; this module knows which of them a
 * lesson is and what the frame should say about it — the header label, the two
 * kickers, the complexity rows and the result the short freezes on. The plan
 * builder and the storyboard builder both read it, so the words on screen and
 * the animation come from one description.
 */

import type { BstTrace } from './algorithms/binary-search-trees.ts';
import type { HashTrace } from './algorithms/hash-tables.ts';
import type { QueueTrace } from './algorithms/queues.ts';
import type { TreeTrace } from './algorithms/trees.ts';
import { bstFrames, hashFrames, queueFrames, treeFrames } from './anim/structure-frames.ts';
import type { StructureFrame } from './anim/structure-types.ts';

export type StructureRun =
  | { kind: 'queue'; trace: QueueTrace }
  | { kind: 'hash-table'; trace: HashTrace }
  | { kind: 'tree'; trace: TreeTrace }
  | { kind: 'bst'; trace: BstTrace };

export type StructureChrome = {
  label: string;
  kickers: [string, string];
  facts: { label: string; value: string }[];
  result: { title: string; sub: string };
  holdCaption: string;
};

/** The frame for every verified step, in order. */
export function framesForRun(run: StructureRun): StructureFrame[] {
  if (run.kind === 'queue') return queueFrames(run.trace);
  if (run.kind === 'hash-table') return hashFrames(run.trace);
  if (run.kind === 'tree') return treeFrames(run.trace);
  return bstFrames(run.trace);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The copy that frames a structure short: labels, kickers, facts, result. */
export function structureChrome(run: StructureRun): StructureChrome {
  if (run.kind === 'queue') {
    const trace = run.trace;
    const peak = trace.steps.reduce((max, step) => Math.max(max, step.items.length), 0);
    return {
      label: 'QUEUE',
      kickers: ['FIFO · FRONT LEAVES FIRST', 'ENQUEUE AT THE REAR'],
      facts: [
        { label: 'Enqueue (add at the rear)', value: 'O(1)' },
        { label: 'Dequeue (remove from the front)', value: 'O(1)' },
        { label: 'This run', value: `${plural(trace.steps.length, 'operation')} · ${peak} waiting at once` }
      ],
      result:
        trace.front === null
          ? { title: 'QUEUE EMPTY', sub: `${plural(trace.dequeued.length, 'value')} left, in arrival order` }
          : {
              title: `NEXT OUT: ${trace.front}`,
              sub: `${plural(trace.dequeued.length, 'value')} dequeued · ${trace.final.length} still waiting`
            },
      holdCaption: 'First in, first out — the value that waited longest left first.'
    };
  }

  if (run.kind === 'hash-table') {
    const trace = run.trace;
    const last = trace.steps[trace.steps.length - 1];
    const gets = trace.steps.filter((step) => step.op === 'get').length;
    const chain = last ? last.chain.length : 0;
    return {
      label: 'HASH TABLE',
      kickers: ['KEY MOD SIZE → BUCKET', 'COLLISIONS CHAIN'],
      facts: [
        { label: 'Lookup with a good hash', value: 'O(1) expected' },
        { label: 'Worst case, everything collides', value: 'O(n) — one long chain' },
        { label: 'This run', value: `${plural(trace.probes, 'probe')} for ${plural(gets, 'lookup')}` }
      ],
      result: last
        ? {
            title: last.found ? `GET ${last.key} → FOUND` : `GET ${last.key} → MISS`,
            sub: `bucket ${last.bucket} · ${plural(last.probes, 'comparison')}${chain > 1 ? ` · chain of ${chain}` : ''}`
          }
        : { title: 'EMPTY TABLE', sub: 'no keys stored' },
      holdCaption: 'The hash picks the bucket; only the collision chain has to be searched.'
    };
  }

  if (run.kind === 'tree') {
    const trace = run.trace;
    return {
      label: 'TREE',
      kickers: ['BREADTH-FIRST', 'ONE PARENT PER NODE'],
      facts: [
        { label: 'Visit every node once', value: 'O(n)' },
        { label: 'Levels in this tree', value: `${trace.levels} — the height bound` },
        { label: 'Frontier memory', value: 'O(width of the widest level)' }
      ],
      result: {
        title: trace.order.join(' · '),
        sub: `${plural(trace.steps.length, 'node')} · ${plural(trace.levels, 'level')} · level by level`
      },
      holdCaption: 'Breadth-first finishes a level before it starts the next one.'
    };
  }

  const trace = run.trace;
  const balanced = Math.ceil(Math.log2(trace.nodes.length + 1));
  return {
    label: 'BINARY SEARCH TREE',
    kickers: ['LEFT < NODE < RIGHT', 'SEARCH = ONE PATH'],
    facts: [
      { label: 'Search in a balanced tree', value: 'O(log n)' },
      { label: 'Search in a list-shaped tree', value: 'O(n) — height is the cost' },
      { label: 'This search', value: `${plural(trace.comparisons, 'comparison')} · ${trace.nodes.length} keys, ${balanced} balanced` }
    ],
    result: trace.found
      ? { title: `${trace.search} FOUND`, sub: `${plural(trace.comparisons, 'comparison')} · ${plural(trace.nodes.length, 'key')} in the tree` }
      : { title: `${trace.search} NOT IN TREE`, sub: `${plural(trace.comparisons, 'comparison')} reached an empty slot` },
    holdCaption: 'Each comparison discards one whole side of the tree.'
  };
}
