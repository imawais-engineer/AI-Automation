/**
 * Binary search tree insert and search: the verified trace behind the BST short.
 *
 * The ordering invariant is the algorithm: every insert walks from the root,
 * turning left for smaller keys and right for larger ones, and the search repeats
 * that walk for the target. Each step records the path it took and the tree as it
 * stood, so the animation can only draw comparisons the reference implementation
 * actually made — including the ones that throw half the tree away.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type BstNode = {
  id: string;
  value: number;
  parent: string | null;
};

export type BstStep = {
  /** 1-based step number. */
  n: number;
  op: 'insert' | 'compare';
  /** The key being inserted or searched for. */
  key: number;
  /** The node this step compared against, or the node it created. */
  nodeId: string | null;
  value: number | null;
  direction: 'root' | 'left' | 'right' | 'equal' | null;
  /** Node ids from the root to this step's node. */
  path: string[];
  /** The tree after this step. */
  tree: BstNode[];
  found: boolean | null;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type BstTrace = {
  insert: number[];
  search: number;
  nodes: BstNode[];
  steps: BstStep[];
  found: boolean;
  comparisons: number;
  /** In-order traversal: sorted, which is what the invariant promises. */
  inorder: number[];
};

export type BstExpectation = {
  found?: boolean;
  comparisons?: number;
  inorder?: number[];
};

export type BstConfig = {
  kind: 'bst';
  insert: number[];
  search: number;
  expect?: BstExpectation;
};

export function isBstConfig(config: unknown): config is BstConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'bst' && Array.isArray(record.insert);
}

type Mutable = {
  id: string;
  value: number;
  parent: Mutable | null;
  left: Mutable | null;
  right: Mutable | null;
};

function parseKeys(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const keys: number[] = [];
  for (const item of raw) {
    const value = Number(item);
    if (!Number.isFinite(value) || seen.has(value)) continue;
    seen.add(value);
    keys.push(Math.round(value));
  }
  return keys;
}

function flatten(root: Mutable | null): BstNode[] {
  const nodes: BstNode[] = [];
  const walk = (node: Mutable | null) => {
    if (!node) return;
    nodes.push({ id: node.id, value: node.value, parent: node.parent?.id ?? null });
    walk(node.left);
    walk(node.right);
  };
  walk(root);
  return nodes;
}

function inOrder(root: Mutable | null): number[] {
  const values: number[] = [];
  const walk = (node: Mutable | null) => {
    if (!node) return;
    walk(node.left);
    values.push(node.value);
    walk(node.right);
  };
  walk(root);
  return values;
}

function depthOf(node: Mutable | null): number {
  let depth = 0;
  let cursor = node?.parent ?? null;
  while (cursor) {
    depth += 1;
    cursor = cursor.parent;
  }
  return depth;
}

/** Inserts the keys in order, then searches for the target, recording each step. */
export function traceBst(config: { insert: number[]; search: number }): BstTrace {
  const insert = parseKeys(config.insert);
  const search = Math.round(Number(config.search));
  const steps: BstStep[] = [];
  let root: Mutable | null = null;

  const record = (step: Omit<BstStep, 'n' | 'tree'>) => {
    steps.push({ ...step, n: steps.length + 1, tree: flatten(root) });
  };

  for (const key of insert) {
    if (!root) {
      const node: Mutable = { id: `n${key}`, value: key, parent: null, left: null, right: null };
      root = node;
      record({
        op: 'insert',
        key,
        nodeId: node.id,
        value: key,
        direction: 'root',
        path: [node.id],
        found: null,
        message: `${key} is the first key in — it becomes the root.`,
        hudLabel: `INSERT ${key} · root`,
        hudDetail: 'the tree was empty'
      });
      continue;
    }

    const path: string[] = [];
    let cursor: Mutable = root;
    const decisions: string[] = [];
    while (true) {
      path.push(cursor.id);
      if (key < cursor.value) {
        decisions.push(`${key} < ${cursor.value} → left`);
        if (!cursor.left) {
          const node: Mutable = { id: `n${key}`, value: key, parent: cursor, left: null, right: null };
          cursor.left = node;
          record({
            op: 'insert',
            key,
            nodeId: node.id,
            value: key,
            direction: 'left',
            path,
            found: null,
            message: `${decisions.join(' · ')} — that slot is free, so ${key} becomes the left child of ${cursor.value}.`,
            hudLabel: `INSERT ${key} · left of ${cursor.value}`,
            hudDetail: `depth ${depthOf(node)} · ${decisions.length} comparison${decisions.length === 1 ? '' : 's'}`
          });
          break;
        }
        cursor = cursor.left;
        continue;
      }
      decisions.push(`${key} > ${cursor.value} → right`);
      if (!cursor.right) {
        const node: Mutable = { id: `n${key}`, value: key, parent: cursor, left: null, right: null };
        cursor.right = node;
        record({
          op: 'insert',
          key,
          nodeId: node.id,
          value: key,
          direction: 'right',
          path,
          found: null,
          message: `${decisions.join(' · ')} — that slot is free, so ${key} becomes the right child of ${cursor.value}.`,
          hudLabel: `INSERT ${key} · right of ${cursor.value}`,
          hudDetail: `depth ${depthOf(node)} · ${decisions.length} comparison${decisions.length === 1 ? '' : 's'}`
        });
        break;
      }
      cursor = cursor.right;
    }
  }

  let found = false;
  let comparisons = 0;
  let cursor: Mutable | null = root;
  const path: string[] = [];

  while (cursor && Number.isFinite(search)) {
    comparisons += 1;
    path.push(cursor.id);
    if (search === cursor.value) {
      found = true;
      record({
        op: 'compare',
        key: search,
        nodeId: cursor.id,
        value: cursor.value,
        direction: 'equal',
        path: [...path],
        found: true,
        message: `${search} = ${cursor.value} — found at depth ${depthOf(cursor)} after ${comparisons} comparison${comparisons === 1 ? '' : 's'}.`,
        hudLabel: `SEARCH ${search} · found`,
        hudDetail: `${comparisons} comparison${comparisons === 1 ? '' : 's'} · everything else was skipped`
      });
      break;
    }
    if (search < cursor.value) {
      record({
        op: 'compare',
        key: search,
        nodeId: cursor.id,
        value: cursor.value,
        direction: 'left',
        path: [...path],
        found: null,
        message: `${search} < ${cursor.value} — go left; every key on the right is now out of the question.`,
        hudLabel: `COMPARE ${search} < ${cursor.value}`,
        hudDetail: `comparison ${comparisons} · turn left`
      });
      cursor = cursor.left;
    } else {
      record({
        op: 'compare',
        key: search,
        nodeId: cursor.id,
        value: cursor.value,
        direction: 'right',
        path: [...path],
        found: null,
        message: `${search} > ${cursor.value} — go right; every key on the left is now out of the question.`,
        hudLabel: `COMPARE ${search} > ${cursor.value}`,
        hudDetail: `comparison ${comparisons} · turn right`
      });
      cursor = cursor.right;
    }
  }

  return {
    insert,
    search,
    nodes: flatten(root),
    steps,
    found,
    comparisons,
    inorder: inOrder(root)
  };
}

