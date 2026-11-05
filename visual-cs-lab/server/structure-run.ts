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
import type { BubbleTrace } from './algorithms/bubble-sort.ts';
import type { ComplexityTrace } from './algorithms/complexity.ts';
import type { DpTrace } from './algorithms/dynamic-programming.ts';
import type { DfsTrace } from './algorithms/graph-dfs.ts';
import type { GraphTrace } from './algorithms/graphs.ts';
import type { HashTrace } from './algorithms/hash-tables.ts';
import type { HeapTrace } from './algorithms/heaps.ts';
import type { InsertionTrace } from './algorithms/insertion-sort.ts';
import type { LinearSearchTrace } from './algorithms/linear-search.ts';
import type { MergeTrace } from './algorithms/merge-sort.ts';
import type { QueueTrace } from './algorithms/queues.ts';
import type { QuickTrace } from './algorithms/quick-sort.ts';
import type { RecursionTrace } from './algorithms/recursion.ts';
import type { TreeTrace } from './algorithms/trees.ts';
import {
  bstFrames,
  bubbleFrames,
  complexityFrames,
  dfsFrames,
  dpFrames,
  graphFrames,
  hashFrames,
  heapFrames,
  insertionSortFrames,
  linearSearchFrames,
  mergeSortFrames,
  queueFrames,
  quickSortFrames,
  recursionFrames,
  treeFrames
} from './anim/structure-frames.ts';
import type { StructureFrame } from './anim/structure-types.ts';

