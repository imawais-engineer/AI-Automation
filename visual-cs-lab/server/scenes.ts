import { createHash } from 'node:crypto';

import {
  DEFAULT_STACK_OPS,
  parseOps,
  trace as traceStack,
  validate as validateStack,
  type StackEvent,
  type Validation
} from './algorithms/stack.ts';
import {
  isArrayConfig,
  traceArray,
  validateArrayTrace,
  type ArrayConfig,
  type ArrayStep
} from './algorithms/arrays.ts';
import {
  isLinkedListConfig,
  traceLinkedList,
  validateLinkedListTrace,
  type LinkedListConfig,
  type LinkedListStep
} from './algorithms/linked-lists.ts';
import {
  isBinarySearchConfig,
  traceBinarySearch,
  validateBinarySearchTrace,
  type BinarySearchConfig,
  type BinarySearchStep
} from './algorithms/binary-search.ts';
import {
  isQueueConfig,
  parseQueueOps,
  traceQueue,
  validateQueueTrace,
  type QueueConfig,
  type QueueStep
} from './algorithms/queues.ts';
import {
  isHashConfig,
  parseHashOps,
  parseHashSize,
  traceHashTable,
  validateHashTrace,
  type HashConfig,
  type HashStep
} from './algorithms/hash-tables.ts';
import {
  isTreeConfig,
  parseTreeNodes,
  traceTree,
  validateTreeTrace,
  type TreeConfig,
  type TreeStep
} from './algorithms/trees.ts';
import {
  isBstConfig,
  traceBst,
  validateBstTrace,
  type BstConfig,
  type BstStep
} from './algorithms/binary-search-trees.ts';
import {
  isHeapConfig,
  parseHeapOps,
  traceHeap,
  validateHeapTrace,
  type HeapConfig,
  type HeapStep
} from './algorithms/heaps.ts';
import {
  isGraphConfig,
  parseGraphEdges,
  parseGraphNodes,
  traceGraph,
  validateGraphTrace,
  type GraphConfig,
  type GraphStep
} from './algorithms/graphs.ts';
import {
  isLinearSearchConfig,
  traceLinearSearch,
  validateLinearSearchTrace,
  type LinearSearchConfig,
  type LinearSearchStep
} from './algorithms/linear-search.ts';
import {
  isBubbleSortConfig,
  traceBubbleSort,
  validateBubbleSortTrace,
  type BubbleSortConfig,
  type BubbleStep
} from './algorithms/bubble-sort.ts';
import {
  isComplexityConfig,
  traceComplexity,
  validateComplexityTrace,
  type ComplexityConfig,
  type ComplexityStep
} from './algorithms/complexity.ts';
import {
  isInsertionSortConfig,
  traceInsertionSort,
  validateInsertionSortTrace,
  type InsertionSortConfig,
  type InsertionStep
} from './algorithms/insertion-sort.ts';
import {
  isMergeSortConfig,
  traceMergeSort,
  validateMergeSortTrace,
  type MergeSortConfig,
  type MergeStep
} from './algorithms/merge-sort.ts';
import {
  isQuickSortConfig,
  traceQuickSort,
  validateQuickSortTrace,
  type QuickSortConfig,
  type QuickStep
} from './algorithms/quick-sort.ts';
import {
  isDfsConfig,
  traceDfs,
  validateDfsTrace,
  type DfsConfig,
  type DfsStep
} from './algorithms/graph-dfs.ts';
import {
  isRecursionConfig,
  traceRecursion,
  validateRecursionTrace,
  type RecursionConfig,
  type RecursionStep
} from './algorithms/recursion.ts';
import {
  isDpConfig,
  traceDp,
  validateDpTrace,
  type DpConfig,
  type DpStep
} from './algorithms/dynamic-programming.ts';
import { structureChrome, type StructureRun } from './structure-run.ts';
import { brandingFrom, openingCopy, type Branding } from './branding.ts';

export type SceneType = 'open' | 'hook' | 'concept' | 'code' | 'execution' | 'trace' | 'complexity' | 'summary' | 'brand';

export type StackVisual = {
  kind: 'stack';
  items: number[];
  top: number | null;
  op: 'push' | 'pop' | 'top' | null;
  value: number | null;
  returned: number | null;
  step: number;
  total: number;
};

export type BinarySearchVisual = {
  kind: 'binary-search';
  array: number[];
  target: number;
  foundIndex: number | null;
  mode: 'setup' | 'trace';
  steps: BinarySearchStep[];
};

export type ArrayVisual = {
  kind: 'array';
  array: number[];
  total: number;
  steps: ArrayStep[];
};

export type LinkedListVisual = {
  kind: 'linked-list';
  values: number[];
  target: number;
  foundIndex: number | null;
  steps: LinkedListStep[];
};

export type StructureVisual = {
  kind: 'structure';
  /** Which structure the trace drives: queue, hash table, tree, BST, heap, graph, scan or sort. */
  structureKind: StructureRun['kind'];
  steps: (
    | QueueStep
    | HashStep
    | TreeStep
    | BstStep
    | HeapStep
    | GraphStep
    | LinearSearchStep
    | BubbleStep
    | InsertionStep
    | MergeStep
    | QuickStep
    | DfsStep
    | RecursionStep
    | DpStep
    | ComplexityStep
  )[];
};

export type SceneVisual = StackVisual | BinarySearchVisual | ArrayVisual | LinkedListVisual | StructureVisual;

export type Scene = {
  id: string;
  type: SceneType;
  durationMs: number;
  title: string;
  subtitle: string;
  caption: string;
  code?: { language: string; lines: string[]; highlight: number };
  visual?: SceneVisual;
  /** Short labelled facts drawn as cards (complexity scenes). */
  facts?: { label: string; value: string }[];
};

export type LessonInput = {
  id: string;
  concept_id: string;
  title: string;
  audience: string;
  objective: string;
  duration_seconds: number;
  hook: string;
  narration: string;
  on_screen_text: string;
  key_takeaway: string;
  cta: string;
  sources: string;
  /** Human review state: draft, in_review or approved. */
  review_status?: string;
  /** Per-lesson animation input (JSON), overriding the concept's demo config. */
  animation_input?: string;
  /** Stored storyboard, JSON encoded. */
  scenes: string;
};

export type ConceptInput = {
  id: string;
  slug: string;
  name: string;
  objectives: string;
  summary: string;
  plain_explanation: string;
  technical_explanation: string;
  pseudocode: string;
  reference_language: string;
  reference_code: string;
  complexity_time: string;
  complexity_space: string;
  example_input: string;
  expected_output: string;
  animation_config: string;
};

export type ConceptRun = {
  kind: 'stack' | 'binary-search' | 'array' | 'linked-list' | 'structure' | 'none';
  supported: boolean;
  /** The verified structure trace, when this concept animates one. */
  structure: StructureRun | null;
  /** Stack events, empty for other kinds. */
  events: StackEvent[];
  /** Verified binary search steps, empty for other kinds. */
  steps: BinarySearchStep[];
  /** Verified linked list visits, empty for other kinds. */
  linkedSteps: LinkedListStep[];
  /** Verified array visits, empty for other kinds. */
  arraySteps: ArrayStep[];
  /** Sum an array trace produced (array kind). */
  total: number;
  foundIndex: number | null;
  summary: string;
  /** The input the trusted run was produced from (binary search only). */
  input: number[];
  target: number | null;
  comparisons: number;
  complexity: { time: string; space: string; arraySize: number; comparisons: number } | null;
  errors: string[];
  validation: Validation;
  eventCount: number;
};

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || '');
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function readAnimationConfig(concept: ConceptInput): Record<string, unknown> {
  return safeJson<Record<string, unknown>>(concept.animation_config, {});
}

