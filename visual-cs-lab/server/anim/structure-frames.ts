/**
 * Layouts: verified structure steps turned into frames.
 *
 * Each function here reads only the trace it is given, so the picture is a
 * function of the algorithm's own output. Positions are stable across frames —
 * a queue cell keeps its identity as it moves, a tree node keeps the slot it
 * will occupy once its subtree is complete — which is what lets the painter
 * animate arrivals and departures instead of redrawing a still image.
 */

import type { BstTrace } from '../algorithms/binary-search-trees.ts';
import type { BubbleTrace } from '../algorithms/bubble-sort.ts';
import type { DpTrace } from '../algorithms/dynamic-programming.ts';
import type { DfsTrace } from '../algorithms/graph-dfs.ts';
import type { GraphTrace } from '../algorithms/graphs.ts';
import type { HashTrace } from '../algorithms/hash-tables.ts';
import type { HeapTrace } from '../algorithms/heaps.ts';
import type { InsertionTrace } from '../algorithms/insertion-sort.ts';
import type { LinearSearchTrace } from '../algorithms/linear-search.ts';
import type { MergeTrace } from '../algorithms/merge-sort.ts';
import type { QueueTrace } from '../algorithms/queues.ts';
import type { QuickTrace } from '../algorithms/quick-sort.ts';
import type { RecursionTrace } from '../algorithms/recursion.ts';
import type { TreeTrace } from '../algorithms/trees.ts';
import type { StructureEdge, StructureFrame, StructureLabel, StructureNode } from './structure-types.ts';

function values(items: (number | string)[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

/* ------------------------------------------------------------------- queue */

const QUEUE_H = 164;
const QUEUE_GAP = 22;
const QUEUE_ROW_MAX = 860;
const QUEUE_TOP = -84;

/**
 * The queue as one horizontal rail, front on the left. A cell keeps its identity
 * until it is dequeued, and the front cell is always the emphasised one — the
 * value that has waited longest.
 */
export function queueFrames(trace: QueueTrace): StructureFrame[] {
  const widest = trace.steps.reduce((max, step) => Math.max(max, step.items.length), 1);
  const slots = Math.max(3, widest);
  const cellW = Math.max(104, Math.min(168, (QUEUE_ROW_MAX - (slots - 1) * QUEUE_GAP) / slots));
  const rowWidth = slots * cellW + (slots - 1) * QUEUE_GAP;
  const ids: string[] = [];
  let serial = 0;

  return trace.ops.map((operation, index) => {
    if (operation.op === 'enqueue') ids.push(`q${serial++}`);
    else if (operation.op === 'dequeue' && ids.length > 0) ids.shift();

    const step = trace.steps[index];
    const items = step?.items ?? [];

    const nodes: StructureNode[] = items.map((value, position) => ({
      id: ids[position] ?? `q${position}`,
      value: String(value),
      sub: String(position),
      x: -rowWidth / 2 + position * (cellW + QUEUE_GAP) + cellW / 2,
      y: QUEUE_TOP + QUEUE_H / 2,
      w: cellW,
      h: QUEUE_H,
      tone: position === 0 ? 'active' : 'normal'
    }));

    const markers = [];
    if (nodes[0]) markers.push({ node: nodes[0].id, label: 'FRONT', tone: 'accent' as const });
    if (nodes.length > 1) {
      markers.push({ node: nodes[nodes.length - 1].id, label: 'REAR', tone: 'violet' as const });
    }

    return {
      nodes,
      edges: [],
      markers,
      labels: [],
      note:
        items.length > 0
          ? `next to leave: ${items[0]} · ${items.length} in line`
          : 'empty — nothing to serve'
    };
  });
}

/* -------------------------------------------------------------------- hash */

const HASH_TOP = -250;
const HASH_ROW = 104;
const KEY_W = 116;
const KEY_H = 94;
const KEY_SLOT = 132;

/** Bucket rows with their collision chains, numbered down the left margin. */
export function hashFrames(trace: HashTrace): StructureFrame[] {
  const labels: StructureLabel[] = Array.from({ length: trace.size }, (_, bucket) => ({
    text: `${bucket}`,
    x: -430,
    y: HASH_TOP + bucket * HASH_ROW + 10,
    align: 'left' as const,
    size: 34
  }));
  labels.push({ text: 'bucket', x: -430, y: HASH_TOP - 62, align: 'left', size: 24 });

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = [];
    step.buckets.forEach((chain, bucket) => {
      chain.forEach((key, slot) => {
        const isActiveBucket = bucket === step.bucket;
        const isTarget = isActiveBucket && key === step.key && slot === step.slot;
        const isProbe = isActiveBucket && step.slot !== null && slot < step.slot;
        nodes.push({
          id: `k${key}`,
          value: String(key),
          x: -40 + slot * KEY_SLOT,
          y: HASH_TOP + bucket * HASH_ROW,
          w: KEY_W,
          h: KEY_H,
          tone: isTarget ? (step.op === 'get' ? 'done' : 'active') : isProbe ? 'dim' : 'normal'
        });
      });
    });

    return {
      nodes,
      edges: [],
      markers: [],
      labels,
      note: `${step.key} mod ${trace.size} = ${step.bucket} · bucket ${step.bucket} holds ${values(step.chain)}`
    };
  });
}

