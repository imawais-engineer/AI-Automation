/**
 * Graphs: the verified breadth-first walk behind the Graphs short.
 *
 * A graph is vertices plus the directed edges between them, stored as an
 * adjacency list. The trace is a breadth-first walk from one start vertex: the
 * frontier is a queue, so every neighbour of the current vertex is discovered
 * before the walk goes deeper. `validateGraphTrace` rebuilds the adjacency list
 * from the edge list and replays the walk, so the animation can only show a
 * frontier the traversal actually produced.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type GraphNodeSpec = { id: string; label?: string };

export type GraphEdgeSpec = [string, string];

export type GraphStep = {
  /** 1-based visit number. */
  n: number;
  /** The vertex being visited. */
  nodeId: string;
  /** Which visit this is, in order. */
  order: number;
  /** Vertices discovered so far, in discovery order. */
  visited: string[];
  /** Vertices waiting in the queue after this visit. */
  frontier: string[];
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type GraphTrace = {
  nodes: { id: string; label: string }[];
  edges: GraphEdgeSpec[];
  start: string;
  steps: GraphStep[];
  order: string[];
};

export type GraphExpectation = {
  order?: string[];
};

export type GraphConfig = {
  kind: 'graph';
  nodes: (string | GraphNodeSpec)[];
  edges: GraphEdgeSpec[];
  start: string;
  expect?: GraphExpectation;
};

export function isGraphConfig(config: unknown): config is GraphConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'graph' && Array.isArray(record.nodes) && Array.isArray(record.edges);
}

/** Vertices in the order they were declared, each with the label to draw. */
export function parseGraphNodes(raw: unknown): { id: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  const nodes: { id: string; label: string }[] = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String((item as GraphNodeSpec)?.id ?? '').trim();
    if (!id) continue;
    const label = typeof item === 'object' && item ? String((item as GraphNodeSpec).label ?? id) : id;
    nodes.push({ id, label });
  }
  return nodes;
}

/** Edges keep only those whose ends both exist. */
export function parseGraphEdges(raw: unknown, nodes: { id: string }[]): GraphEdgeSpec[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(nodes.map((node) => node.id));
  const edges: GraphEdgeSpec[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const from = String(item[0]).trim();
    const to = String(item[1]).trim();
    if (!known.has(from) || !known.has(to)) continue;
    edges.push([from, to]);
  }
  return edges;
}

function adjacencyOf(nodes: { id: string }[], edges: GraphEdgeSpec[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const [from, to] of edges) {
    adjacency.get(from)?.push(to);
  }
  return adjacency;
}

function describe(items: string[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

/** Walks the graph breadth-first from `start`, recording one step per visit. */
export function traceGraph(input: { nodes: unknown; edges: unknown; start: string }): GraphTrace {
  const nodes = parseGraphNodes(input.nodes);
  const edges = parseGraphEdges(input.edges, nodes);
  const adjacency = adjacencyOf(nodes, edges);
  const start = String(input.start || nodes[0]?.id || '');
  const steps: GraphStep[] = [];
  const order: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  if (adjacency.has(start)) {
    queue.push(start);
    visited.add(start);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    order.push(nodeId);
    const discovered: string[] = [];
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
      discovered.push(next);
    }
    steps.push({
      n: order.length,
      nodeId,
      order: order.length,
      visited: [...order],
      frontier: [...queue],
      message:
        discovered.length === 0
          ? `Visit ${nodeId} — none of its neighbours are new, the queue stays ${describe(queue)}.`
          : `Visit ${nodeId} and discover ${discovered.join(', ')} — the queue is ${describe(queue)}.`,
      hudLabel: `VISIT ${nodeId}`,
      hudDetail: `${discovered.length === 0 ? 'no new neighbours' : `discovers ${discovered.join(', ')}`} · ${queue.length} waiting`
    });
  }

  return { nodes, edges, start, steps, order };
}

/**
 * Proves the trace is a real breadth-first walk: the adjacency list is rebuilt
 * from the edge list, the walk is replayed from the same start, and every step's
 * visit order and frontier has to agree with the replay.
 */
export function validateGraphTrace(trace: GraphTrace, expectation: GraphExpectation | undefined): Validation {
  const failures: string[] = [];
  const nodes = parseGraphNodes(trace.nodes);
  const edges = parseGraphEdges(trace.edges, nodes);

  if (nodes.length === 0) return { ok: false, failures: ['The graph has no vertices to traverse.'] };
  if (!trace.start || !nodes.some((node) => node.id === trace.start)) {
    return { ok: false, failures: [`The start vertex ${trace.start || '(none)'} is not in the graph.`] };
  }
  if (/^(nodes|edges)$/.test(trace.start)) {
    failures.push(`The start vertex is "${trace.start}", which looks like a configuration field rather than a vertex.`);
  }

  const adjacency = adjacencyOf(nodes, edges);
  const seen = new Set<string>([trace.start]);
  const queue: string[] = [trace.start];
  const order: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    order.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }

    const index = order.length - 1;
    const step = trace.steps[index];
    if (!step) {
      failures.push(`The walk reaches ${nodeId} but the trace has no step ${index + 1}.`);
      continue;
    }
    if (step.nodeId !== nodeId) {
      failures.push(`Step ${index + 1} visits ${step.nodeId} where breadth-first visits ${nodeId}.`);
    }
    if (step.visited.join(',') !== order.join(',')) {
      failures.push(`Step ${index + 1} has visited [${step.visited.join(', ')}] where the walk has [${order.join(', ')}].`);
    }
    if (step.frontier.join(',') !== queue.join(',')) {
      failures.push(`Step ${index + 1} shows frontier [${step.frontier.join(', ')}] where the queue holds [${queue.join(', ')}].`);
    }
  }

  if (trace.steps.length !== order.length) {
    failures.push(`The trace has ${trace.steps.length} steps but the walk visits ${order.length} vertices.`);
  }
  if (trace.order.join(',') !== order.join(',')) {
    failures.push(`The trace reports order [${trace.order.join(', ')}] where the walk gives [${order.join(', ')}].`);
  }
  if (expectation?.order && expectation.order.join(',') !== order.join(',')) {
    failures.push(`The walk gives [${order.join(', ')}] but [${expectation.order.join(', ')}] was expected.`);
  }

  return { ok: failures.length === 0, failures };
}

export const DEFAULT_GRAPH_NODES: string[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export const DEFAULT_GRAPH_EDGES: GraphEdgeSpec[] = [
  ['A', 'B'],
  ['A', 'C'],
  ['B', 'D'],
  ['C', 'E'],
  ['D', 'F'],
  ['E', 'F']
];