/**
 * The input a lesson actually animates: the lesson's own configuration when the
 * Create screen set one, otherwise the concept's verified demo configuration.
 */
export function effectiveConcept(lesson: LessonInput, concept: ConceptInput): ConceptInput {
  const input = String(lesson.animation_input || '').trim();
  if (!input) return concept;
  return { ...concept, animation_config: input };
}

/** Runs the concept's trusted animation configuration, if it has one. */
export function runConcept(concept: ConceptInput): ConceptRun {
  const config = readAnimationConfig(concept);

  if (isArrayConfig(config)) {
    const arrayConfig = config as unknown as ArrayConfig;
    const trace = traceArray(arrayConfig.array);
    const validation = validateArrayTrace(trace, arrayConfig.expect, arrayConfig.array);
    return {
      kind: 'array',
      supported: true,
      structure: null,
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: trace.steps,
      total: trace.sum,
      foundIndex: null,
      summary: `visits ${trace.steps.length} cells and totals ${trace.sum}`,
      input: trace.array,
      target: null,
      comparisons: trace.steps.length,
      complexity: { time: 'O(1) access · O(n) traversal', space: 'O(n)', arraySize: trace.array.length, comparisons: trace.steps.length },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isLinkedListConfig(config)) {
    const listConfig = config as unknown as LinkedListConfig;
    const trace = traceLinkedList(listConfig.values, listConfig.target);
    const validation = validateLinkedListTrace(trace, listConfig.expect, listConfig.values, listConfig.target);
    return {
      kind: 'linked-list',
      supported: true,
      structure: null,
      events: [],
      steps: [],
      linkedSteps: trace.steps,
      arraySteps: [],
      total: 0,
      foundIndex: trace.foundIndex,
      summary: trace.foundIndex === null ? `walks ${trace.steps.length} nodes without a match` : `finds ${trace.target} at node ${trace.foundIndex}`,
      input: trace.values,
      target: trace.target,
      comparisons: trace.comparisons,
      complexity: { time: 'O(n) search', space: 'O(n)', arraySize: trace.values.length, comparisons: trace.comparisons },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isBinarySearchConfig(config)) {
    const binary = config as unknown as BinarySearchConfig;
    const trace = traceBinarySearch(binary.array, binary.target);
    const validation = validateBinarySearchTrace(trace, binary.expect, binary.array, binary.target);
    return {
      kind: 'binary-search',
      supported: true,
      structure: null,
      events: [],
      steps: trace.steps,
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: trace.foundIndex >= 0 ? trace.foundIndex : null,
      summary: trace.summary,
      input: trace.array,
      target: trace.target,
      comparisons: trace.comparisons,
      complexity: trace.complexity,
      errors: trace.errors,
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isComplexityConfig(config)) {
    const complexityConfig = config as ComplexityConfig;
    const trace = traceComplexity(complexityConfig);
    const validation = validateComplexityTrace(trace, complexityConfig.expect);
    const largest = trace.sizes[trace.sizes.length - 1] ?? 0;
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'complexity', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `measures ${trace.series.length} growth curve${trace.series.length === 1 ? '' : 's'} up to n = ${largest}`,
      input: [],
      target: null,
      comparisons: trace.peak,
      complexity: {
        time: trace.series.map((item) => item.label).join(' · '),
        space: 'O(1) extra to plot',
        arraySize: largest,
        comparisons: trace.peak
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isQueueConfig(config)) {
    const queueConfig = config as QueueConfig;
    const trace = traceQueue(parseQueueOps(queueConfig.ops));
    const validation = validateQueueTrace(trace, queueConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'queue', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `runs ${trace.steps.length} FIFO operations and leaves [${trace.final.join(', ')}]`,
      input: [],
      target: null,
      comparisons: trace.steps.length,
      complexity: {
        time: 'O(1) enqueue and dequeue',
        space: 'O(n)',
        arraySize: trace.final.length,
        comparisons: trace.steps.length
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isHashConfig(config)) {
    const hashConfig = config as HashConfig;
    const trace = traceHashTable({ size: parseHashSize(hashConfig.size), ops: parseHashOps(hashConfig.ops) });
    const validation = validateHashTrace(trace, hashConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'hash-table', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `stores ${trace.keys.length} keys in ${trace.size} buckets with ${trace.collisions} collision${trace.collisions === 1 ? '' : 's'}`,
      input: [],
      target: null,
      comparisons: trace.probes,
      complexity: {
        time: 'O(1) expected, O(n) worst case',
        space: 'O(n)',
        arraySize: trace.size,
        comparisons: trace.probes
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isTreeConfig(config)) {
    const treeConfig = config as TreeConfig;
    const trace = traceTree(parseTreeNodes(treeConfig.nodes));
    const validation = validateTreeTrace(trace, treeConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'tree', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `visits ${trace.steps.length} nodes level by level across ${trace.levels} levels`,
      input: [],
      target: null,
      comparisons: trace.steps.length,
      complexity: {
        time: 'O(n) traversal',
        space: 'O(h) frontier and depth',
        arraySize: trace.steps.length,
        comparisons: trace.steps.length
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isBstConfig(config)) {
    const bstConfig = config as BstConfig;
    const trace = traceBst({ insert: bstConfig.insert, search: bstConfig.search });
    const validation = validateBstTrace(trace, bstConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'bst', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `inserts ${trace.nodes.length} keys and ${trace.found ? 'finds' : 'misses'} ${trace.search} in ${trace.comparisons} comparison${trace.comparisons === 1 ? '' : 's'}`,
      input: [],
      target: trace.search,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(h) search and insert',
        space: 'O(n)',
        arraySize: trace.nodes.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isHeapConfig(config)) {
    const heapConfig = config as HeapConfig;
    const trace = traceHeap(parseHeapOps(heapConfig.ops));
    const validation = validateHeapTrace(trace, heapConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'heap', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `runs ${trace.steps.length} heap operations and leaves [${trace.final.join(', ')}] with ${trace.root} at the root`,
      input: [],
      target: null,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(log n) push and pop, O(1) peek',
        space: 'O(n)',
        arraySize: trace.final.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isGraphConfig(config)) {
    const graphConfig = config as GraphConfig;
    const trace = traceGraph({ nodes: graphConfig.nodes, edges: graphConfig.edges, start: graphConfig.start });
    const validation = validateGraphTrace(trace, graphConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'graph', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `walks ${trace.order.length} of ${parseGraphNodes(graphConfig.nodes).length} vertices breadth-first from ${trace.start}`,
      input: [],
      target: null,
      comparisons: trace.steps.length,
      complexity: {
        time: 'O(V + E) traversal',
        space: 'O(V + E) adjacency list',
        arraySize: parseGraphEdges(graphConfig.edges, parseGraphNodes(graphConfig.nodes)).length,
        comparisons: trace.steps.length
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isLinearSearchConfig(config)) {
    const searchConfig = config as LinearSearchConfig;
    const trace = traceLinearSearch({ array: searchConfig.array, target: searchConfig.target });
    const validation = validateLinearSearchTrace(trace, searchConfig.expect, searchConfig.array, Number(searchConfig.target));
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'linear-search', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: trace.foundIndex,
      summary:
        trace.foundIndex === null
          ? `scans ${trace.comparisons} cells without finding ${trace.target}`
          : `finds ${trace.target} at index ${trace.foundIndex} in ${trace.comparisons} comparison${trace.comparisons === 1 ? '' : 's'}`,
      input: trace.array,
      target: trace.target,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(n) scan',
        space: 'O(1)',
        arraySize: trace.array.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isBubbleSortConfig(config)) {
    const sortConfig = config as BubbleSortConfig;
    const trace = traceBubbleSort(sortConfig.array);
    const validation = validateBubbleSortTrace(trace, sortConfig.expect, sortConfig.array);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'bubble-sort', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `sorts ${trace.array.length} values in ${trace.passes} pass${trace.passes === 1 ? '' : 'es'} with ${trace.swaps} swap${trace.swaps === 1 ? '' : 's'}`,
      input: trace.array,
      target: null,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(n²) comparisons',
        space: 'O(1)',
        arraySize: trace.array.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isInsertionSortConfig(config)) {
    const sortConfig = config as InsertionSortConfig;
    const trace = traceInsertionSort(sortConfig.array);
    const validation = validateInsertionSortTrace(trace, sortConfig.expect, sortConfig.array);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'insertion-sort', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `sorts ${trace.array.length} values with ${trace.shifts} shift${trace.shifts === 1 ? '' : 's'}`,
      input: trace.array,
      target: null,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(n²) worst, O(n) nearly sorted',
        space: 'O(1)',
        arraySize: trace.array.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isMergeSortConfig(config)) {
    const sortConfig = config as MergeSortConfig;
    const trace = traceMergeSort(sortConfig.array);
    const validation = validateMergeSortTrace(trace, sortConfig.expect, sortConfig.array);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'merge-sort', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `sorts ${trace.array.length} values in ${trace.merges} merge${trace.merges === 1 ? '' : 's'} over ${trace.depth} level${trace.depth === 1 ? '' : 's'}`,
      input: trace.array,
      target: null,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(n log n)',
        space: 'O(n) auxiliary',
        arraySize: trace.array.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isQuickSortConfig(config)) {
    const sortConfig = config as QuickSortConfig;
    const trace = traceQuickSort(sortConfig.array);
    const validation = validateQuickSortTrace(trace, sortConfig.expect, sortConfig.array);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'quick-sort', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `sorts ${trace.array.length} values in ${trace.partitions} partition${trace.partitions === 1 ? '' : 's'}`,
      input: trace.array,
      target: null,
      comparisons: trace.comparisons,
      complexity: {
        time: 'O(n log n) average, O(n²) worst',
        space: 'O(log n) stack',
        arraySize: trace.array.length,
        comparisons: trace.comparisons
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isDfsConfig(config)) {
    const dfsConfig = config as DfsConfig;
    const trace = traceDfs({ nodes: dfsConfig.nodes, edges: dfsConfig.edges, start: dfsConfig.start });
    const validation = validateDfsTrace(trace, dfsConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'graph-dfs', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `walks ${trace.order.length} of ${parseGraphNodes(dfsConfig.nodes).length} vertices depth-first from ${trace.start}`,
      input: [],
      target: null,
      comparisons: trace.steps.length,
      complexity: {
        time: 'O(V + E) traversal',
        space: 'O(V + E) adjacency list',
        arraySize: parseGraphEdges(dfsConfig.edges, parseGraphNodes(dfsConfig.nodes)).length,
        comparisons: trace.steps.length
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isRecursionConfig(config)) {
    const recursionConfig = config as RecursionConfig;
    const trace = traceRecursion({ n: recursionConfig.n });
    const validation = validateRecursionTrace(trace, recursionConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'recursion', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `descends ${trace.calls} calls and unwinds ${trace.returns} returns to reach fact(${trace.n}) = ${trace.result}`,
      input: [],
      target: null,
      comparisons: trace.returns,
      complexity: {
        time: `${trace.calls} calls — one per subproblem`,
        space: `O(${trace.deepest}) call stack`,
        arraySize: trace.deepest,
        comparisons: trace.returns
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  if (isDpConfig(config)) {
    const dpConfig = config as DpConfig;
    const trace = traceDp({ n: dpConfig.n });
    const validation = validateDpTrace(trace, dpConfig.expect);
    return {
      kind: 'structure',
      supported: true,
      structure: { kind: 'dp-table', trace },
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: `fills ${trace.steps.length} states once each to reach fib(${trace.n}) = ${trace.result}`,
      input: [],
      target: null,
      comparisons: trace.steps.length,
      complexity: {
        time: `O(${trace.n}) states`,
        space: `O(${trace.n}) table`,
        arraySize: trace.table.length,
        comparisons: trace.steps.length
      },
      errors: [],
      validation,
      eventCount: trace.steps.length
    };
  }

  const ops = config.ops ? parseOps(config.ops) : [];
  const supported = ops.length > 0;
  if (!supported) {
    return {
      kind: 'none',
      supported: false,
      structure: null,
      events: [],
      steps: [],
      linkedSteps: [],
      arraySteps: [],
      total: 0,
      foundIndex: null,
      summary: '',
      input: [],
      target: null,
      comparisons: 0,
      complexity: null,
      errors: [],
      validation: { ok: false, failures: [] },
      eventCount: 0
    };
  }
  const { events, errors } = traceStack(ops);
  const expectation = (config.expect || {}) as Parameters<typeof validateStack>[1];
  const validation = validateStack(events, expectation);
  return {
    kind: 'stack',
    supported: true,
    structure: null,
    events,
    steps: [],
    linkedSteps: [],
    arraySteps: [],
    total: 0,
    foundIndex: null,
    summary: '',
    input: [],
    target: null,
    comparisons: events.length,
    complexity: null,
    errors,
    validation,
    eventCount: events.length
  };
}

export function lessonDurationMs(lesson: LessonInput): number {
  const seconds = Number(lesson.duration_seconds);
  const clamped = Number.isFinite(seconds) ? Math.max(10, Math.min(60, seconds)) : 20;
  return Math.round(clamped * 1000);
}

/**
 * Splits `totalMs` across scene weights so the parts add up to exactly `totalMs`.
 * Largest-remainder allocation keeps the timeline honest: a 20 second lesson is
 * 20000 ms of video, not 19.98.
 */
export function allocateDurations(weights: number[], totalMs: number): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const exact = weights.map((weight) => (totalMs * weight) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = Math.round(totalMs - parts.reduce((sum, value) => sum + value, 0));
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; remainder > 0 && order.length > 0; i++, remainder--) {
    parts[order[i % order.length].index] += 1;
  }
  return parts;
}

type SceneSpec = { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> };
type Bookend = Omit<Scene, 'id' | 'durationMs'>;

/** Lays the main beats out inside the time left after the bookends. */
function layoutBeats(specs: SceneSpec[], totalMs: number): Omit<Scene, 'id'>[] {
  const durations = allocateDurations(
    specs.map((spec) => spec.weight),
    totalMs
  );
  return specs.map((spec, index) => ({ ...spec.scene, durationMs: durations[index] }));
}

/**
 * Assembles one continuous timeline: the branded opening and the branded closing
 * own their durations first, and the lesson itself is fitted into what is left.
 *
 * Nothing is overlaid on top of the original length — every beat, caption and
 * narration timestamp is derived from these durations, and they add up to exactly
 * the lesson's selected duration.
 */
function withBookends(
  specs: SceneSpec[],
  totalMs: number,
  branding: Branding,
  bookends: { opening: Bookend; ending: Bookend }
): Scene[] {
  const openingMs = Math.round(branding.openingMs);
  const endingMs = Math.round(branding.endingMs);
  const mainMs = Math.max(1000, totalMs - openingMs - endingMs);
  return [
    { ...bookends.opening, durationMs: openingMs },
    ...layoutBeats(specs, mainMs),
    { ...bookends.ending, durationMs: endingMs }
  ].map((scene, index) => ({ ...scene, id: `s${index + 1}` }));
}

/** The branded opening beat: the lesson's short title and the presenter credit. */
function openingScene(branding: Branding, lesson: LessonInput, concept: ConceptInput): Bookend {
  const copy = openingCopy(lesson, concept, branding);
  return { type: 'open', title: copy.title, subtitle: copy.kicker, caption: copy.credit };
}

/** The branded closing beat: presenter, professional title and the closing line. */
function closingScene(branding: Branding): Bookend {
  return { type: 'brand', title: branding.presenter, subtitle: branding.role, caption: branding.closing };
}

/**
 * The shortest lesson that can hold the opening, a readable lesson and the closing.
 *
 * A stack short needs roughly a second per verified operation (plus its fixed
 * explanation beats); a binary trace needs a few seconds per comparison and a
 * readable halving panel. Below this the storyboard would still add up, but the
 * animation would flash past — so it is reported instead of silently compressed.
 */
export function minimumDurationMs(branding: Branding, run: ConceptRun): number {
  const bookends = branding.openingMs + branding.endingMs;
  if (run.kind === 'binary-search') return bookends + 12000;
  // A traversal needs a readable setup, one beat per visited cell and a held result.
  if (run.kind === 'array') return bookends + 14000 + run.eventCount * 900;
  if (run.kind === 'linked-list') return bookends + 14000 + run.eventCount * 1100;
  // A structure walk needs the same room: one readable beat per verified step.
  if (run.kind === 'structure') return bookends + 14000 + run.eventCount * 900;
  const ops = Math.max(1, run.events.length);
  // 12.6 weight units of fixed explanation beats around 4.2 per operation.
  return bookends + Math.round(((ops * 4.2 + 12.6) / 4.2) * 950);
}

/**
 * Beat weights for a stack lesson body, in seconds: 2.2 hook · 1.8 setup ·
 * 4.2 per verified operation · 3.6 LIFO · 5.0 complexity (which also carries the
 * labelled underflow example). The branded opening and closing are allocated
 * separately, before these are fitted into the remaining time.
 *
 * These are beat durations on one continuous animation, not separate slides.
 */
const STACK_BEAT_SECONDS = { hook: 2.2, setup: 1.8, op: 4.2, lifo: 3.6, complexity: 5.0 };

function buildStackScenes(
  lesson: LessonInput,
  concept: ConceptInput,
  run: ConceptRun,
  totalMs: number,
  branding: Branding
): Scene[] {
  const events = run.events;
  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: STACK_BEAT_SECONDS.hook,
      scene: {
        type: 'hook',
        title: lesson.hook || `${concept.name}: the idea in one line`,
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: STACK_BEAT_SECONDS.setup,
      scene: {
        type: 'concept',
        title: concept.name,
        subtitle: concept.plain_explanation || concept.summary,
        caption: lesson.narration.split('\n')[0] || ''
      }
    }
  ];

  events.forEach((event, index) => {
    specs.push({
      weight: STACK_BEAT_SECONDS.op,
      scene: {
        type: 'execution',
        title: event.op === 'push' ? `PUSH(${event.value})` : event.op.toUpperCase(),
        subtitle: concept.slug === 'stacks' ? 'LIFO — newest value on top' : concept.summary,
        caption: event.message,
        visual: {
          kind: 'stack',
          items: event.items,
          top: event.top,
          op: event.op,
          value: event.value,
          returned: event.returned,
          step: index + 1,
          total: events.length
        }
      }
    });
  });

  specs.push(
    {
      weight: STACK_BEAT_SECONDS.lifo,
      scene: {
        type: 'summary',
        title: lesson.key_takeaway || 'LIFO: the last value in is the first value out',
        subtitle: concept.example_input ? `Input: ${concept.example_input}` : '',
        caption: lesson.cta || lesson.key_takeaway
      }
    },
    {
      weight: STACK_BEAT_SECONDS.complexity,
      scene: {
        type: 'complexity',
        title: 'Complexity',
        subtitle: concept.complexity_time,
        caption: `${concept.complexity_time}. Space: ${concept.complexity_space}. Underflow: popping an empty stack returns EMPTY.`,
        facts: [
          { label: 'Auxiliary space', value: concept.complexity_space || 'O(1)' },
          { label: 'Rule', value: 'Only the top element is touched.' }
        ]
      }
    }
  );

  return withBookends(specs, totalMs, branding, {
    opening: openingScene(branding, lesson, concept),
    ending: closingScene(branding)
  });
}

/**
 * The binary search lesson body: hook, sorted setup, verified trace and the
 * halving/complexity panel, wrapped by the branded opening and closing.
 */
function buildBinarySearchScenes(
  lesson: LessonInput,
  concept: ConceptInput,
  totalMs: number,
  branding: Branding
): Scene[] {
  const config = readAnimationConfig(concept) as unknown as BinarySearchConfig;
  const run = runConcept(concept);
  const array = Array.isArray(config.array) ? config.array : [];
  const target = Number(config.target);

  const setup: BinarySearchVisual = {
    kind: 'binary-search',
    array,
    target,
    foundIndex: run.foundIndex,
    mode: 'setup',
    steps: []
  };

  // Beat weights for the body, in seconds of a 45 second video: hook 2.5 ·
  // sorted setup 5 · verified trace 27.5 · halving/complexity 7.
  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 2.5,
      scene: {
        type: 'hook',
        title: lesson.hook || 'Searching a sorted array? Check the middle first.',
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 5,
      scene: {
        type: 'concept',
        title: `Sorted array · target ${target}`,
        subtitle: concept.plain_explanation || concept.summary,
        caption: 'Precondition: the array is sorted — halving only works because of that order.',
        visual: setup
      }
    },
    {
      weight: 27.5,
      scene: {
        type: 'trace',
        title: `Trace · target ${target}`,
        subtitle: 'low, high and mid · mid = floor((low + high) / 2)',
        caption: `Compare the midpoint, then keep the half that can still hold ${target}.`,
        visual: { ...setup, mode: 'trace', steps: run.steps }
      }
    },
    {
      weight: 7,
      scene: {
        type: 'complexity',
        title: lesson.key_takeaway,
        subtitle: concept.complexity_time,
        caption: `Space: ${concept.complexity_space} auxiliary for this iterative version.`,
        facts: [
          { label: 'Auxiliary space', value: concept.complexity_space || 'O(1)' },
          { label: 'Precondition', value: 'Input must be sorted' }
        ]
      }
    }
  ];

  return withBookends(specs, totalMs, branding, {
    opening: openingScene(branding, lesson, concept),
    ending: closingScene(branding)
  });
}


/**
 * The Arrays lesson body: hook, contiguous-memory setup, the verified traversal
 * and the access-versus-traversal complexity panel.
 */
function buildArrayScenes(
  lesson: LessonInput,
  concept: ConceptInput,
  run: ConceptRun,
  totalMs: number,
  branding: Branding
): Scene[] {
  const array = run.input;
  const setup: ArrayVisual = { kind: 'array', array, total: run.total, steps: [] };
  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 2.5,
      scene: {
        type: 'hook',
        title: lesson.hook || 'Reading a cell is one step. Summing them all is not.',
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 5,
      scene: {
        type: 'concept',
        title: `${array.length} contiguous cells`,
        subtitle: concept.plain_explanation || concept.summary,
        caption: 'Index i lives at base + i × slot — one address calculation, one read.',
        visual: setup
      }
    },
    {
      weight: 26,
      scene: {
        type: 'trace',
        title: `Trace · sum all ${array.length} cells`,
        subtitle: 'i walks left to right · sum += a[i]',
        caption: 'Add the cell under the pointer, then move the pointer by one.',
        visual: { ...setup, steps: run.arraySteps }
      }
    },
    {
      weight: 7,
      scene: {
        type: 'complexity',
        title: lesson.key_takeaway || 'O(1) access is the whole point of an array',
        subtitle: concept.complexity_time,
        caption: `Access by index is O(1); this traversal is O(${array.length}). Space: ${concept.complexity_space}.`,
        facts: [
          { label: 'Access by index', value: 'O(1) — no walking' },
          { label: 'Insert or delete in the middle', value: 'O(n) — later cells shift' },
          { label: 'This traversal', value: `O(n) — ${array.length} cells` }
        ]
      }
    }
  ];

  return withBookends(specs, totalMs, branding, {
    opening: openingScene(branding, lesson, concept),
    ending: closingScene(branding)
  });
}

/**
 * The Linked Lists lesson body: hook, node-and-pointer setup, the verified walk
 * and the lookup-cost panel.
 */
function buildLinkedScenes(
  lesson: LessonInput,
  concept: ConceptInput,
  run: ConceptRun,
  totalMs: number,
  branding: Branding
): Scene[] {
  const values = run.input;
  const target = run.target ?? 0;
  const setup: LinkedListVisual = {
    kind: 'linked-list',
    values,
    target,
    foundIndex: run.foundIndex,
    steps: []
  };
  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 2.5,
      scene: {
        type: 'hook',
        title: lesson.hook || 'No index, no shortcut: you walk the links.',
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 5,
      scene: {
        type: 'concept',
        title: `${values.length} nodes chained by next`,
        subtitle: concept.plain_explanation || concept.summary,
        caption: 'Each node stores a value and the address of the next node.',
        visual: setup
      }
    },
    {
      weight: 26,
      scene: {
        type: 'trace',
        title: `Trace · find ${target}`,
        subtitle: 'curr = head · then curr = curr.next',
        caption: `Compare each node with ${target}; stop at the match.`,
        visual: { ...setup, steps: run.linkedSteps }
      }
    },
    {
      weight: 7,
      scene: {
        type: 'complexity',
        title: lesson.key_takeaway || 'Cheap to relink, expensive to find',
        subtitle: concept.complexity_time,
        caption: `Search is O(n); insert or delete at a known node is O(1). Space: ${concept.complexity_space}.`,
        facts: [
          { label: 'Search', value: 'O(n) — from the head, link by link' },
          { label: 'Insert or delete at a known node', value: 'O(1) — relink two pointers' },
          { label: 'This walk', value: `${run.comparisons} of ${values.length} nodes` }
        ]
      }
    }
  ];

  return withBookends(specs, totalMs, branding, {
    opening: openingScene(branding, lesson, concept),
    ending: closingScene(branding)
  });
}

/**
 * Turns a lesson into the structured scene list the renderer draws. Every scene
 * carries its own duration, so the timeline is data, not code per video.
 */
export function buildScenes(
  lesson: LessonInput,
  conceptRow: ConceptInput,
  branding: Branding = brandingFrom(null)
): Scene[] {
  const concept = effectiveConcept(lesson, conceptRow);
  const totalMs = lessonDurationMs(lesson);
  const run = runConcept(concept);
  if (run.kind === 'binary-search' && run.supported) {
    return buildBinarySearchScenes(lesson, concept, totalMs, branding);
  }
  if (run.kind === 'array' && run.supported) {
    return buildArrayScenes(lesson, concept, run, totalMs, branding);
  }
  if (run.kind === 'linked-list' && run.supported) {
    return buildLinkedScenes(lesson, concept, run, totalMs, branding);
  }
  if (run.kind === 'structure' && run.supported && run.structure) {
    return buildStructureScenes(lesson, concept, run.structure, totalMs, branding);
  }
  return buildStackScenes(lesson, concept, run, totalMs, branding);
}

/** What each structure short says about itself before and after the trace. */
function structureLessonCopy(run: StructureRun): {
  hook: string;
  setupTitle: string;
  setupCaption: string;
  traceTitle: string;
  traceSubtitle: string;
  traceCaption: string;
  complexityTitle: string;
  complexityCaption: string;
} {
  if (run.kind === 'queue') {
    const trace = run.trace;
    const peak = trace.steps.reduce((max, step) => Math.max(max, step.items.length), 0);
    return {
      hook: 'First in line is the first one served.',
      setupTitle: 'First in, first out',
      setupCaption: 'ENQUEUE adds at the rear; DEQUEUE takes from the front — never the other way round.',
      traceTitle: `Trace · ${trace.steps.length} operations in FIFO order`,
      traceSubtitle: 'ENQUEUE at the rear · DEQUEUE at the front',
      traceCaption: 'The value that leaves is always the one that arrived first.',
      complexityTitle: 'Both ends are O(1)',
      complexityCaption: `Enqueue and dequeue each touch one end — O(1). Space: O(${peak}) for the queue.`
    };
  }

  if (run.kind === 'hash-table') {
    const trace = run.trace;
    const last = trace.steps[trace.steps.length - 1];
    return {
      hook: 'One calculation tells you exactly where the key lives.',
      setupTitle: 'One calculation, one bucket',
      setupCaption: `h(key) = key mod ${trace.size} turns any key into a bucket number — no searching for the shelf.`,
      traceTitle: `Trace · PUT ${trace.keys.join(', ')} · GET ${last?.key ?? 0}`,
      traceSubtitle: `h(key) = key mod ${trace.size} · collisions chain behind`,
      traceCaption: 'The hash picks the bucket; only a collision chain has to be walked.',
      complexityTitle: 'Expected O(1), worst case O(n)',
      complexityCaption: `${trace.probes} probes this run. A good hash keeps chains short; a bad one makes the table a list. Space: O(n).`
    };
  }

  if (run.kind === 'tree') {
    const trace = run.trace;
    const root = trace.order[0] ?? 0;
    return {
      hook: 'One root, many branches — and one sweep visits them all.',
      setupTitle: 'One parent per node',
      setupCaption: `Root ${root} has children, and each of those has its own. No node loops back — that is what makes it a tree.`,
      traceTitle: `Trace · breadth-first from the root ${root}`,
      traceSubtitle: 'visit · enqueue children · take the next from the front',
      traceCaption: 'The frontier is a queue: a whole level is finished before the next one starts.',
      complexityTitle: 'Every node exactly once',
      complexityCaption: `${trace.steps.length} nodes visited once each — O(n). Frontier memory is O(width of the widest level).`
    };
  }

  if (run.kind === 'bst') {
    const trace = run.trace;
    return {
      hook: 'Smaller goes left. Bigger goes right. One path finds the key.',
    setupTitle: 'Left is smaller, right is bigger',
    setupCaption: 'The ordering invariant is the whole data structure: it tells the search which way to go.',
    traceTitle: `Trace · insert ${trace.insert.join(', ')} · search ${trace.search}`,
    traceSubtitle: 'compare · turn left or right · repeat',
    traceCaption: 'Each comparison throws one whole side of the tree away.',
    complexityTitle: 'Cost is the height',
      complexityCaption: `${trace.comparisons} comparison${trace.comparisons === 1 ? '' : 's'} for ${trace.search}. Balanced height is log n; a sorted insert order degenerates to n.`
    };
  }

  if (run.kind === 'heap') {
    const trace = run.trace;
    return {
      hook: 'The smallest value is always the one at the top.',
      setupTitle: 'A complete tree, stored as an array',
      setupCaption: 'The children of index i are 2i+1 and 2i+2, so the parent of i is (i-1)/2 — the tree needs no pointers at all.',
      traceTitle: `Trace · PUSH ${trace.pushed.join(', ')}${trace.popped.length > 0 ? ` · ${trace.popped.length} POP` : ''}`,
      traceSubtitle: 'append at the end · sift up · move the last value to the root and sift down',
      traceCaption: 'Every PUSH and POP walks one root-to-leaf path, and that path is the log in O(log n).',
      complexityTitle: 'One path, log n',
      complexityCaption: `${trace.comparisons} comparisons this run. PEEK reads the root in O(1); PUSH and POP sift along one path. Space: O(n).`
    };
  }

  if (run.kind === 'graph') {
    const trace = run.trace;
    return {
      hook: 'Places and roads: the edges decide who you can reach next.',
      setupTitle: 'Vertices and the edges between them',
      setupCaption: `Each vertex keeps a list of its outgoing neighbours — ${trace.nodes.length} vertices and ${trace.edges.length} edges is all the structure stores.`,
      traceTitle: `Trace · breadth-first from ${trace.start}`,
      traceSubtitle: 'visit the vertex · discover its new neighbours at the back of the queue',
      traceCaption: 'The frontier is a queue, so every neighbour of a vertex is found before the walk goes one hop deeper.',
      complexityTitle: 'Every vertex and edge once',
      complexityCaption: `${trace.steps.length} vertices visited, each edge checked once — O(V + E). The adjacency list costs O(V + E) space.`
    };
  }

  if (run.kind === 'linear-search') {
    const trace = run.trace;
    return {
      hook: 'No order needed: just check every cell until the target shows up.',
      setupTitle: 'One pass, one comparison at a time',
      setupCaption: `The scan reads a[0], a[1], a[2] … and stops the moment a cell equals ${trace.target}.`,
      traceTitle: `Trace · target ${trace.target} in [${trace.array.join(', ')}]`,
      traceSubtitle: 'compare the cell · match? stop · otherwise move one cell right',
      traceCaption: 'The work is however far the target happens to be — up to every cell in the array.',
      complexityTitle: 'Linear in the worst case',
      complexityCaption: `${trace.comparisons} comparisons this run${trace.foundIndex === null ? ' and no match' : `, found at index ${trace.foundIndex}`}. Worst case O(n), space O(1).`
    };
  }

  if (run.kind === 'insertion-sort') {
    const trace = run.trace;
    return {
      hook: 'Grow a sorted prefix by inserting each next value.',
      setupTitle: 'A sorted prefix, one insert at a time',
      setupCaption: `a[0..${trace.passes}] is already sorted; the next value slides left past every larger value until it fits.`,
      traceTitle: `Trace · [${trace.array.join(', ')}] inserted into order`,
      traceSubtitle: 'hold the key · shift larger values right · drop the key in the gap',
      traceCaption: 'Nothing to the left of the gap has to move again — every pass leaves one more value settled.',
      complexityTitle: 'Quadratic worst case, linear when nearly sorted',
      complexityCaption: `${trace.comparisons} comparisons and ${trace.shifts} shifts this run. Worst case O(n²), best case O(n), O(1) extra space.`
    };
  }

  if (run.kind === 'merge-sort') {
    const trace = run.trace;
    return {
      hook: 'Divide, sort halves, merge them in linear time.',
      setupTitle: 'Split until single values, then merge',
      setupCaption: 'A one-value run is already sorted. Merging two sorted runs walks them once and writes the next smallest value each time.',
      traceTitle: `Trace · ${trace.merges} merges over ${trace.depth} level${trace.depth === 1 ? '' : 's'}`,
      traceSubtitle: 'split in half · sort each half · merge the sorted runs',
      traceCaption: 'Each level touches every value once, and there are log n levels — that is the n log n.',
      complexityTitle: 'Log n levels, linear merges',
      complexityCaption: `${trace.comparisons} comparisons this run. O(n log n) time, O(n) auxiliary space, and the merge keeps equal values in order.`
    };
  }

  if (run.kind === 'quick-sort') {
    const trace = run.trace;
    return {
      hook: 'Partition around a pivot, then sort each side.',
      setupTitle: 'One pass puts the pivot in place',
      setupCaption: 'Every value smaller than the pivot moves left of the boundary; the pivot then swaps into the boundary and never moves again.',
      traceTitle: `Trace · ${trace.partitions} partitions in [${trace.array.join(', ')}]`,
      traceSubtitle: 'pick the last value as pivot · move smaller values left · swap the pivot in',
      traceCaption: 'Once the pivot lands, the two sides are independent — that is what keeps the work balanced.',
      complexityTitle: 'Fast on average, quadratic with bad pivots',
      complexityCaption: `${trace.comparisons} comparisons and ${trace.swaps} swaps this run. Balanced pivots give O(n log n); an already sorted array with a naive pivot gives O(n²).`
    };
  }

  if (run.kind === 'graph-dfs') {
    const trace = run.trace;
    return {
      hook: 'Follow one branch as far as possible before backtracking.',
      setupTitle: 'A call stack instead of a queue',
      setupCaption: `From ${trace.start}, every neighbour that has not been seen is visited immediately — the walk only backs up when a vertex has nothing new left.`,
      traceTitle: `Trace · depth-first from ${trace.start}`,
      traceSubtitle: 'visit the vertex · descend into its first unseen neighbour · back up when stuck',
      traceCaption: 'The call stack is the frontier: the most recently reached vertex is always explored next.',
      complexityTitle: 'Every vertex and edge once',
      complexityCaption: `${trace.order.length} of ${trace.nodes.length} vertices visited, each edge checked once — O(V + E). The stack costs O(V) in the worst case.`
    };
  }

  if (run.kind === 'recursion') {
    const trace = run.trace;
    return {
      hook: 'Solve a problem by solving smaller copies of itself.',
      setupTitle: 'A base case and a smaller subproblem',
      setupCaption: `fact(${trace.n}) cannot answer until fact(${trace.n - 1}) does — so calls stack up until fact(1) returns 1, and then every caller multiplies on the way back.`,
      traceTitle: `Trace · fact(${trace.n}) in ${trace.calls} calls`,
      traceSubtitle: 'call with a smaller argument · hit the base case · return a value to the caller',
      traceCaption: 'The answer travels back up one return at a time; each waiting call multiplies its own value in.',
      complexityTitle: 'Depth is the space cost',
      complexityCaption: `${trace.deepest} frames deep at most. ${trace.calls} calls and ${trace.returns} returns — O(n) time and O(n) stack for fact(n).`
    };
  }

  if (run.kind === 'bubble-sort') {
    const bubble = run.trace;
    return {
      hook: 'Compare the neighbours and swap them — the biggest value bubbles to the end.',
      setupTitle: 'Neighbours out of order swap places',
      setupCaption: `Each pass walks the unsorted run comparing ${bubble.array.length - 1} neighbour pairs, and settles one more value at the end.`,
      traceTitle: `Trace · [${bubble.array.join(', ')}] sorted in ${bubble.passes} pass${bubble.passes === 1 ? '' : 'es'}`,
      traceSubtitle: 'compare a[i] with a[i+1] · swap when the left is bigger · shrink the run',
      traceCaption: 'The settled tail grows by one every pass, so each pass has one less pair to compare.',
      complexityTitle: 'Quadratic comparisons',
      complexityCaption: `${bubble.comparisons} comparisons and ${bubble.swaps} swaps this run. Worst case O(n²) comparisons, O(1) extra space.`
    };
  }

  if (run.kind === 'complexity') {
    const trace = run.trace;
    const largest = trace.sizes[trace.sizes.length - 1] ?? 0;
    const names = trace.series.map((item) => item.label).join(', ');
    return {
      hook: 'Growth is the shape of the curve, not the stopwatch on one run.',
      setupTitle: 'One axis is input size, the other is work done',
      setupCaption: 'Grow the input, run the real implementation, and plot the work it did.',
      traceTitle: `Measured · ${names} up to n = ${largest}`,
      traceSubtitle: 'grow n · count the operations · plot the result',
      traceCaption: 'Doubling the input doubles a linear curve, barely moves a logarithmic one and quadruples a quadratic one.',
      complexityTitle: 'Read the curve, not one sample',
      complexityCaption: `At n = ${largest} the slowest curve does ${Math.max(
        ...trace.series.map((item) => item.points[item.points.length - 1]?.ops ?? 0)
      )} and the cheapest ${Math.min(
        ...trace.series.map((item) => item.points[item.points.length - 1]?.ops ?? 0)
      )}. The class is what doubling n does.`
    };
  }

  const dp = run.trace;
  return {
    hook: 'Cache overlapping subproblems to avoid recomputation.',
    setupTitle: 'Solve each state once, left to right',
    setupCaption: 'fib(i) only needs fib(i−1) and fib(i−2). Filling a table from the base cases forward solves each state exactly once.',
    traceTitle: `Trace · ${dp.steps.length} table cells for fib(${dp.n})`,
    traceSubtitle: 'write the base cases · read the two earlier cells · store the sum',
    traceCaption: 'Naive recursion re-solves the same branches; the table turns that into one pass over the states.',
    complexityTitle: 'States × transition cost',
    complexityCaption: `${dp.table.length} cells, one addition each — O(${dp.n}) time and space here. Memory can drop to two values when only the previous states are needed.`
  };
}

/**
 * The structure lessons: hook, what the container is, one beat per verified step
 * and the cost panel. Queue, hash table, tree and BST share the beats; the copy
 * and the frames are the only differences.
 */
function buildStructureScenes(
  lesson: LessonInput,
  concept: ConceptInput,
  run: StructureRun,
  totalMs: number,
  branding: Branding
): Scene[] {
  const copy = structureLessonCopy(run);
  const chrome = structureChrome(run);
  const setup: StructureVisual = { kind: 'structure', structureKind: run.kind, steps: [] };

  const specs: { weight: number; scene: Omit<Scene, 'id' | 'durationMs'> }[] = [
    {
      weight: 2.5,
      scene: {
        type: 'hook',
        title: lesson.hook || copy.hook,
        subtitle: lesson.objective || concept.summary,
        caption: lesson.on_screen_text || ''
      }
    },
    {
      weight: 5,
      scene: {
        type: 'concept',
        title: copy.setupTitle,
        subtitle: concept.plain_explanation || concept.summary,
        caption: copy.setupCaption,
        visual: setup
      }
    },
    {
      weight: 26,
      scene: {
        type: 'trace',
        title: copy.traceTitle,
        subtitle: copy.traceSubtitle,
        caption: copy.traceCaption,
        visual: { ...setup, steps: run.trace.steps }
      }
    },
    {
      weight: 7,
      scene: {
        type: 'complexity',
        title: lesson.key_takeaway || copy.complexityTitle,
        subtitle: concept.complexity_time,
        caption: copy.complexityCaption,
        facts: chrome.facts
      }
    }
  ];

  return withBookends(specs, totalMs, branding, {
    opening: openingScene(branding, lesson, concept),
    ending: closingScene(branding)
  });
}

function hasExpectation(config: Record<string, unknown>): boolean {
  const expect = config.expect;
  if (!expect || typeof expect !== 'object') return false;
  const values = Object.values(expect as Record<string, unknown>);
  return values.some((value) => value !== null && value !== undefined);
}

function formatSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

/** How far the persisted scene total may drift from the lesson duration. */
export const TOTAL_TOLERANCE_MS = 100;

/**
 * A cheap fingerprint of a verified trace: the decision each comparison made and
 * the bounds it produced. Two storyboards with the same fingerprint animate the
 * same run, so a stale storyboard cannot pass readiness on step count alone.
 */
function traceSignature(steps: BinarySearchStep[]): string {
  return steps.map((step) => `${step.low}:${step.high}:${step.mid}:${step.comparison}:${step.nextLow}:${step.nextHigh}`).join('|');
}

/**
 * Stable fingerprint of a stored storyboard. A render job keeps this so its MP4
 * can be matched to the exact scenes that produced it, even after later edits.
 */
export function storyboardHash(scenes: Scene[]): string {
  const payload = JSON.stringify(
    scenes.map((scene) => ({
      id: scene.id,
      type: scene.type,
      durationMs: scene.durationMs,
      title: scene.title,
      subtitle: scene.subtitle,
      caption: scene.caption,
      code: scene.code ?? null,
      visual: scene.visual ?? null
    }))
  );
  return createHash('sha1').update(payload).digest('hex');
}

function storyboardIssues(
  lesson: LessonInput,
  concept: ConceptInput,
  run: ConceptRun,
  seconds: number,
  branding: Branding
): string[] {
  const issues: string[] = [];
  const stored = safeJson<Scene[]>(lesson.scenes || '[]', []);
  if (stored.length === 0) {
    return ['The lesson has no storyboard yet — build it from the verified trace.'];
  }

  // Reordering and duplicating scenes is allowed, so the check is that every
  // scene the plan needs is still present — not that the order is untouched.
  const required = Array.from(new Set(buildScenes(lesson, concept, branding).map((scene) => scene.type)));
  const missing = required.filter((type) => !stored.some((scene) => scene.type === type));
  if (missing.length > 0) {
    return [
      `The storyboard is missing its ${missing.join(', ')} scene${missing.length === 1 ? '' : 's'} — rebuild the storyboard.`
    ];
  }

  // The animation is continuous, but every verified operation still owns one
  // beat window: a beat per event, exactly, and one trace beat for binary search.
  const executionScenes = stored.filter((scene) => scene.type === 'execution');
  if (run.kind === 'stack' && executionScenes.length !== run.events.length) {
    issues.push(
      `The storyboard has ${executionScenes.length} operation beats but the verified trace has ${run.events.length} operations — rebuild the storyboard.`
    );
  }
  const traceScenes = stored.filter((scene) => scene.type === 'trace');
  if (
    (run.kind === 'binary-search' || run.kind === 'array' || run.kind === 'linked-list' || run.kind === 'structure') &&
    traceScenes.length !== 1
  ) {
    issues.push(
      `The storyboard needs exactly one trace beat but has ${traceScenes.length} — rebuild the storyboard.`
    );
  }

  stored.forEach((scene, index) => {
    const label = `Scene ${index + 1} (${scene.type})`;
    const duration = Number(scene.durationMs);
    if (!Number.isFinite(duration) || duration < 300) {
      issues.push(`${label} needs a duration of at least 0.3 seconds.`);
    }
    if (!String(scene.id || '').trim()) issues.push(`${label} is missing its id — rebuild the storyboard.`);

    if (scene.type === 'open' || scene.type === 'hook' || scene.type === 'summary' || scene.type === 'brand') {
      if (!String(scene.title || '').trim()) issues.push(`${label} needs its text before it can be rendered.`);
    }
    if (scene.type === 'concept' && !String(scene.subtitle || '').trim()) {
      issues.push(`${label} needs its explanation text.`);
    }
    if (scene.type === 'complexity' && !String(scene.subtitle || '').trim()) {
      issues.push(`${label} needs the time complexity.`);
    }
    if (scene.type === 'code' && (!scene.code || scene.code.lines.length === 0)) {
      issues.push(`${label} has no code lines.`);
    }
    if (scene.type === 'trace' || scene.type === 'execution') {
      if (!scene.visual) {
        issues.push(`${label} is missing its animation data — rebuild the storyboard.`);
      } else if (scene.visual.kind === 'binary-search' && run.kind === 'binary-search') {
        if (scene.visual.steps.length === 0) {
          issues.push(`${label} carries no verified trace steps.`);
        } else if (scene.visual.steps.length !== run.steps.length) {
          issues.push(
            `${label} carries ${scene.visual.steps.length} trace steps but the trusted run has ${run.steps.length} — rebuild the storyboard.`
          );
        } else if (traceSignature(scene.visual.steps) !== traceSignature(run.steps)) {
          issues.push(`${label} animates different comparisons than the verified trace — rebuild the storyboard.`);
        }
        if (!Array.isArray(scene.visual.array) || scene.visual.array.length === 0) {
          issues.push(`${label} is missing the array it should animate.`);
        } else if (scene.visual.array.join(',') !== run.input.join(',')) {
          issues.push(`${label} animates a different array than the concept configuration — rebuild the storyboard.`);
        }
        if (scene.visual.target !== run.target) {
          issues.push(`${label} animates target ${String(scene.visual.target)} but the concept searches for ${String(run.target)} — rebuild the storyboard.`);
        }
      } else if (scene.visual.kind === 'array' && run.kind === 'array') {
        if (!Array.isArray(scene.visual.array) || scene.visual.array.length === 0) {
          issues.push(`${label} is missing the array it should animate.`);
        } else if (scene.visual.array.join(',') !== run.input.join(',')) {
          issues.push(`${label} animates a different array than the concept configuration — rebuild the storyboard.`);
        }
        if (scene.visual.steps.length > 0) {
          if (scene.visual.steps.length !== run.eventCount) {
            issues.push(
              `${label} carries ${scene.visual.steps.length} visits but the trusted run has ${run.eventCount} — rebuild the storyboard.`
            );
          } else if (scene.visual.total !== run.total) {
            issues.push(`${label} totals ${scene.visual.total} but the array sums to ${run.total} — rebuild the storyboard.`);
          }
        }
      } else if (scene.visual.kind === 'linked-list' && run.kind === 'linked-list') {
        if (!Array.isArray(scene.visual.values) || scene.visual.values.length === 0) {
          issues.push(`${label} is missing the list it should animate.`);
        } else if (scene.visual.values.join(',') !== run.input.join(',')) {
          issues.push(`${label} animates a different list than the concept configuration — rebuild the storyboard.`);
        }
        if (scene.visual.target !== run.target) {
          issues.push(`${label} searches for ${String(scene.visual.target)} but the concept looks for ${String(run.target)} — rebuild the storyboard.`);
        }
        if (scene.visual.steps.length > 0) {
          if (scene.visual.steps.length !== run.eventCount) {
            issues.push(
              `${label} carries ${scene.visual.steps.length} visits but the trusted walk has ${run.eventCount} — rebuild the storyboard.`
            );
          } else if (scene.visual.foundIndex !== run.foundIndex) {
            issues.push(`${label} reports ${String(scene.visual.foundIndex)} as the match but the trace found ${String(run.foundIndex)} — rebuild the storyboard.`);
          }
        }
      } else if (scene.visual.kind === 'structure' && run.kind === 'structure' && run.structure) {
        if (scene.visual.structureKind !== run.structure.kind) {
          issues.push(`${label} animates a ${scene.visual.structureKind} where the concept defines a ${run.structure.kind} — rebuild the storyboard.`);
        }
        if (scene.visual.steps.length > 0) {
          if (scene.visual.steps.length !== run.eventCount) {
            issues.push(
              `${label} carries ${scene.visual.steps.length} steps but the trusted run has ${run.eventCount} — rebuild the storyboard.`
            );
          } else {
            const shown = scene.visual.steps.map((step) => step.hudLabel).join('|');
            const verified = run.structure.trace.steps.map((step) => step.hudLabel).join('|');
            if (shown !== verified) {
              issues.push(`${label} animates different steps than the verified trace — rebuild the storyboard.`);
            }
          }
        }
      } else if (scene.visual.kind === 'stack' && run.kind === 'stack') {
        if (!Array.isArray(scene.visual.items)) issues.push(`${label} is missing its stack snapshot.`);
      }
    }
  });

  const total = stored.reduce((sum, scene) => sum + (Number(scene.durationMs) || 0), 0);
  const target = Math.round(seconds * 1000);
  if (total > 0 && Math.abs(total - target) > TOTAL_TOLERANCE_MS) {
    issues.push(
      `The scene timings add up to ${formatSeconds(total)}s but the lesson duration is ${formatSeconds(target)}s — adjust the scene timings.`
    );
  }

  const hookScene = stored.find((scene) => scene.type === 'hook');
  if (hookScene && lesson.hook.trim() && hookScene.title.trim() !== lesson.hook.trim()) {
    issues.push('The storyboard hook no longer matches the lesson hook — rebuild the storyboard.');
  }

  return issues;
}

const KIND_LABEL: Record<ConceptRun['kind'], string> = {
  stack: 'stack',
  'binary-search': 'binary search',
  array: 'array traversal',
  'linked-list': 'linked list',
  structure: 'structure',
  none: 'untraced'
};

/** Everything that has to be true before a lesson may be rendered. */
export function lessonIssues(
  lesson: LessonInput,
  concept: ConceptInput,
  branding: Branding = brandingFrom(null)
): string[] {
  const issues: string[] = [];

  if (lesson.concept_id && concept.id && lesson.concept_id !== concept.id) {
    issues.push('The lesson points at a different concept than the one loaded — recreate the lesson from its concept.');
  }
  if (!String(lesson.hook || '').trim()) issues.push('The lesson needs a hook: the first line on screen.');
  if (!String(lesson.objective || '').trim()) issues.push('The lesson needs a learning objective.');
  if (!String(lesson.key_takeaway || '').trim()) issues.push('The lesson needs a key takeaway.');
  if (!concept.reference_code.trim() && !concept.pseudocode.trim()) {
    issues.push('The concept needs pseudocode or a reference implementation.');
  }

  const seconds = Number(lesson.duration_seconds);
  const durationValid = Number.isFinite(seconds) && seconds >= 10 && seconds <= 60;
  if (!durationValid) issues.push('The lesson duration must be between 10 and 60 seconds.');

  const effective = effectiveConcept(lesson, concept);
  const config = readAnimationConfig(effective);
  const run = runConcept(effective);
  if (!run.supported) {
    issues.push('This concept has no animation configuration yet, so no trace can be verified.');
    return Array.from(new Set(issues));
  }

  issues.push(...run.errors);
  if (run.validation.failures.length > 0) issues.push(...run.validation.failures);
  else if (!run.validation.ok) {
    issues.push('The trace could not be verified against the trusted implementation, so the lesson cannot render.');
  }
  if (!hasExpectation(config)) {
    issues.push(
      `The ${KIND_LABEL[run.kind]} animation configuration has no expected result to verify against.`
    );
  }

  if (durationValid) {
    // A video too short for the bookends and a readable lesson is reported, never
    // silently compressed: the opening, lesson and closing all have to fit.
    const neededMs = minimumDurationMs(branding, run);
    if (Math.round(seconds * 1000) < neededMs) {
      issues.push(
        `At ${formatSeconds(seconds * 1000)} there is no room for the ${formatSeconds(branding.openingMs)} opening, ` +
          `a readable lesson and the ${formatSeconds(branding.endingMs)} closing — raise the duration to at least ` +
          `${Math.ceil(neededMs / 1000)} seconds.`
      );
    }
    issues.push(...storyboardIssues(lesson, effective, run, seconds, branding));
  }

  return Array.from(new Set(issues));
}

export { DEFAULT_STACK_OPS };