/* -------------------------------------------------------------------- tree */

const TREE_TOP = -320;
const TREE_LEVEL = 210;
const TREE_NODE = 128;
const TREE_SPREAD = 840;

type Position = { x: number; y: number; depth: number };

/**
 * Node positions by in-order slot, so a parent sits centred over its own subtree
 * and the same tree always lays out the same way.
 */
export function treePositions(nodes: { id: string; parent: string | null }[]): Map<string, Position> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    children.set(node.parent, [...(children.get(node.parent) || []), node.id]);
  }
  const root = nodes.find((node) => !node.parent);

  const slots = new Map<string, number>();
  const depths = new Map<string, number>();
  let next = 0;

  const visit = (id: string, depth: number): number => {
    depths.set(id, depth);
    const kids = children.get(id) || [];
    if (kids.length === 0) {
      const slot = next++;
      slots.set(id, slot);
      return slot;
    }
    const first = visit(kids[0], depth + 1);
    const last = kids.length > 1 ? visit(kids[1], depth + 1) : first;
    const slot = (first + last) / 2;
    slots.set(id, slot);
    return slot;
  };

  if (root) visit(root.id, 0);

  const total = Math.max(1, next);
  const step = total > 1 ? Math.min(TREE_SPREAD / (total - 1), 300) : 0;
  const positions = new Map<string, Position>();
  for (const node of nodes) {
    const slot = slots.get(node.id) ?? 0;
    const depth = depths.get(node.id) ?? 0;
    positions.set(node.id, {
      x: (slot - (total - 1) / 2) * step,
      y: TREE_TOP + depth * TREE_LEVEL,
      depth
    });
  }
  return positions;
}

function treeEdges(nodes: { id: string; parent: string | null }[]): StructureEdge[] {
  return nodes
    .filter((node) => node.parent)
    .map((node) => ({ from: node.parent as string, to: node.id }));
}

/** The breadth-first walk: visited nodes settle, the current one is lit. */
export function treeFrames(trace: TreeTrace): StructureFrame[] {
  const positions = treePositions(trace.nodes);
  const edges = treeEdges(trace.nodes);
  const byId = new Map(trace.nodes.map((node) => [node.id, node]));

  return trace.steps.map((step) => {
    const visited = new Set(step.visited);
    const nodes: StructureNode[] = trace.nodes.map((node) => {
      const position = positions.get(node.id) as Position;
      return {
        id: node.id,
        value: String(node.value),
        x: position.x,
        y: position.y,
        w: TREE_NODE,
        h: TREE_NODE,
        tone: node.id === step.nodeId ? 'active' : visited.has(node.id) ? 'done' : 'normal'
      };
    });

    const frontier = step.frontier.map((id) => byId.get(id)?.value ?? 0);
    return {
      nodes,
      edges,
      markers: [{ node: step.nodeId, label: `visit ${step.order}`, tone: 'accent' as const }],
      labels: [],
      note: `frontier ${values(frontier)}`
    };
  });
}

