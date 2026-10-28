import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { buildScenes, runConcept, type ConceptInput, type LessonInput } from './scenes.ts';

const DATA_DIR = process.env.DATA_DIR || '/tmp/visual-cs-lab';
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'lab.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

db.exec(`
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  objectives TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  plain_explanation TEXT NOT NULL DEFAULT '',
  technical_explanation TEXT NOT NULL DEFAULT '',
  pseudocode TEXT NOT NULL DEFAULT '',
  reference_language TEXT NOT NULL DEFAULT '',
  reference_code TEXT NOT NULL DEFAULT '',
  complexity_time TEXT NOT NULL DEFAULT '',
  complexity_space TEXT NOT NULL DEFAULT '',
  example_input TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  animation_config TEXT NOT NULL DEFAULT '{}',
  related TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 45,
  hook TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  on_screen_text TEXT NOT NULL DEFAULT '',
  key_takeaway TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'draft',
  scenes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  accent TEXT NOT NULL,
  background TEXT NOT NULL,
  panel TEXT NOT NULL,
  ink TEXT NOT NULL,
  font_family TEXT NOT NULL,
  watermark TEXT NOT NULL,
  caption_style TEXT NOT NULL DEFAULT '{}',
  code_style TEXT NOT NULL DEFAULT '{}',
  default_duration INTEGER NOT NULL DEFAULT 20,
  default_resolution TEXT NOT NULL DEFAULT '1080x1920',
  intro TEXT NOT NULL DEFAULT '',
  outro TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  preset TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '',
  error TEXT,
  output_path TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  frames INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS voiceovers (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  duration_seconds REAL NOT NULL DEFAULT 0,
  segments TEXT NOT NULL DEFAULT '[]',
  script TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'drafted',
  scheduled_at TEXT,
  published_url TEXT,
  external_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (lesson_id, platform)
);
`);

const now = nowIso();