export type StructureRun =
  | { kind: 'queue'; trace: QueueTrace }
  | { kind: 'hash-table'; trace: HashTrace }
  | { kind: 'tree'; trace: TreeTrace }
  | { kind: 'bst'; trace: BstTrace }
  | { kind: 'heap'; trace: HeapTrace }
  | { kind: 'graph'; trace: GraphTrace }
  | { kind: 'linear-search'; trace: LinearSearchTrace }
  | { kind: 'bubble-sort'; trace: BubbleTrace }
  | { kind: 'insertion-sort'; trace: InsertionTrace }
  | { kind: 'merge-sort'; trace: MergeTrace }
  | { kind: 'quick-sort'; trace: QuickTrace }
  | { kind: 'graph-dfs'; trace: DfsTrace }
  | { kind: 'recursion'; trace: RecursionTrace }
  | { kind: 'dp-table'; trace: DpTrace }
  | { kind: 'complexity'; trace: ComplexityTrace };

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
  if (run.kind === 'bst') return bstFrames(run.trace);
  if (run.kind === 'heap') return heapFrames(run.trace);
  if (run.kind === 'graph') return graphFrames(run.trace);
  if (run.kind === 'linear-search') return linearSearchFrames(run.trace);
  if (run.kind === 'bubble-sort') return bubbleFrames(run.trace);
  if (run.kind === 'insertion-sort') return insertionSortFrames(run.trace);
  if (run.kind === 'merge-sort') return mergeSortFrames(run.trace);
  if (run.kind === 'quick-sort') return quickSortFrames(run.trace);
  if (run.kind === 'graph-dfs') return dfsFrames(run.trace);
  if (run.kind === 'recursion') return recursionFrames(run.trace);
  if (run.kind === 'complexity') return complexityFrames(run.trace);
  return dpFrames(run.trace);
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

  if (run.kind === 'bst') {
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

  if (run.kind === 'heap') {
    const trace = run.trace;
    return {
      label: 'MIN-HEAP',
      kickers: ['PARENT ≤ CHILD', 'COMPLETE TREE IN AN ARRAY'],
      facts: [
        { label: 'Peek at the minimum', value: 'O(1) — it is the root' },
        { label: 'Push and pop', value: 'O(log n) — one path up or down' },
        { label: 'This run', value: `${plural(trace.comparisons, 'comparison')} · ${plural(trace.steps.length, 'operation')}` }
      ],
      result:
        trace.root === null
          ? { title: 'HEAP EMPTY', sub: `${plural(trace.popped.length, 'value')} popped in sorted order` }
          : {
              title: `ROOT: ${trace.root}`,
              sub: `${plural(trace.popped.length, 'value')} popped · ${plural(trace.final.length, 'value')} still in the heap`
            },
      holdCaption: 'The root is always the minimum: peek is O(1), and only a push or pop walks a path.'
    };
  }

  if (run.kind === 'graph') {
    const trace = run.trace;
    return {
      label: 'GRAPH',
      kickers: ['VERTEX · EDGE · NEIGHBOUR', `BREADTH-FIRST FROM ${trace.start}`],
      facts: [
        { label: 'Store the graph (adjacency list)', value: 'O(V + E) space' },
        { label: 'Traverse every vertex and edge', value: 'O(V + E)' },
        { label: 'This graph', value: `${plural(trace.nodes.length, 'vertex')} · ${plural(trace.edges.length, 'edge')}` }
      ],
      result: {
        title: `VISITED ${trace.order.length} OF ${trace.nodes.length}`,
        sub: `order ${trace.order.join(' → ')}`
      },
      holdCaption: 'Breadth-first finishes every neighbour of a vertex before it goes one hop deeper.'
    };
  }

  if (run.kind === 'linear-search') {
    const trace = run.trace;
    return {
      label: 'LINEAR SEARCH',
      kickers: [`SCAN LEFT TO RIGHT · TARGET ${trace.target}`, 'NO ORDERING NEEDED'],
      facts: [
        { label: 'Worst case', value: `O(n) — all ${trace.array.length} cells` },
        { label: 'Space', value: 'O(1) — one index' },
        { label: 'This run', value: `${plural(trace.comparisons, 'comparison')} of ${trace.array.length}` }
      ],
      result:
        trace.foundIndex === null
          ? { title: `${trace.target} NOT FOUND`, sub: `${plural(trace.comparisons, 'comparison')} — the whole array was scanned` }
          : {
              title: `${trace.target} FOUND AT ${trace.foundIndex}`,
              sub: `${plural(trace.comparisons, 'comparison')} · stops at the first match`
            },
      holdCaption: 'One pass, no ordering required — the cost is however far the target happens to be.'
    };
  }

  if (run.kind === 'insertion-sort') {
    const trace = run.trace;
    return {
      label: 'INSERTION SORT',
      kickers: ['GROW A SORTED PREFIX', 'SHIFT UNTIL IT FITS'],
      facts: [
        { label: 'Worst case', value: 'O(n²) comparisons and shifts' },
        { label: 'Nearly sorted input', value: 'O(n) — few shifts' },
        { label: 'This run', value: `${plural(trace.comparisons, 'comparison')} · ${plural(trace.shifts, 'shift')}` }
      ],
      result: {
        title: `SORTED IN ${plural(trace.passes, 'pass')}`,
        sub: `[${trace.sorted.join(', ')}] · ${plural(trace.shifts, 'shift')}`
      },
      holdCaption: 'The prefix is always sorted, so the next value only has to slide left into place.'
    };
  }

  if (run.kind === 'merge-sort') {
    const trace = run.trace;
    return {
      label: 'MERGE SORT',
      kickers: ['SPLIT TO SINGLES', 'MERGE SORTED RUNS'],
      facts: [
        { label: 'Levels of splitting', value: `${trace.depth} — that is the log n` },
        { label: 'Every level merges n values', value: 'O(n log n)' },
        { label: 'This run', value: `${plural(trace.merges, 'merge')} · ${plural(trace.comparisons, 'comparison')}` }
      ],
      result: {
        title: `SORTED IN ${plural(trace.merges, 'merge')}`,
        sub: `[${trace.sorted.join(', ')}]`
      },
      holdCaption: 'Merging two sorted runs is linear, and the recursion is log n levels deep.'
    };
  }

  if (run.kind === 'quick-sort') {
    const trace = run.trace;
    return {
      label: 'QUICK SORT',
      kickers: ['PARTITION AROUND A PIVOT', 'SMALLER LEFT · LARGER RIGHT'],
      facts: [
        { label: 'One partition of a range', value: 'O(n) — one pass' },
        { label: 'Balanced pivots', value: 'O(n log n) expected' },
        { label: 'This run', value: `${plural(trace.partitions, 'partition')} · ${plural(trace.comparisons, 'comparison')}` }
      ],
      result: {
        title: `SORTED IN ${plural(trace.partitions, 'partition')}`,
        sub: `[${trace.sorted.join(', ')}] · ${plural(trace.swaps, 'swap')}`
      },
      holdCaption: 'The pivot lands where it belongs, so neither side ever touches the other again.'
    };
  }

  if (run.kind === 'graph-dfs') {
    const trace = run.trace;
    return {
      label: 'DEPTH-FIRST SEARCH',
      kickers: ['FOLLOW ONE BRANCH', `FROM ${trace.start} — BACKTRACK WHEN STUCK`],
      facts: [
        { label: 'Frontier', value: 'a stack of calls, not a queue' },
        { label: 'Every vertex and edge once', value: 'O(V + E)' },
        { label: 'This graph', value: `${plural(trace.nodes.length, 'vertex')} · ${plural(trace.edges.length, 'edge')}` }
      ],
      result: {
        title: `VISITED ${trace.order.length} OF ${trace.nodes.length}`,
        sub: `order ${trace.order.join(' → ')}`
      },
      holdCaption: 'Depth-first commits to one branch and only backs up when there is nowhere new to go.'
    };
  }

  if (run.kind === 'recursion') {
    const trace = run.trace;
    return {
      label: 'RECURSION',
      kickers: ['A CALL ON TOP OF A CALL', `fact(${trace.n}) — BASE CASE AT 1`],
      facts: [
        { label: 'Base case', value: 'the call that returns without recursing' },
        { label: 'Stack depth here', value: `${trace.deepest} frames` },
        { label: 'This run', value: `${plural(trace.calls, 'call')} down · ${plural(trace.returns, 'return')} up` }
      ],
      result: {
        title: `fact(${trace.n}) = ${trace.result}`,
        sub: `${plural(trace.returns, 'return')} unwound the stack`
      },
      holdCaption: 'Each call waits for a smaller copy of itself, so the answer has to travel back up.'
    };
  }

  if (run.kind === 'bubble-sort') {
    const bubble = run.trace;
    return {
      label: 'BUBBLE SORT',
      kickers: ['COMPARE NEIGHBOURS, SWAP', 'LARGEST VALUE BUBBLES RIGHT'],
      facts: [
        { label: 'Comparisons in the worst case', value: 'O(n²)' },
        { label: 'Space', value: 'O(1) — sorted in place' },
        { label: 'This run', value: `${plural(bubble.comparisons, 'comparison')} · ${plural(bubble.swaps, 'swap')} · ${plural(bubble.passes, 'pass')}` }
      ],
      result: {
        title: `SORTED IN ${bubble.passes} PASS${bubble.passes === 1 ? '' : 'ES'}`,
        sub: `[${bubble.sorted.join(', ')}] · ${plural(bubble.swaps, 'swap')}`
      },
      holdCaption: 'Each pass settles one more value at the end, so the next pass has one less to compare.'
    };
  }

  if (run.kind === 'complexity') {
    const trace = run.trace;
    const largest = trace.sizes[trace.sizes.length - 1] ?? 0;
    const atLargest = trace.series.map((item) => ({
      label: item.label,
      ops: item.points[item.points.length - 1]?.ops ?? 0
    }));
    const fastest = atLargest.reduce((top, item) => (item.ops > top.ops ? item : top), atLargest[0]);
    const slowest = atLargest.reduce((low, item) => (item.ops < low.ops ? item : low), atLargest[0]);
    const unitOf = (count: number) =>
      trace.unit === 'operations'
        ? plural(count, 'operation')
        : `${count} frame${count === 1 ? '' : 's'} held`;
    return {
      label: 'GROWTH',
      kickers: [`${trace.series.length} MEASURED CURVE${trace.series.length === 1 ? '' : 'S'}`, 'x = INPUT SIZE · y = WORK DONE'],
      facts: [
        { label: `Measured at n = ${largest}`, value: atLargest.map((item) => `${item.label} ${item.ops}`).join(' · ') },
        { label: 'Grows fastest here', value: `${fastest.label} — ${unitOf(fastest.ops)}` },
        { label: 'Grows slowest here', value: `${slowest.label} — ${unitOf(slowest.ops)}` }
      ],
      result: {
        title: `n = ${largest}`,
        sub: atLargest.map((item) => `${item.label} ${item.ops}`).join(' · ')
      },
      holdCaption: 'Every point on this chart is counted by the real implementation, not estimated.'
    };
  }

  const dp = run.trace;
  return {
    label: 'DYNAMIC PROGRAMMING',
    kickers: ['SOLVE EACH SUBPROBLEM ONCE', 'REUSE THE ANSWER'],
    facts: [
      { label: 'Naive recursion re-solves', value: 'the same branches again and again' },
      { label: 'Tabulation', value: 'states × transition cost' },
      { label: 'This run', value: `${plural(dp.steps.length, 'state')} · fib(${dp.n}) = ${dp.result}` }
    ],
    result: {
      title: `fib(${dp.n}) = ${dp.result}`,
      sub: `${plural(dp.table.length, 'cell')} filled once each`
    },
    holdCaption: 'The table turns overlapping recursion into one pass over the states.'
  };
}