/** Insert and search on the ordered tree: the path taken is the comparison path. */
export function bstFrames(trace: BstTrace): StructureFrame[] {
  const positions = treePositions(trace.nodes);

  return trace.steps.map((step) => {
    const present = new Set(step.tree.map((node) => node.id));
    const path = new Set(step.path);
    const nodes: StructureNode[] = step.tree.map((node) => {
      const position = positions.get(node.id) as Position;
      const isCurrent = node.id === step.nodeId;
      return {
        id: node.id,
        value: String(node.value),
        x: position.x,
        y: position.y,
        w: TREE_NODE,
        h: TREE_NODE,
        tone: isCurrent ? (step.found ? 'done' : 'active') : path.has(node.id) ? 'done' : 'normal'
      };
    });

    const markers = [];
    if (step.found && step.nodeId) {
      markers.push({ node: step.nodeId, label: 'FOUND', tone: 'coral' as const });
    }

    return {
      nodes,
      edges: treeEdges(step.tree.filter((node) => present.has(node.id))),
      markers,
      labels: [],
      note: `left < node < right · ${step.tree.length} key${step.tree.length === 1 ? '' : 's'} inserted`
    };
  });
}

/* -------------------------------------------------------------------- heap */

const HEAP_TOP = -320;
const HEAP_LEVEL = 176;
const HEAP_NODE = 112;

/** Depth of a node in a tree stored in level order. */
function heapDepth(index: number): number {
  return Math.floor(Math.log2(index + 1));
}

/** Index of a node within its own level. */
function heapColumn(index: number): number {
  const depth = heapDepth(index);
  return index - (Math.pow(2, depth) - 1);
}

/**
 * The heap as the complete tree its array describes: level 0 is the root, and
 * every level fills left to right. Indices are stable, so a sifted value reads
 * as moving through slots rather than the whole tree being redrawn.
 */
export function heapFrames(trace: HeapTrace): StructureFrame[] {
  const widest = trace.steps.reduce((max, step) => Math.max(max, step.heap.length), 1);
  const deepest = heapDepth(widest - 1);
  const step = Math.min(300, 880 / Math.max(1, Math.pow(2, deepest) - 1));

  return trace.steps.map((step_) => {
    const heap = step_.heap;
    const path = new Set(step_.path);
    const resting = step_.path.length > 0 ? step_.path[step_.path.length - 1] : -1;

    const nodes: StructureNode[] = heap.map((value, index) => {
      const depth = heapDepth(index);
      const span = Math.pow(2, depth) - 1;
      return {
        id: `h${index}`,
        value: String(value),
        sub: String(index),
        x: (heapColumn(index) - span / 2) * step,
        y: HEAP_TOP + depth * HEAP_LEVEL,
        w: HEAP_NODE,
        h: HEAP_NODE,
        tone: index === resting ? 'active' : path.has(index) ? 'done' : 'normal'
      };
    });

    const edges: StructureEdge[] = heap
      .map((_, index) => index)
      .filter((index) => index > 0)
      .map((index) => ({ from: `h${(index - 1) >> 1}`, to: `h${index}` }));

    const markers =
      step_.op === 'push'
        ? [{ node: `h${resting}`, label: `SIFT UP · ${String(step_.value)}`, tone: 'accent' as const }]
        : heap.length > 0
          ? [{ node: 'h0', label: `ROOT ${heap[0]}`, tone: 'coral' as const }]
          : [];

    return {
      nodes,
      edges,
      markers,
      labels: [],
      note:
        heap.length === 0
          ? 'empty — nothing at the root'
          : `parent ≤ child · root ${heap[0]} · ${heap.length} in the array`
    };
  });
}

/* ------------------------------------------------------------------- graph */

const GRAPH_RX = 336;
const GRAPH_RY = 215;
const GRAPH_NODE = 112;
const GRAPH_TOP = -170;

/**
 * The graph on a ring, vertices in declaration order. Every vertex is always
 * drawn so the edges stay readable; the walk only changes the tones, which is
 * what shows the frontier spreading one hop at a time.
 */