/**
 * Additive migrations for databases created by an earlier build. Columns are
 * only added, never dropped, so existing lessons and render history survive.
 */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('render_jobs', 'expected_frames', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('render_jobs', 'expected_seconds', 'REAL NOT NULL DEFAULT 0');
ensureColumn('render_jobs', 'storyboard_hash', "TEXT NOT NULL DEFAULT ''");
ensureColumn('render_jobs', 'snapshot', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('render_jobs', 'validation', 'TEXT');
/** Per-lesson animation input chosen on the Create screen. */
ensureColumn('lessons', 'animation_input', "TEXT NOT NULL DEFAULT ''");
ensureColumn('voiceovers', 'duration_seconds', 'REAL NOT NULL DEFAULT 0');

const brandRow = db.prepare('SELECT id FROM brand WHERE id = 1').get();
if (!brandRow) {
  db.prepare(
    `INSERT INTO brand (id, name, accent, background, panel, ink, font_family, watermark,
       caption_style, code_style, default_duration, default_resolution, intro, outro, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'Visual CS Lab',
    '#22d3ee',
    '#0b1220',
    '#111c33',
    '#e6edf7',
    'Inter, system-ui, sans-serif',
    'Visual CS Lab',
    JSON.stringify({ size: 46, contrast: 'high', background: 'rgba(3,8,18,.72)' }),
    JSON.stringify({ font: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 34 }),
    45,
    '1080x1920',
    '',
    '',
    now
  );
}

type SeedConcept = {
  slug: string;
  name: string;
  category: string;
  summary: string;
  objectives: string;
  prerequisites: string;
  plain: string;
  technical: string;
  pseudocode: string;
  language?: string;
  code?: string;
  time: string;
  space: string;
  exampleInput: string;
  expectedOutput: string;
  animation?: unknown;
  related: string[];
};

/**
 * The verified stack short: three pushes, a peek, two pops and a final push.
 * Expected states are checked against the trusted implementation before any
 * frame is drawn.
 */
const STACK_OPS = [
  { op: 'push', value: 10 },
  { op: 'push', value: 20 },
  { op: 'push', value: 30 },
  { op: 'top' },
  { op: 'pop' },
  { op: 'pop' },
  { op: 'push', value: 40 }
];

const STACK_EXPECT = { finalStack: [10, 40], top: 40, popReturns: 30 };

/**
 * Trusted animation configuration for Binary Search. Inclusive bounds, mid
 * calculated as floor((low + high) / 2); `expect` is what the trace is verified
 * against before any lesson can render.
 */
const BINARY_SEARCH_ANIMATION = {
  kind: 'binary-search',
  array: [1, 3, 5, 7, 9],
  target: 7,
  expect: { foundIndex: 3, steps: 2 }
};

/** The lesson this configuration is demonstrated with. */
const BINARY_SEARCH_LESSON = {
  title: 'Binary Search in 45 Seconds',
  audience: 'Beginner software engineering students',
  objective:
    'Understand how iterative binary search halves a sorted search interval and updates its bounds.',
  hook: 'Searching a sorted array? Check the middle first.',
  narration:
    'Binary search works on sorted arrays. Check the middle element. If it is too small, discard the left portion. If it is too large, discard the right portion. Repeat until the target is found or the range is empty. Each comparison halves the remaining range.',
  on_screen_text: 'Sorted array. Check the middle. Eliminate half. Repeat.',
  key_takeaway: 'Binary search requires sorted input and runs in O(log n) time.',
  cta: "Understand the algorithm. Don't just memorize it.",
  sources:
    'Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms (3rd ed.), Problem 2.3-5; Sedgewick & Wayne, Algorithms (4th ed.), §1.1 BinarySearch. Sorted input is a precondition.'
};

const SEED: SeedConcept[] = [
  {
    slug: 'stacks',
    name: 'Stacks',
    category: 'Data Structures',
    summary: 'A LIFO container: the last value pushed is the first value popped.',
    objectives: 'Explain LIFO, trace push/pop by hand, and reason about the TOP pointer.',
    prerequisites: 'Arrays',
    plain:
      'A stack is a pile where you can only touch the top. You add to the top (push) and remove from the top (pop), so the newest item always leaves first.',
    technical:
      'A stack is an abstract data type with push, pop, peek and isEmpty. An array-backed implementation keeps the top at index length-1, so every operation is O(1) amortised. The invariant is that only the last inserted element is reachable.',
    pseudocode:
      'PUSH(s, x):\n  s.items[s.top] = x\n  s.top = s.top + 1\n\nPOP(s):\n  if s.top == 0: return EMPTY\n  s.top = s.top - 1\n  return s.items[s.top]',
    language: 'typescript',
    code:
      'class Stack<T> {\n  private items: T[] = [];\n\n  push(value: T): void {\n    this.items.push(value);\n  }\n\n  pop(): T | undefined {\n    return this.items.pop();\n  }\n\n  peek(): T | undefined {\n    return this.items[this.items.length - 1];\n  }\n\n  get size(): number {\n    return this.items.length;\n  }\n}',
    time: 'O(1) push, pop and peek',
    space: 'O(n) for n stored elements',
    exampleInput: 'PUSH(10), PUSH(20), PUSH(30), PEEK(), POP(), POP(), PUSH(40)',
    expectedOutput: 'PEEK returns 30; POP returns 30 then 20; the final PUSH leaves [10, 40].',
    animation: {
      ops: STACK_OPS,
      expect: STACK_EXPECT
    },
    related: ['arrays', 'queues', 'recursion']
  },
  {
    slug: 'arrays',
    name: 'Arrays',
    category: 'Data Structures',
    summary: 'Contiguous cells addressed by index, with O(1) random access.',
    objectives: 'Read and reason about index arithmetic and O(1) access versus O(n) insertion.',
    prerequisites: '',
    plain:
      'An array is a row of numbered boxes. Reading box 5 is instant because the computer jumps straight to it.',
    technical:
      'Elements sit in contiguous memory, so index i is base + i * elementSize. Access and update are O(1); inserting or deleting in the middle shifts elements and is O(n).',
    pseudocode: 'READ(a, i): return a[i]\nINSERT(a, i, x): shift a[i..] right, a[i] = x',
    time: 'O(1) access, O(n) insert/delete',
    space: 'O(n)',
    exampleInput: '[4, 8, 15, 16, 23], read index 2',
    expectedOutput: '15',
    related: ['linked-lists', 'stacks']
  },
  {
    slug: 'linked-lists',
    name: 'Linked Lists',
    category: 'Data Structures',
    summary: 'Nodes chained by pointers, cheap to insert and delete at a known node.',
    objectives: 'Contrast pointer traversal with array indexing and identify the O(n) lookup cost.',
    prerequisites: 'Arrays',
    plain:
      'A linked list is a treasure hunt: each note holds a value and the address of the next note. You must walk the trail to reach the middle.',
    technical:
      'Each node stores a value and a next reference (and prev for doubly linked). Insertion or removal given a node reference is O(1); search is O(n) and memory is non-contiguous.',
    pseudocode: 'WALK(head):\n  node = head\n  while node != null:\n    visit(node)\n    node = node.next',
    time: 'O(1) insert/delete at a node, O(n) search',
    space: 'O(n)',
    exampleInput: '1 -> 2 -> 3, insert 4 after 3',
    expectedOutput: '1 -> 2 -> 3 -> 4',
    related: ['arrays', 'stacks', 'queues']
  },
  {
    slug: 'queues',
    name: 'Queues',
    category: 'Data Structures',
    summary: 'A FIFO container: first in, first out.',
    objectives: 'Distinguish FIFO from LIFO and describe enqueue/dequeue costs.',
    prerequisites: 'Arrays',
    plain: 'A queue is a line at a counter — the person who arrived first is served first.',
    technical:
      'enqueue adds at the tail and dequeue removes at the head. A ring buffer or linked list keeps both operations O(1).',
    pseudocode: 'ENQUEUE(q, x): q.tail = x\nDEQUEUE(q): return q.head',
    time: 'O(1) enqueue and dequeue',
    space: 'O(n)',
    exampleInput: 'ENQUEUE(1), ENQUEUE(2), DEQUEUE()',
    expectedOutput: '1 (queue now holds 2)',
    related: ['stacks', 'breadth-first-search']
  },
  {
    slug: 'hash-tables',
    name: 'Hash Tables',
    category: 'Data Structures',
    summary: 'Key to bucket mapping that gives expected O(1) lookup.',
    objectives: 'Explain hashing, collisions and why worst case degrades to O(n).',
    prerequisites: 'Arrays',
    plain:
      'A hash table is a wall of labelled pigeonholes. A function turns the key into a hole number so you rarely search at all.',
    technical:
      'A hash function maps keys to bucket indices; collisions resolve by chaining or open addressing. Expected O(1) operations assume a good hash and bounded load factor.',
    pseudocode: 'PUT(k, v):\n  i = hash(k) % buckets\n  bucket[i].append((k, v))',
    time: 'O(1) expected, O(n) worst case',
    space: 'O(n)',
    exampleInput: 'Put "ada" -> 36, get "ada"',
    expectedOutput: '36',
    related: ['arrays', 'graphs']
  },
  {
    slug: 'trees',
    name: 'Trees',
    category: 'Data Structures',
    summary: 'Hierarchical nodes with one parent each and no cycles.',
    objectives: 'Define root, leaf, height and depth, and traverse a tree.',
    prerequisites: 'Linked Lists',
    plain: 'A tree is a family tree: every node has one parent and any number of children.',
    technical:
      'A tree is a connected acyclic graph with a designated root. Height bounds recursion depth and traversal cost, which makes balance the central concern.',
    pseudocode: 'DFS(node):\n  if node == null: return\n  visit(node)\n  for child in node.children: DFS(child)',
    time: 'O(n) traversal',
    space: 'O(h) recursion depth',
    exampleInput: 'root(1) with children 2 and 3',
    expectedOutput: '1, 2, 3 in pre-order',
    related: ['binary-search-trees', 'graphs']
  },
  {
    slug: 'binary-search-trees',
    name: 'Binary Search Trees',
    category: 'Data Structures',
    summary: 'Ordered binary tree where left < node < right.',
    objectives: 'Use the ordering invariant to justify O(log n) search on balanced trees.',
    prerequisites: 'Trees',
    plain:
      'A BST keeps smaller values on the left and bigger on the right, so each comparison throws half the tree away.',
    technical:
      'Insert and search follow the ordering invariant. Cost is O(h): O(log n) balanced, O(n) when the tree degenerates into a list.',
    pseudocode: 'SEARCH(node, k):\n  if node == null or node.key == k: return node\n  if k < node.key: return SEARCH(node.left, k)\n  return SEARCH(node.right, k)',
    time: 'O(log n) balanced, O(n) worst case',
    space: 'O(h)',
    exampleInput: 'Insert 8, 3, 10, 1; search 10',
    expectedOutput: 'Found 10 at depth 1',
    related: ['trees', 'binary-search']
  },
  {
    slug: 'heaps',
    name: 'Heaps',
    category: 'Data Structures',
    summary: 'Complete binary tree keeping the min or max at the root.',
    objectives: 'Explain sift-up/sift-down and the O(log n) push and pop.',
    prerequisites: 'Trees',
    plain: 'A heap always keeps the smallest (or largest) item at the very top, ready to hand you.',
    technical:
      'A binary heap stores a complete tree in an array: children of i are 2i+1 and 2i+2. Push and pop restore the heap property in O(log n); peek is O(1).',
    pseudocode: 'PUSH(h, x): append x; sift_up(last)\nPOP(h): swap root and last; remove last; sift_down(root)',
    time: 'O(log n) push/pop, O(1) peek',
    space: 'O(n)',
    exampleInput: 'Push 5, 3, 8 into a min-heap',
    expectedOutput: 'Root is 3',
    related: ['trees', 'graphs']
  },
  {
    slug: 'graphs',
    name: 'Graphs',
    category: 'Data Structures',
    summary: 'Vertices joined by edges, representing arbitrary relationships.',
    objectives: 'Represent graphs by adjacency list or matrix and choose the right one.',
    prerequisites: 'Trees',
    plain: 'A graph is a map of places and roads. The structure stores who connects to whom.',
    technical:
      'Graphs are directed or undirected, weighted or not. Adjacency lists use O(V+E) space and suit sparse graphs; adjacency matrices give O(1) edge tests at O(V²) space.',
    pseudocode: 'ADD_EDGE(g, u, v): g.adj[u].append(v); g.adj[v].append(u)',
    time: 'O(1) edge add, O(V+E) traversal',
    space: 'O(V+E) adjacency list',
    exampleInput: 'Edges (A-B), (B-C)',
    expectedOutput: 'A -> B -> C',
    related: ['trees', 'breadth-first-search', 'depth-first-search']
  },
  {
    slug: 'linear-search',
    name: 'Linear Search',
    category: 'Algorithms',
    summary: 'Scan every element until the target appears.',
    objectives: 'Prove the O(n) worst case and state when it beats sorting first.',
    prerequisites: 'Arrays',
    plain: 'Check each item in turn until you find the one you want.',
    technical:
      'Linear search needs no ordering, does n comparisons in the worst case and works on streams. Sorting first costs O(n log n), so linear search wins on single lookups.',
    pseudocode: 'for i in 0..n-1:\n  if a[i] == target: return i\nreturn -1',
    time: 'O(n)',
    space: 'O(1)',
    exampleInput: '[7, 4, 9], target 9',
    expectedOutput: 'Index 2',
    related: ['binary-search', 'arrays']
  },
  {
    slug: 'binary-search',
    name: 'Binary Search',
    category: 'Algorithms',
    summary: 'Halve a sorted range until the target is found.',
    objectives: 'Trace low/high/mid pointers and justify O(log n).',
    prerequisites: 'Arrays',
    plain: 'Open the middle of a sorted list, then keep only the half that can still contain the answer.',
    technical:
      'Binary search maintains a candidate range [low, high] and discards half after each comparison, giving O(log n) time and O(1) space iteratively. It requires sorted input.',
    pseudocode: 'while low <= high:\n  mid = (low + high) // 2\n  if a[mid] == target: return mid\n  if a[mid] < target: low = mid + 1\n  else: high = mid - 1\nreturn -1',
    time: 'O(log n)',
    space: 'O(1)',
    exampleInput: '[1, 3, 5, 7, 9], target 7',
    expectedOutput: 'Index 3',
    animation: BINARY_SEARCH_ANIMATION,
    related: ['linear-search', 'binary-search-trees']
  },
  {
    slug: 'bubble-sort',
    name: 'Bubble Sort',
    category: 'Algorithms',
    summary: 'Repeatedly swap adjacent out-of-order pairs.',
    objectives: 'Trace passes, count comparisons and explain the O(n²) bound.',
    prerequisites: 'Arrays',
    plain: 'Neighbours compare and swap until nothing is out of order — big values bubble to the end.',
    technical:
      'Each pass moves the largest remaining element into place. With early exit on a sorted pass the best case is O(n); average and worst are O(n²). It is stable and in place.',
    pseudocode: 'for pass in 0..n-1:\n  swapped = false\n  for i in 0..n-pass-2:\n    if a[i] > a[i+1]: swap(a[i], a[i+1]); swapped = true\n  if not swapped: break',
    time: 'O(n²) average and worst, O(n) best',
    space: 'O(1)',
    exampleInput: '[5, 1, 4, 2]',
    expectedOutput: '[1, 2, 4, 5]',
    related: ['insertion-sort', 'merge-sort']
  },
  {
    slug: 'insertion-sort',
    name: 'Insertion Sort',
    category: 'Algorithms',
    summary: 'Grow a sorted prefix by inserting each next value.',
    objectives: 'Explain why it is fast on nearly sorted input.',
    prerequisites: 'Arrays',
    plain: 'Like sorting cards in your hand: take the next card and slide it into the right place.',
    technical:
      'The prefix a[0..i-1] stays sorted; each new element shifts left until it fits. O(n²) worst case, O(n) on nearly sorted data, stable and in place, and usually faster than bubble sort in practice.',
    pseudocode: 'for i in 1..n-1:\n  key = a[i]; j = i - 1\n  while j >= 0 and a[j] > key: a[j+1] = a[j]; j -= 1\n  a[j+1] = key',
    time: 'O(n²) worst, O(n) best',
    space: 'O(1)',
    exampleInput: '[3, 1, 2]',
    expectedOutput: '[1, 2, 3]',
    related: ['bubble-sort', 'merge-sort']
  },
  {
    slug: 'merge-sort',
    name: 'Merge Sort',
    category: 'Algorithms',
    summary: 'Divide, sort halves, merge them in linear time.',
    objectives: 'Trace the recursion tree and account for the O(n) merge.',
    prerequisites: 'Recursion',
    plain: 'Split the list in half until pieces have one item, then merge pairs back in order.',
    technical:
      'Merge sort recurses to single elements then merges sorted runs in O(n) each, across O(log n) levels: O(n log n) time, O(n) auxiliary space, stable.',
    pseudocode: 'SORT(a):\n  if len(a) <= 1: return a\n  mid = len(a) // 2\n  return MERGE(SORT(a[:mid]), SORT(a[mid:]))',
    time: 'O(n log n)',
    space: 'O(n)',
    exampleInput: '[8, 3, 5, 1]',
    expectedOutput: '[1, 3, 5, 8]',
    related: ['quick-sort', 'recursion']
  },
  {
    slug: 'quick-sort',
    name: 'Quick Sort',
    category: 'Algorithms',
    summary: 'Partition around a pivot, then sort each side.',
    objectives: 'Explain partitioning and the O(n²) worst case from bad pivots.',
    prerequisites: 'Recursion',
    plain: 'Pick a pivot, push smaller values left and larger values right, then repeat on each side.',
    technical:
      'In-place partitioning costs O(n) per level. Balanced pivots give O(n log n); already sorted input with a naive pivot gives O(n²). Randomising the pivot keeps the expected case fast.',
    pseudocode: 'SORT(a, lo, hi):\n  if lo >= hi: return\n  p = partition(a, lo, hi)\n  SORT(a, lo, p-1); SORT(a, p+1, hi)',
    time: 'O(n log n) average, O(n²) worst',
    space: 'O(log n) stack',
    exampleInput: '[4, 2, 7, 1], pivot 4',
    expectedOutput: '[1, 2] 4 [7]',
    related: ['merge-sort']
  },
  {
    slug: 'breadth-first-search',
    name: 'Breadth-First Search',
    category: 'Algorithms',
    summary: 'Explore a graph level by level using a queue.',
    objectives: 'Trace the frontier queue and prove shortest paths in unweighted graphs.',
    prerequisites: 'Queues',
    plain: 'Visit everything one step away, then two steps away, like ripples in water.',
    technical:
      'BFS marks nodes on enqueue to avoid duplicates and processes them FIFO, so the first time a node is reached is via a shortest unweighted path. O(V+E) time.',
    pseudocode: 'queue = [start]; seen = {start}\nwhile queue:\n  node = queue.pop_front()\n  for nb in graph[node]:\n    if nb not in seen: seen.add(nb); queue.push_back(nb)',
    time: 'O(V + E)',
    space: 'O(V)',
    exampleInput: 'A-B, A-C, B-D; start A',
    expectedOutput: 'A, B, C, D',
    related: ['depth-first-search', 'queues', 'graphs']
  },
  {
    slug: 'depth-first-search',
    name: 'Depth-First Search',
    category: 'Algorithms',
    summary: 'Follow one branch as far as possible before backtracking.',
    objectives: 'Trace recursion and the O(V+E) bound.',
    prerequisites: 'Recursion',
    plain: 'Go down one path until it dead-ends, then back up and try the next path.',
    technical:
      'DFS explores depth-first using a stack or recursion, marking visited nodes. It finds components and cycles but not shortest paths. O(V+E) time.',
    pseudocode: 'VISIT(node):\n  seen.add(node)\n  for nb in graph[node]:\n    if nb not in seen: VISIT(nb)',
    time: 'O(V + E)',
    space: 'O(V)',
    exampleInput: 'A-B, A-C, B-D; start A',
    expectedOutput: 'A, B, D, C',
    related: ['breadth-first-search', 'recursion']
  },
  {
    slug: 'recursion',
    name: 'Recursion',
    category: 'Algorithms',
    summary: 'Solve a problem by solving smaller copies of itself.',
    objectives: 'Identify base cases, progress and stack depth.',
    prerequisites: '',
    plain: 'A recursive function answers a small piece and asks itself about the rest until the task is trivial.',
    technical:
      'A recursion needs a base case and a strictly smaller subproblem. Each call consumes stack space, so depth drives space complexity; missing base cases overflow the stack.',
    pseudocode: 'FACTORIAL(n):\n  if n <= 1: return 1\n  return n * FACTORIAL(n - 1)',
    time: 'Depends on the recurrence',
    space: 'O(depth) call stack',
    exampleInput: 'factorial(4)',
    expectedOutput: '24',
    related: ['stacks', 'merge-sort', 'dynamic-programming']
  },
  {
    slug: 'dynamic-programming',
    name: 'Dynamic Programming',
    category: 'Algorithms',
    summary: 'Cache overlapping subproblems to avoid recomputation.',
    objectives: 'Choose between memoisation and tabulation and derive the state.',
    prerequisites: 'Recursion',
    plain: 'If solving the same small problem twice, write the answer down and reuse it.',
    technical:
      'DP applies when a problem has optimal substructure and overlapping subproblems. Memoised recursion or bottom-up tabulation turns exponential branching into the number of distinct states times transition cost.',
    pseudocode: 'fib = [0, 1]\nfor i in 2..n: fib[i] = fib[i-1] + fib[i-2]\nreturn fib[n]',
    time: 'States × transition cost (fib: O(n))',
    space: 'O(states)',
    exampleInput: 'fib(6)',
    expectedOutput: '8',
    related: ['recursion', 'merge-sort']
  },
  {
    slug: 'big-o-notation',
    name: 'Big-O Notation',
    category: 'Complexity Analysis',
    summary: 'Upper-bound growth of cost as input size grows.',
    objectives: 'Read and compare common growth classes.',
    prerequisites: '',
    plain: 'Big-O ignores constants and small inputs and asks: how does the work grow when the input doubles?',
    technical:
      'O(f(n)) bounds cost above asymptotically: there exist c and n₀ with cost ≤ c·f(n) beyond n₀. Constants and lower-order terms are dropped, so 3n² + 5n is O(n²).',
    pseudocode: 'O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ)',
    time: 'Describes time growth',
    space: 'Also describes memory growth',
    exampleInput: 'Two nested loops over n elements',
    expectedOutput: 'O(n²)',
    related: ['time-complexity', 'space-complexity']
  },
  {
    slug: 'time-complexity',
    name: 'Time Complexity',
    category: 'Complexity Analysis',
    summary: 'How the number of elementary operations grows with input.',
    objectives: 'Count operations in loops and recursion.',
    prerequisites: 'Big-O Notation',
    plain: 'Count how many steps the code runs as the input gets bigger.',
    technical:
      'Count dominant operations per iteration and multiply by iteration count. Sequential blocks add, nested blocks multiply, and recursion follows its recurrence.',
    pseudocode: 'for i in 0..n-1: for j in 0..n-1: work()  // O(n²)',
    time: 'The quantity being described',
    space: '—',
    exampleInput: 'A single pass over n items',
    expectedOutput: 'O(n)',
    related: ['big-o-notation', 'space-complexity']
  },
  {
    slug: 'space-complexity',
    name: 'Space Complexity',
    category: 'Complexity Analysis',
    summary: 'Extra memory used beyond the input.',
    objectives: 'Separate in-place algorithms from those needing auxiliary storage.',
    prerequisites: 'Big-O Notation',
    plain: 'How much extra memory does the algorithm need while it runs?',
    technical:
      'Space complexity counts auxiliary memory: variables, recursion frames and temporary structures. In-place algorithms use O(1) or O(log n) extra space; merges need O(n).',
    pseudocode: 'merge sort: O(n) auxiliary\nquick sort: O(log n) stack',
    time: '—',
    space: 'The quantity being described',
    exampleInput: 'Bubble sort on an array',
    expectedOutput: 'O(1) auxiliary space',
    related: ['big-o-notation', 'time-complexity']
  },
  {
    slug: 'best-average-worst-case',
    name: 'Best, Average and Worst Cases',
    category: 'Complexity Analysis',
    summary: 'The same algorithm can have three different growth curves.',
    objectives: 'Give an input that triggers each case for a known algorithm.',
    prerequisites: 'Time Complexity',
    plain: 'The fastest, typical and slowest run of the same code, depending on the data you feed it.',
    technical:
      'Cases describe inputs, not random variation: insertion sort is O(n) on sorted input, O(n²) reversed. Average case requires an input distribution, so it is a claim about expected inputs.',
    pseudocode: 'insertion sort: best O(n), average O(n²), worst O(n²)',
    time: 'Varies by input',
    space: 'Usually invariant',
    exampleInput: 'Insertion sort on an already sorted array',
    expectedOutput: 'Best case O(n)',
    related: ['time-complexity', 'insertion-sort']
  }
];

const count = db.prepare('SELECT COUNT(*) AS n FROM concepts').get() as { n: number };
if (count.n === 0) {
  const insert = db.prepare(
    `INSERT INTO concepts (id, slug, name, category, summary, objectives, prerequisites,
       plain_explanation, technical_explanation, pseudocode, reference_language, reference_code,
       complexity_time, complexity_space, example_input, expected_output, animation_config,
       related, status, archived, created_at, updated_at)
     VALUES (@id, @slug, @name, @category, @summary, @objectives, @prerequisites,
       @plain, @technical, @pseudocode, @language, @code,
       @time, @space, @exampleInput, @expectedOutput, @animation,
       @related, @status, 0, @now, @now)`
  );
  const run = db.transaction((items: SeedConcept[]) => {
    for (const item of items) {
      insert.run({
        id: newId(),
        slug: item.slug,
        name: item.name,
        category: item.category,
        summary: item.summary,
        objectives: item.objectives,
        prerequisites: item.prerequisites,
        plain: item.plain,
        technical: item.technical,
        pseudocode: item.pseudocode,
        language: item.language || '',
        code: item.code || '',
        time: item.time,
        space: item.space,
        exampleInput: item.exampleInput,
        expectedOutput: item.expectedOutput,
        animation: JSON.stringify(item.animation || {}),
        related: JSON.stringify(item.related),
        status: 'published',
        now
      });
    }
  });
  run(SEED);

  const stack = db.prepare('SELECT id FROM concepts WHERE slug = ?').get('stacks') as { id: string };
  db.prepare(
    `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook,
       narration, on_screen_text, key_takeaway, cta, sources, review_status, scenes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
  ).run(
    newId(),
    stack.id,
    'Stack in 20 seconds: LIFO on screen',
    'Junior developers revising for interviews',
    'Know why a stack pops the newest item first',
    20,
    'Three values go into a stack. Which one comes out first?',
    'Push 10, 20 and 30. POP returns 30 because a stack is last in, first out. TOP now points at 20.',
    'LIFO: the last value in is the first value out',
    'Push and pop are O(1) because only the top is touched',
    'Trace POP on an empty stack — what should it return?',
    'CLRS chapter 10.1; MDN Array.prototype.pop',
    'draft',
    now,
    now
  );
}

/**
 * Keeps the Binary Search demo usable on databases created before it had an
 * animation configuration: attaches the trusted config and completes the
 * lesson's copy without overwriting anything a person has edited.
 */
/** Copy for the stack short that ships with a fresh database. */
const STACK_LESSON = {
  title: 'Stacks in 45 Seconds',
  audience: 'Beginner software engineering students',
  objective: 'Watch PUSH, PEEK and POP change one stack and see why LIFO holds.',
  hook: 'Three values go in. Which one comes out first?',
  narration:
    'Push 10, 20 and 30. PEEK shows 30 without removing it. POP returns 30 and then 20, because a stack is last in, first out. A final PUSH(40) lands above 10.',
  on_screen_text: 'LIFO: the last value in is the first value out.',
  key_takeaway: 'LIFO: the last value pushed is the first value popped.',
  cta: 'POP on an empty stack? That is underflow — it returns EMPTY.',
  sources: 'Cormen et al., Introduction to Algorithms (3rd ed.), §10.1; MDN Array.prototype.pop.'
};

const DEMO_SECONDS = 45;

/** Creates the demo lesson for a concept, or fills in copy a person has not set. */
function ensureDemoLesson(conceptId: string, copy: Record<string, string>): void {
  const existing = db
    .prepare('SELECT * FROM lessons WHERE concept_id = ? ORDER BY created_at LIMIT 1')
    .get(conceptId) as Record<string, unknown> | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO lessons (id, concept_id, title, audience, objective, duration_seconds, hook,
         narration, on_screen_text, key_takeaway, cta, sources, review_status, scenes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', '[]', ?, ?)`
    ).run(
      newId(),
      conceptId,
      copy.title,
      copy.audience,
      copy.objective,
      DEMO_SECONDS,
      copy.hook,
      copy.narration,
      copy.on_screen_text,
      copy.key_takeaway,
      copy.cta,
      copy.sources,
      nowIso(),
      nowIso()
    );
    return;
  }

  // The demo shorts are 45 seconds now; keep the seeded titles honest.
  db.prepare(
    `UPDATE lessons
       SET title = replace(replace(title, '20 seconds', '45 seconds'), '20 Seconds', '45 Seconds'), updated_at = ?
     WHERE concept_id = ? AND (title LIKE '%20 seconds%' OR title LIKE '%20 Seconds%')`
  ).run(nowIso(), conceptId);

  const fills = Object.entries(copy).filter(([key]) => !String(existing[key] ?? '').trim());
  if (fills.length > 0) {
    db.prepare(
      `UPDATE lessons SET ${fills.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
    ).run(...fills.map(([, value]) => value as never), nowIso(), String(existing.id));
  }
}

/**
 * Keeps the two demo shorts on the current animation timeline.
 *
 * The renderer is continuous, so a storyboard only has to keep one beat window
 * per verified operation. Storyboards written by the old slide builder (a code
 * scene, one scene per operation for a partial trace, 20 second timing) cannot
 * describe the new shorts, so those are rebuilt; anything a person has duplicated
 * or re-timed is left alone.
 */
function ensureMotionDemos(): void {
  // New demos are 45 second vertical shorts.
  db.prepare("UPDATE brand SET default_duration = ? WHERE id = 1 AND default_duration < ?").run(
    DEMO_SECONDS,
    DEMO_SECONDS
  );

  const stackConcept = db
    .prepare("SELECT id, animation_config FROM concepts WHERE slug = 'stacks'")
    .get() as { id: string; animation_config: string } | undefined;
  if (stackConcept) {
    const config = safeParse(stackConcept.animation_config);
    const ops = Array.isArray(config?.ops) ? (config!.ops as Record<string, unknown>[]) : [];
    const isLegacySeed = ops.length === 4 && ops[3]?.op === 'pop';
    if (!config || ops.length === 0 || isLegacySeed) {
      db.prepare('UPDATE concepts SET animation_config = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify({ ops: STACK_OPS, expect: STACK_EXPECT }),
        nowIso(),
        stackConcept.id
      );
    }
    ensureDemoLesson(stackConcept.id, STACK_LESSON);
  }

  const binaryConcept = db
    .prepare("SELECT id, animation_config FROM concepts WHERE slug = 'binary-search'")
    .get() as { id: string; animation_config: string } | undefined;
  if (binaryConcept) {
    const config = safeParse(binaryConcept.animation_config);
    const configured = Boolean(config) && config!.kind === 'binary-search' && Array.isArray(config!.array);
    if (!configured) {
      db.prepare('UPDATE concepts SET animation_config = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(BINARY_SEARCH_ANIMATION),
        nowIso(),
        binaryConcept.id
      );
    }
    ensureDemoLesson(binaryConcept.id, BINARY_SEARCH_LESSON);
  }

  for (const conceptId of [stackConcept?.id, binaryConcept?.id]) {
    if (!conceptId) continue;
    const conceptRow = db.prepare('SELECT * FROM concepts WHERE id = ?').get(conceptId) as ConceptInput | undefined;
    if (!conceptRow) continue;

    const lessons = db.prepare('SELECT * FROM lessons WHERE concept_id = ?').all(conceptId) as (LessonInput & {
      scenes: string;
    })[];
    const run = runConcept(conceptRow);

    for (const lesson of lessons) {
      const list = safeParse(lesson.scenes);
      const stored = Array.isArray(list) ? (list as { type?: string; id?: string }[]) : [];
      const duplicated = stored.some((scene) => String(scene.id || '').includes('-copy-'));
      if (duplicated) continue;

      const executionBeats = stored.filter((scene) => scene.type === 'execution').length;
      const traceBeats = stored.filter((scene) => scene.type === 'trace').length;
      const mismatchedPlan =
        stored.length === 0 ||
        stored.some((scene) => scene.type === 'code') ||
        (run.kind === 'stack' && executionBeats !== run.events.length) ||
        (run.kind === 'binary-search' && traceBeats !== 1);

      // A storyboard the animation cannot describe (a slide plan) is rebuilt once.
      // Any deliberate length a person chose afterwards is preserved.
      if (!mismatchedPlan) continue;
      const seconds = Number(lesson.duration_seconds) === 20 ? DEMO_SECONDS : Number(lesson.duration_seconds);
      const refreshed: LessonInput = { ...lesson, duration_seconds: seconds };
      const scenes = buildScenes(refreshed, conceptRow);
      db.prepare('UPDATE lessons SET duration_seconds = ?, scenes = ?, updated_at = ? WHERE id = ?').run(
        seconds,
        JSON.stringify(scenes),
        nowIso(),
        lesson.id
      );
    }
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

ensureMotionDemos();

export type Brand = {
  name: string;
  accent: string;
  background: string;
  panel: string;
  ink: string;
  font_family: string;
  watermark: string;
  caption_style: string;
  code_style: string;
  default_duration: number;
  default_resolution: string;
  intro: string;
  outro: string;
  updated_at: string;
};

export function readBrand(): Brand {
  return db.prepare('SELECT * FROM brand WHERE id = 1').get() as Brand;
}
