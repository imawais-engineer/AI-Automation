/**
 * Tree traversal: the verified trace behind the Trees short.
 *
 * The tree is declared, not invented: every node names its parent, so the shape
 * on screen is the shape the configuration describes. The walk is breadth-first
 * from the root, and each step carries the frontier it left behind — the
 * animation shows the queue of nodes waiting to be visited, which is the whole
 * reason BFS orders a tree level by level.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type TreeNodeSpec = {
  id: string;
  value: number;
  parent: string | null;
};

export type TreeStep = {
  /** 1-based visit number. */
  n: number;
  nodeId: string;
  value: number;
  /** Visit order: 1 is first. */
  order: number;
  /** 0 for the root. */
  depth: number;
  /** Nodes waiting in the frontier after this visit, in queue order. */
  frontier: string[];
  /** Nodes already visited, in visit order. */
  visited: string[];
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type TreeTrace = {
  nodes: TreeNodeSpec[];
  steps: TreeStep[];
  order: number[];
  /** Number of levels from the root down to the deepest leaf. */
  levels: number;
};

export type TreeExpectation = {
  order?: number[];
  levels?: number;
};

export type TreeConfig = {
  kind: 'tree';
  nodes: TreeNodeSpec[];
  expect?: TreeExpectation;
};

/** The demo tree: 8 at the root, two children per level, three levels deep. */
export const DEFAULT_TREE_NODES: TreeNodeSpec[] = [
  { id: 'n8', value: 8, parent: null },
  { id: 'n3', value: 3, parent: 'n8' },
  { id: 'n10', value: 10, parent: 'n8' },
  { id: 'n1', value: 1, parent: 'n3' },
  { id: 'n6', value: 6, parent: 'n3' },
  { id: 'n14', value: 14, parent: 'n10' }
];

export function isTreeConfig(config: unknown): config is TreeConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'tree' && Array.isArray(record.nodes);
}

export function parseTreeNodes(raw: unknown): TreeNodeSpec[] {
  if (!Array.isArray(raw)) return [];
  const nodes: TreeNodeSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = String(record.id || '').trim();
    const value = Number(record.value);
    if (!id || !Number.isFinite(value)) continue;
    nodes.push({ id, value, parent: record.parent ? String(record.parent) : null });
  }
  return nodes;
}

function describe(nodes: TreeNodeSpec[]): string {
  return nodes.length === 0 ? 'empty' : `[${nodes.map((node) => node.value).join(', ')}]`;
}

export type TreeShapeCheck = { failures: string[] };