function graphRing(nodes: { id: string }[]): Map<string, { x: number; y: number }> {
  const count = Math.max(1, nodes.length);
  return new Map(
    nodes.map((node, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
      return [
        node.id,
        {
          x: Math.cos(angle) * GRAPH_RX * (count > 4 ? 1 : 0.82),
          y: GRAPH_TOP + Math.sin(angle) * GRAPH_RY * (count > 4 ? 1 : 0.82)
        }
      ];
    })
  );
}

export function graphFrames(trace: GraphTrace): StructureFrame[] {
  const positions = graphRing(trace.nodes);

  return trace.steps.map((step) => {
    const visited = new Set(step.visited);
    const nodes: StructureNode[] = trace.nodes.map((node) => {
      const position = positions.get(node.id) as { x: number; y: number };
      const isCurrent = node.id === step.nodeId;
      return {
        id: node.id,
        value: node.label,
        x: position.x,
        y: position.y,
        w: GRAPH_NODE,
        h: GRAPH_NODE,
        tone: isCurrent ? 'active' : visited.has(node.id) ? 'done' : 'dim'
      };
    });

    return {
      nodes,
      edges: trace.edges.map(([from, to]) => ({ from, to })),
      markers: [{ node: step.nodeId, label: `VISIT ${step.order}`, tone: 'accent' as const }],
      labels: [],
      note: `frontier ${values(step.frontier)} · ${step.visited.length} of ${trace.nodes.length} visited`
    };
  });
}

/* ------------------------------------------------------------------- scans */

const SCAN_TOP = -110;
const SCAN_H = 168;
const SCAN_GAP = 22;
const SCAN_ROW_MAX = 880;

/** Cell geometry for a single row of array cells, centred on the stage. */
function cellLayout(
  count: number,
  rowMax = SCAN_ROW_MAX
): { width: number; rowWidth: number; x: (index: number) => number } {
  const slots = Math.max(3, count);
  const width = Math.max(80, Math.min(168, (rowMax - (slots - 1) * SCAN_GAP) / slots));
  const rowWidth = slots * width + (slots - 1) * SCAN_GAP;
  return {
    width,
    rowWidth,
    x: (index) => -rowWidth / 2 + index * (width + SCAN_GAP) + width / 2
  };
}

/** The scan: the cell being compared is lit, everything already read is faded. */
export function linearSearchFrames(trace: LinearSearchTrace): StructureFrame[] {
  const layout = cellLayout(trace.array.length);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = trace.array.map((value, index) => ({
      id: `a${index}`,
      value: String(value),
      sub: String(index),
      x: layout.x(index),
      y: SCAN_TOP,
      w: layout.width,
      h: SCAN_H,
      tone: step.found && index === step.index ? 'done' : index === step.index ? 'active' : index < step.index ? 'dim' : 'normal'
    }));

    return {
      nodes,
      edges: [],
      markers: step.found
        ? [{ node: `a${step.index}`, label: `FOUND ${step.value}`, tone: 'coral' as const }]
        : [],
      labels: [{ text: `target ${trace.target}`, x: -440, y: SCAN_TOP - 150, align: 'left' as const, size: 30 }],
      note: `${step.found ? 'match' : 'no match'} · ${step.comparisons} comparison${step.comparisons === 1 ? '' : 's'}`
    };
  });
}

/** The passes: the compared pair is lit, everything already sorted is settled. */
export function bubbleFrames(trace: BubbleTrace): StructureFrame[] {
  const layout = cellLayout(trace.array.length);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.array.map((value, index) => ({
      id: `a${index}`,
      value: String(value),
      sub: String(index),
      x: layout.x(index),
      y: SCAN_TOP,
      w: layout.width,
      h: SCAN_H,
      tone: index >= step.sortedFrom ? 'done' : index === step.i || index === step.j ? 'active' : 'normal'
    }));

    return {
      nodes,
      edges: [],
      markers: [{ node: `a${step.j}`, label: step.swapped ? 'SWAP' : 'KEEP', tone: step.swapped ? 'coral' : 'accent' }],
      labels: [{ text: `pass ${step.pass}`, x: -440, y: SCAN_TOP - 150, align: 'left' as const, size: 30 }],
      note: `${step.comparisons} comparison${step.comparisons === 1 ? '' : 's'} · ${step.swaps} swap${step.swaps === 1 ? '' : 's'} · ${step.array.length - step.sortedFrom} sorted`
    };
  });
}

