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
import type { HashTrace } from '../algorithms/hash-tables.ts';
import type { QueueTrace } from '../algorithms/queues.ts';
import type { TreeTrace } from '../algorithms/trees.ts';
import type { StructureEdge, StructureFrame, StructureLabel, StructureNode } from './structure-types.ts';

function values(items: number[]): string {
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