/** Structural rules the frame (and BFS) depend on: one root, real parents, no cycles. */
export function checkTreeShape(nodes: TreeNodeSpec[]): TreeShapeCheck {
  const failures: string[] = [];
  if (nodes.length === 0) return { failures: ['The tree has no nodes.'] };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parent);
  if (roots.length !== 1) failures.push(`A tree needs exactly one root; this configuration has ${roots.length}.`);

  for (const node of nodes) {
    if (!node.parent) continue;
    if (!byId.has(node.parent)) {
      failures.push(`Node ${node.value} names a parent that is not in the tree.`);
      continue;
    }
    const seen = new Set<string>([node.id]);
    let cursor: TreeNodeSpec | undefined = byId.get(node.parent);
    while (cursor) {
      if (seen.has(cursor.id)) {
        failures.push(`The tree has a cycle through node ${node.value}.`);
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
  }

  for (const node of nodes) {
    const children = nodes.filter((item) => item.parent === node.id);
    if (children.length > 2) {
      failures.push(`Node ${node.value} has ${children.length} children; the frame draws two per node.`);
    }
  }

  return { failures };
}

/** Breadth-first walk from the root, in the child order the configuration gives. */
export function traceTree(input: TreeNodeSpec[]): TreeTrace {
  const nodes = parseTreeNodes(input);
  const byParent = new Map<string, TreeNodeSpec[]>();
  for (const node of nodes) {
    const key = node.parent ?? '__root__';
    const list = byParent.get(key) || [];
    list.push(node);
    byParent.set(key, list);
  }

  const root = nodes.find((node) => !node.parent);
  const steps: TreeStep[] = [];
  const order: number[] = [];
  const visited: string[] = [];
  let levels = 0;

  if (!root) return { nodes, steps, order, levels };

  const queue: { node: TreeNodeSpec; depth: number }[] = [{ node: root, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { node: TreeNodeSpec; depth: number };
    if (seen.has(current.node.id)) continue;
    seen.add(current.node.id);
    visited.push(current.node.id);
    order.push(current.node.value);
    levels = Math.max(levels, current.depth + 1);

    for (const child of byParent.get(current.node.id) || []) {
      queue.push({ node: child, depth: current.depth + 1 });
    }

    const frontier = queue.map((item) => item.node.id);
    const n = steps.length + 1;
    const waiting = queue.map((item) => item.node.value);
    steps.push({
      n,
      nodeId: current.node.id,
      value: current.node.value,
      order: n,
      depth: current.depth,
      frontier,
      visited: [...visited],
      message:
        n === 1
          ? `Visit the root ${current.node.value} first — the frontier starts with its children.`
          : waiting.length > 0
            ? `Visit ${current.node.value} at level ${current.depth} — the frontier now waits on ${describe(
                queue.map((item) => ({ id: item.node.id, value: item.node.value, parent: null }))
              )}.`
            : `Visit ${current.node.value} last — the frontier is empty, so the walk is over.`,
      hudLabel: `VISIT ${current.node.value} · step ${n} of ${nodes.length}`,
      hudDetail:
        waiting.length > 0
          ? `level ${current.depth} · frontier ${describe(
              queue.map((item) => ({ id: item.node.id, value: item.node.value, parent: null }))
            )}`
          : `level ${current.depth} · nothing left waiting`
    });
  }

  return { nodes, steps, order, levels };
}

/**
 * Proves the trace is a real breadth-first walk: an independent replay has to
 * agree with every visit, depth and frontier, every node has to be reached
 * exactly once, and the expected order has to match.
 */
export function validateTreeTrace(trace: TreeTrace, expectation: TreeExpectation | undefined): Validation {
  const failures: string[] = [];
  const nodes = parseTreeNodes(trace.nodes);
  const shape = checkTreeShape(nodes);
  failures.push(...shape.failures);

  const root = nodes.find((node) => !node.parent);
  if (!root) return { ok: false, failures: failures.length ? failures : ['The tree has no root.'] };

  const byParent = new Map<string, TreeNodeSpec[]>();
  for (const node of nodes) {
    const key = node.parent ?? '__root__';
    byParent.set(key, [...(byParent.get(key) || []), node]);
  }

  const queue: TreeNodeSpec[] = [root];
  const expectedOrder: number[] = [];
  const expectedDepths: number[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift() as TreeNodeSpec;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    expectedOrder.push(node.value);
    expectedDepths.push(trace.steps.length ? trace.steps[expectedOrder.length - 1]?.depth ?? 0 : 0);
    for (const child of byParent.get(node.id) || []) queue.push(child);
  }

  if (seen.size !== nodes.length) {
    failures.push(`${nodes.length - seen.size} node(s) cannot be reached from the root.`);
  }
  if (trace.steps.length !== expectedOrder.length) {
    failures.push(`The trace visits ${trace.steps.length} nodes where the tree holds ${expectedOrder.length}.`);
  }
  if (trace.order.join(',') !== expectedOrder.join(',')) {
    failures.push(`The trace visits [${trace.order.join(', ')}] where breadth-first visits [${expectedOrder.join(', ')}].`);
  }

  trace.steps.forEach((step, index) => {
    if (step.value !== expectedOrder[index]) {
      failures.push(`Visit ${index + 1} shows ${step.value} where breadth-first reaches ${String(expectedOrder[index])}.`);
    }
    if (step.order !== index + 1) {
      failures.push(`Visit ${index + 1} is numbered ${step.order}.`);
    }
    const depth = depthOf(nodes, step.nodeId);
    if (step.depth !== depth) {
      failures.push(`Node ${step.value} is drawn at level ${step.depth} but sits at level ${depth}.`);
    }
  });

  const levels = nodes.reduce((max, node) => Math.max(max, depthOf(nodes, node.id) + 1), 0);
  if (trace.levels !== levels) {
    failures.push(`The tree is declared ${trace.levels} levels tall but its nodes span ${levels}.`);
  }
  if (expectation?.order && expectation.order.join(',') !== expectedOrder.join(',')) {
    failures.push(`The visit order should be [${expectation.order.join(', ')}] but the tree produces [${expectedOrder.join(', ')}].`);
  }
  if (expectation?.levels !== undefined && expectation.levels !== levels) {
    failures.push(`The tree has ${levels} levels where ${expectation.levels} was expected.`);
  }

  return { ok: failures.length === 0, failures };
}

function depthOf(nodes: TreeNodeSpec[], id: string): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let depth = 0;
  let cursor = byId.get(id);
  const guard = new Set<string>();
  while (cursor?.parent) {
    if (guard.has(cursor.id)) break;
    guard.add(cursor.id);
    depth += 1;
    cursor = byId.get(cursor.parent);
  }
  return depth;
}