/* ------------------------------------------------------------------- sorts */

/** The growing sorted prefix: the compared cell is lit, the key's pass is marked. */
export function insertionSortFrames(trace: InsertionTrace): StructureFrame[] {
  const layout = cellLayout(trace.array.length, 760);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.array.map((value, index) => ({
      id: `a${index}`,
      value: String(value),
      sub: String(index),
      x: layout.x(index),
      y: SCAN_TOP,
      w: layout.width,
      h: SCAN_H,
      tone: index <= step.sortedTo ? 'done' : index === step.j ? 'active' : 'normal'
    }));

    const markerIndex = step.placed ? step.pass : step.j;
    return {
      nodes,
      edges: [],
      markers: [
        {
          node: `a${markerIndex}`,
          label: step.placed ? `INSERT ${step.key}` : step.shifted ? 'SHIFT' : 'STOP',
          tone: step.shifted || step.placed ? ('coral' as const) : ('accent' as const)
        }
      ],
      labels: [{ text: `pass ${step.pass}`, x: -400, y: SCAN_TOP - 230, align: 'left' as const, size: 30 }],
      note: `${step.comparisons} comparison${step.comparisons === 1 ? '' : 's'} · ${step.shifts} shift${step.shifts === 1 ? '' : 's'} · prefix ${step.sortedTo + 1} sorted`
    };
  });
}

/** The merge: the two runs' boundary is marked and the joined range is settled. */
export function mergeSortFrames(trace: MergeTrace): StructureFrame[] {
  const layout = cellLayout(trace.array.length, 760);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.array.map((value, index) => ({
      id: `a${index}`,
      value: String(value),
      sub: String(index),
      x: layout.x(index),
      y: SCAN_TOP,
      w: layout.width,
      h: SCAN_H,
      tone: index < step.lo || index >= step.hi ? 'dim' : index < step.mid ? 'normal' : 'active'
    }));

    return {
      nodes,
      edges: [],
      markers: [{ node: `a${step.mid}`, label: 'MERGE', tone: 'coral' as const }],
      labels: [
        { text: `merge ${step.lo}–${step.hi - 1}`, x: -400, y: SCAN_TOP - 230, align: 'left' as const, size: 30 }
      ],
      note: `sorted run [${step.merged.join(', ')}]`
    };
  });
}

/** The partition: the pivot is held at the range's end while the boundary advances. */
export function quickSortFrames(trace: QuickTrace): StructureFrame[] {
  const layout = cellLayout(trace.array.length, 760);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.array.map((value, index) => ({
      id: `a${index}`,
      value: String(value),
      sub: String(index),
      x: layout.x(index),
      y: SCAN_TOP,
      w: layout.width,
      h: SCAN_H,
      tone:
        index < step.lo || index > step.hi
          ? 'dim'
          : step.placed && index === step.pivotIndex
            ? 'done'
            : index === step.pivotIndex || index === step.j
              ? 'active'
              : 'normal'
    }));

    const markerIndex = step.placed ? step.pivotIndex : step.j;
    return {
      nodes,
      edges: [],
      markers: [
        {
          node: `a${markerIndex}`,
          label: step.placed ? 'PIVOT' : step.swapped ? 'SMALLER' : 'RIGHT',
          tone: step.placed ? ('coral' as const) : step.swapped ? ('coral' as const) : ('accent' as const)
        }
      ],
      labels: [{ text: `range ${step.lo}–${step.hi}`, x: -400, y: SCAN_TOP - 230, align: 'left' as const, size: 30 }],
      note: `${step.comparisons} comparison${step.comparisons === 1 ? '' : 's'} · ${step.swaps} swap${step.swaps === 1 ? '' : 's'} · boundary ${step.boundary}`
    };
  });
}

/* -------------------------------------------------------------------- dfs */