/**
 * Proves the trace is a real BST run: the tree is rebuilt independently from the
 * same keys, the in-order walk has to come out sorted, and every recorded path,
 * comparison and decision has to match.
 */
export function validateBstTrace(trace: BstTrace, expectation: BstExpectation | undefined): Validation {
  const failures: string[] = [];
  const insert = parseKeys(trace.insert);
  if (insert.length === 0) return { ok: false, failures: ['The tree has no keys to insert.'] };

  const reference = traceBst({ insert, search: trace.search });
  const summary = (nodes: BstNode[]) =>
    [...nodes].sort((a, b) => a.value - b.value).map((node) => `${node.value}<${node.parent ?? 'root'}`).join('|');

  if (summary(trace.nodes) !== summary(reference.nodes)) {
    failures.push('The stored tree is not the tree those keys produce.');
  }

  const sorted = [...reference.inorder].sort((a, b) => a - b);
  if (reference.inorder.join(',') !== sorted.join(',')) {
    failures.push('The in-order walk is not sorted, so the ordering invariant is broken.');
  }

  const expectedInserts = insert.length;
  const insertSteps = trace.steps.filter((step) => step.op === 'insert').length;
  if (insertSteps !== expectedInserts) {
    failures.push(`The trace inserts ${insertSteps} keys where ${expectedInserts} were configured.`);
  }

  trace.steps.forEach((step, index) => {
    if (step.n !== index + 1) failures.push(`Step ${index + 1} is numbered ${step.n}.`);
    if (!step.path.length) failures.push(`Step ${index + 1} has no path from the root.`);
    const match = reference.steps[index];
    if (step.op === 'compare' && match) {
      if (step.value !== match.value) {
        failures.push(`Comparison ${index + 1} compares ${step.value} where the search compares ${String(match.value)}.`);
      }
      if (step.direction !== match.direction) {
        failures.push(`Comparison ${index + 1} turns ${String(step.direction)} where it should turn ${String(match.direction)}.`);
      }
    }
  });

  const comparisons = trace.steps.filter((step) => step.op === 'compare').length;
  if (comparisons !== reference.comparisons) {
    failures.push(`The trace compares ${comparisons} times where the search needs ${reference.comparisons}.`);
  }
  if (reference.found !== trace.found) {
    failures.push(`The search reports ${trace.found ? 'a hit' : 'a miss'} where the tree gives ${reference.found ? 'a hit' : 'a miss'}.`);
  }
  if (expectation?.found !== undefined && expectation.found !== reference.found) {
    failures.push(`Searching ${trace.search} should ${expectation.found ? 'find the key' : 'miss'}.`);
  }
  if (expectation?.comparisons !== undefined && expectation.comparisons !== reference.comparisons) {
    failures.push(`The search compares ${reference.comparisons} times where ${expectation.comparisons} was expected.`);
  }
  if (expectation?.inorder && expectation.inorder.join(',') !== reference.inorder.join(',')) {
    failures.push(
      `In-order should be [${expectation.inorder.join(', ')}] but the tree gives [${reference.inorder.join(', ')}].`
    );
  }

  return { ok: failures.length === 0, failures };
}
