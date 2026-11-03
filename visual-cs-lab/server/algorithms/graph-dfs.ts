/**
 * Depth-first search: the verified walk behind the Depth-First Search short.
 *
 * DFS follows one branch as far as it goes, marking each vertex as it arrives,
 * and only then backs up to try the next unexplored neighbour. The frontier is
 * therefore a stack of calls rather than a queue: the most recently reached
 * vertex is always the next one explored. The trace records one step per visit
 * with the call stack that produced it, and `validateDfsTrace` replays the same
 * recursion on a rebuilt adjacency list, so the animation can only show a walk
 * the traversal actually made.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';
import { parseGraphEdges, parseGraphNodes, type GraphEdgeSpec } from './graphs.ts';

export type DfsStep = {
  /** 1-based visit number. */
  n: number;
  /** The vertex being visited. */
  nodeId: string;
  /** Which visit this is, in order. */
  order: number;
  /** Vertices visited so far, in order. */
  visited: string[];
  /** The call stack that reached this vertex, outermost first. */
  stack: string[];
  /** How deep in the recursion this visit happens. */
  depth: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type DfsTrace = {
  nodes: { id: string; label: string }[];
  edges: GraphEdgeSpec[];
  start: string;
  steps: DfsStep[];
  order: string[];
};

export type DfsExpectation = {
  order?: string[];
};

export type DfsConfig = {
  kind: 'graph-dfs';
  nodes: (string | { id: string; label?: string })[];
  edges: GraphEdgeSpec[];
  start: string;
  expect?: DfsExpectation;
};

export function isDfsConfig(config: unknown): config is DfsConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'graph-dfs' && Array.isArray(record.nodes) && Array.isArray(record.edges);
}

/** Neighbour lists in edge declaration order, both directions for an undirected graph. */
function adjacencyOf(nodes: { id: string }[], edges: GraphEdgeSpec[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const [from, to] of edges) {
    adjacency.get(from)?.push(to);
    adjacency.get(to)?.push(from);
  }
  return adjacency;
}

function describe(items: (number | string)[]): string {
  return items.length === 0 ? 'empty' : `[${items.join(', ')}]`;
}

/** Walks the graph depth-first from `start`, recording one step per visit. */
export function traceDfs(input: { nodes: unknown; edges: unknown; start: string }): DfsTrace {
  const nodes = parseGraphNodes(input.nodes);
  const edges = parseGraphEdges(input.edges, nodes);
  const adjacency = adjacencyOf(nodes, edges);
  const start = String(input.start || nodes[0]?.id || '');
  const steps: DfsStep[] = [];
  const order: string[] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): void => {
    visited.add(nodeId);
    order.push(nodeId);
    path.push(nodeId);
    const undiscovered = (adjacency.get(nodeId) ?? []).filter((next) => !visited.has(next));
    steps.push({
      n: order.length,
      nodeId,
      order: order.length,
      visited: [...order],
      stack: [...path],
      depth: path.length - 1,
      message:
        undiscovered.length === 0
          ? `Visit ${nodeId} — every neighbour is already seen, so this call backs up.`
          : `Visit ${nodeId} and go straight into ${undiscovered[0]} before trying ${undiscovered.length === 1 ? 'anything else' : `the other ${undiscovered.length - 1}`}.`,
      hudLabel: `VISIT ${nodeId}`,
      hudDetail: `${undiscovered.length === 0 ? 'dead end — back up' : `dives into ${undiscovered[0]}`} · depth ${path.length - 1}`
    });

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!visited.has(next)) visit(next);
    }
    path.pop();
  };

  if (adjacency.has(start)) visit(start);

  return { nodes, edges, start, steps, order };
}

/**
 * Proves the trace is a real depth-first walk: the adjacency list is rebuilt
 * from the edge list, the recursion is replayed from the same start, and every
 * step's visit order and call stack has to agree with the replay.
 */
export function validateDfsTrace(trace: DfsTrace, expectation: DfsExpectation | undefined): Validation {
  const failures: string[] = [];
  const nodes = parseGraphNodes(trace.nodes);
  const edges = parseGraphEdges(trace.edges, nodes);

  if (nodes.length === 0) return { ok: false, failures: ['The graph has no vertices to traverse.'] };
  if (!trace.start || !nodes.some((node) => node.id === trace.start)) {
    return { ok: false, failures: [`The start vertex ${trace.start || '(none)'} is not in the graph.`] };
  }

  const adjacency = adjacencyOf(nodes, edges);
  const seen = new Set<string>();
  const order: string[] = [];
  const path: string[] = [];

  const visit = (nodeId: string): void => {
    seen.add(nodeId);
    order.push(nodeId);
    path.push(nodeId);

    const index = order.length - 1;
    const step = trace.steps[index];
    if (!step) {
      failures.push(`The walk reaches ${nodeId} but the trace has no step ${index + 1}.`);
    } else {
      if (step.nodeId !== nodeId) {
        failures.push(`Step ${index + 1} visits ${step.nodeId} where depth-first visits ${nodeId}.`);
      }
      if (step.visited.join(',') !== order.join(',')) {
        failures.push(`Step ${index + 1} has visited [${step.visited.join(', ')}] where the walk has [${order.join(', ')}].`);
      }
      if (step.stack.join(',') !== path.join(',')) {
        failures.push(`Step ${index + 1} shows stack ${describe(step.stack)} where the calls hold ${describe(path)}.`);
      }
    }

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!seen.has(next)) visit(next);
    }
    path.pop();
  };

  visit(trace.start);

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