/** The depth-first walk: visited vertices settle, the current one is lit, the call stack is named. */
export function dfsFrames(trace: DfsTrace): StructureFrame[] {
  const positions = graphRing(trace.nodes);

  return trace.steps.map((step) => {
    const visited = new Set(step.visited);
    const nodes: StructureNode[] = trace.nodes.map((node) => {
      const position = positions.get(node.id) as { x: number; y: number };
      const isCurrent = node.id === step.nodeId;
      return {
        id: node.id,
        value: node.label,
        x: position.x,
        y: position.y,
        w: GRAPH_NODE,
        h: GRAPH_NODE,
        tone: isCurrent ? 'active' : visited.has(node.id) ? 'done' : 'dim'
      };
    });

    return {
      nodes,
      edges: trace.edges.map(([from, to]) => ({ from, to })),
      markers: [{ node: step.nodeId, label: `VISIT ${step.order}`, tone: 'accent' as const }],
      labels: [],
      note: `stack ${values(step.stack)} · depth ${step.depth} · ${step.visited.length} of ${trace.nodes.length} visited`
    };
  });
}

/* -------------------------------------------------------------- recursion */

const RECURSION_ROW = 104;
const RECURSION_GAP = 64;
const RECURSION_TOP = -300;
const RECURSION_W = 520;

/** The call stack as a column: the newest call is lit, returned calls carry their value. */
export function recursionFrames(trace: RecursionTrace): StructureFrame[] {
  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.frames.map((frame, index) => {
      const newest = index === step.frames.length - 1;
      return {
        id: `f${frame.argument}`,
        value: frame.label,
        sub: frame.value === null ? `n = ${frame.argument}` : `= ${frame.value}`,
        x: 0,
        y: RECURSION_TOP + index * (RECURSION_ROW + RECURSION_GAP),
        w: RECURSION_W,
        h: RECURSION_ROW,
        tone: newest ? (frame.value === null ? 'active' : 'done') : frame.value === null ? 'normal' : 'done'
      };
    });

    const newest = nodes[nodes.length - 1];
    const label = step.kind === 'call' ? 'CALL' : step.kind === 'base' ? 'BASE CASE' : `RETURN ${step.result ?? ''}`;

    return {
      nodes,
      edges: [],
      markers: [],
      labels: newest ? [{ text: label, x: 286, y: newest.y - 17, align: 'left' as const, size: 28 }] : []
    };
  });
}

/* ------------------------------------------------------ dynamic programming */

const DP_TOP = -110;
const DP_H = 168;
const DP_GAP = 14;
const DP_ROW_MAX = 820;

/** Cell geometry for the table: every state keeps its slot from the first beat on. */
function dpLayout(count: number): { width: number; x: (index: number) => number } {
  const slots = Math.max(3, count);
  const width = Math.max(72, Math.min(120, (DP_ROW_MAX - (slots - 1) * DP_GAP) / slots));
  const rowWidth = slots * width + (slots - 1) * DP_GAP;
  return { width, x: (index) => -rowWidth / 2 + index * (width + DP_GAP) + width / 2 };
}

/** The table filling left to right: solved cells settle, the next one is lit. */
export function dpFrames(trace: DpTrace): StructureFrame[] {
  const layout = dpLayout(trace.n + 1);

  return trace.steps.map((step) => {
    const nodes: StructureNode[] = step.table.map((value, index) => ({
      id: `d${index}`,
      value: value === null ? '·' : String(value),
      sub: String(index),
      x: layout.x(index),
      y: DP_TOP,
      w: layout.width,
      h: DP_H,
      tone: index === step.index ? 'active' : value === null ? 'dim' : 'done'
    }));

    return {
      nodes,
      edges: [],
      markers: [{ node: `d${step.index}`, label: `= ${step.value}`, tone: 'coral' as const }],
      labels: [{ text: `fib(${trace.n}) table`, x: -400, y: DP_TOP - 230, align: 'left' as const, size: 30 }],
      note:
        step.operands === null
          ? `base case · ${step.filled} of ${trace.n + 1} states solved`
          : `${step.operands[0]} + ${step.operands[1]} = ${step.value} · ${step.filled} of ${trace.n + 1} states solved`
    };
  });
}
