/**
 * Singly linked list traversal: the verified trace behind the Linked Lists short.
 *
 * There is no index arithmetic to jump with, so reaching a value means following
 * `next` from the head, one node at a time. The trace records every node the
 * pointer actually visited and stops at the match — the animation reads its node
 * positions from here, so it can never show a shortcut the list does not have.
 *
 * Keep this module dependency-free: the storyboard builder, the renderer and the
 * API all read it.
 */

import type { Validation } from './stack.ts';

export type LinkedListStep = {
  /** 1-based visit count. */
  n: number;
  /** Position from the head (0 = head). */
  nodeIndex: number;
  value: number;
  match: boolean;
  /** Index the pointer moves to next, or null when the traversal ends. */
  nextIndex: number | null;
  message: string;
};

export type LinkedListTrace = {
  values: number[];
  target: number;
  foundIndex: number | null;
  steps: LinkedListStep[];
  comparisons: number;
};

export type LinkedListExpectation = {
  foundIndex?: number | null;
};

export type LinkedListConfig = {
  values: number[];
  target: number;
  expect?: LinkedListExpectation;
};

function cleanValues(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isLinkedListConfig(config: unknown): config is LinkedListConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return (
    Array.isArray(record.values) &&
    cleanValues(record.values).length > 0 &&
    Number.isFinite(Number(record.target)) &&
    !record.ops &&
    !record.array
  );
}

/**
 * Follows `next` from the head until the target is found or the chain ends.
 * The walk stops at the match: the nodes after it are never visited, which is
 * exactly the point of the structure.
 */
export function traceLinkedList(input: number[], target: number): LinkedListTrace {
  const values = cleanValues(input);
  const wanted = Number(target);
  const steps: LinkedListStep[] = [];
  let foundIndex: number | null = null;

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const match = value === wanted;
    if (match) foundIndex = index;
    steps.push({
      n: index + 1,
      nodeIndex: index,
      value,
      match,
      nextIndex: match || index === values.length - 1 ? null : index + 1,
      message: match
        ? `node ${index}: ${value} = ${wanted} → found, stop`
        : `node ${index}: ${value} ≠ ${wanted} → follow next`
    });
    if (match) break;
  }

  return { values, target: wanted, foundIndex, steps, comparisons: steps.length };
}

/** Proves the walk is real: consecutive nodes, a stopping match, the claimed result. */
export function validateLinkedListTrace(
  trace: LinkedListTrace,
  expectation: LinkedListExpectation | undefined,
  values: number[],
  target: number
): Validation {
  const failures: string[] = [];
  const source = cleanValues(values);

  if (source.length === 0) return { ok: false, failures: ['The list is empty, so there is nothing to traverse.'] };

  trace.steps.forEach((step, position) => {
    if (step.nodeIndex !== position) {
      failures.push(`Step ${position + 1} is at node ${step.nodeIndex} instead of ${position} — a list cannot be skipped.`);
    }
    if (step.value !== source[position]) {
      failures.push(`Step ${position + 1} reads ${step.value} where node ${position} holds ${source[position]}.`);
    }
    if (step.match && step.value !== Number(target)) {
      failures.push(`Step ${position + 1} claims a match on ${step.value} while searching for ${target}.`);
    }
  });

  const expectedIndex = source.indexOf(Number(target));
  const claim = expectedIndex >= 0 ? expectedIndex : null;
  if (trace.foundIndex !== claim) {
    failures.push(
      claim === null
        ? `The trace reports a match at node ${String(trace.foundIndex)} but ${target} is not in the list.`
        : `The trace reports ${String(trace.foundIndex)} but ${target} first appears at node ${claim}.`
    );
  }

  if (claim !== null && trace.steps.length !== claim + 1) {
    failures.push(
      `The walk visited ${trace.steps.length} nodes but should stop at node ${claim}.`
    );
  }
  if (claim === null && trace.steps.length !== source.length) {
    failures.push(`A missing value must visit every node; ${trace.steps.length} of ${source.length} were visited.`);
  }

  if (expectation?.foundIndex !== undefined && expectation.foundIndex !== trace.foundIndex) {
    failures.push(
      `The trace finds ${String(trace.foundIndex)} but ${String(expectation.foundIndex)} was expected.`
    );
  }

  return { ok: failures.length === 0, failures };
}

export function valuesFromConfig(config: Record<string, unknown>): number[] {
  return cleanValues(config.values);
}

export const DEFAULT_LIST = [4, 7, 9, 12, 20];
