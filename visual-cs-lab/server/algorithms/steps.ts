/**
 * Cell-row traces: the shared vocabulary of the pattern and paradigm shorts.
 *
 * Strings, two pointers, sliding windows, prefix sums, selection sort, bit
 * masks, counting sort and KMP all animate the same way — a row (or two) of
 * cells, a few pointers that name positions, and one step per decision the
 * algorithm makes. Each lesson still owns its own verified trace module; this
 * module only describes the shape those traces share and checks that a trace is
 * internally consistent, so the animation can never show a step list the
 * algorithm did not produce.
 *
 * Keep this module dependency-free apart from the trace modules it dispatches
 * to: the storyboard builder, the renderer and the API all read it.
 */

import type { Validation } from './stack.ts';
import {
  isStringsConfig,
  traceStrings,
  validateStringsTrace,
  type StringsConfig
} from './strings.ts';
import {
  isPrefixSumsConfig,
  tracePrefixSums,
  validatePrefixSumsTrace,
  type PrefixSumsConfig
} from './prefix-sums.ts';
import {
  isSelectionSortConfig,
  traceSelectionSort,
  validateSelectionTrace,
  type SelectionSortConfig
} from './selection-sort.ts';
import {
  isSlidingWindowConfig,
  traceSlidingWindow,
  validateSlidingWindowTrace,
  type SlidingWindowConfig
} from './sliding-window.ts';
import {
  isTwoPointersConfig,
  traceTwoPointers,
  validateTwoPointersTrace,
  type TwoPointersConfig
} from './two-pointers.ts';

/** One line of cells: the subject row, a shadow row, a bucket row. */
export type StepsRow = {
  /** A name printed to the left of the row (a[], low, total). */
  label?: string;
  cells: string[];
  /** Indices the current decision touches. */
  active?: number[];
  /** Indices already settled. */
  done?: number[];
};

/** A chip that names a position, anchored to one cell. */
export type StepsPointer = {
  row?: number;
  index: number;
  label: string;
  tone?: 'accent' | 'coral' | 'violet';
  place?: 'above' | 'below';
};

export type StepsStep = {
  /** 1-based step number. */
  n: number;
  rows: StepsRow[];
  pointers?: StepsPointer[];
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export type StepsCopy = {
  hook: string;
  setupTitle: string;
  setupCaption: string;
  traceTitle: string;
  traceSubtitle: string;
  traceCaption: string;
  complexityTitle: string;
  complexityCaption: string;
};

export type StepsMeta = {
  label: string;
  kickers: [string, string];
  facts: { label: string; value: string }[];
  result: { title: string; sub: string };
  holdCaption: string;
  complexity: { time: string; space: string };
  copy: StepsCopy;
};

export type StepsTrace = {
  steps: StepsStep[];
  meta: StepsMeta;
};

export type StepsBuild = { trace: StepsTrace; validation: Validation };

/** Structural checks every cell-row trace has to pass before it can render. */
export function inspectStepsTrace(trace: StepsTrace): Validation {
  const failures: string[] = [];
  if (trace.steps.length < 2) failures.push('the trace needs at least two steps');

  trace.steps.forEach((step, index) => {
    const expected = index + 1;
    if (step.n !== expected) failures.push(`step ${expected} is numbered ${step.n}`);
    if (step.rows.length === 0) failures.push(`step ${expected} has no cells`);
    if (!step.message.trim()) failures.push(`step ${expected} has no message`);

    step.rows.forEach((row, rowIndex) => {
      if (row.cells.length === 0) failures.push(`step ${expected} row ${rowIndex + 1} is empty`);
      for (const cellIndex of [...(row.active || []), ...(row.done || [])]) {
        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= row.cells.length) {
          failures.push(`step ${expected} highlights cell ${cellIndex} of a ${row.cells.length}-cell row`);
        }
      }
    });

    for (const pointer of step.pointers || []) {
      const row = step.rows[pointer.row ?? 0];
      if (!row) failures.push(`step ${expected} points at a row that does not exist`);
      else if (pointer.index < 0 || pointer.index >= row.cells.length) {
        failures.push(`step ${expected} points at cell ${pointer.index} of a ${row.cells.length}-cell row`);
      }
    }
  });

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}

type Builder = {
  matches: (config: Record<string, unknown>) => boolean;
  build: (config: Record<string, unknown>) => StepsBuild;
};

/**
 * Every cell-row lesson registers here. A concept opts in by carrying its
 * config `kind`, and `runConcept` needs no branch per lesson.
 */
const BUILDERS: Builder[] = [
  {
    matches: (config) => isStringsConfig(config),
    build: (config) => {
      const strings = config as unknown as StringsConfig;
      const trace = traceStrings(strings);
      return { trace, validation: validateStringsTrace(trace, strings.expect) };
    }
  },
  {
    matches: (config) => isTwoPointersConfig(config),
    build: (config) => {
      const pointers = config as unknown as TwoPointersConfig;
      const trace = traceTwoPointers(pointers);
      return { trace, validation: validateTwoPointersTrace(trace, pointers) };
    }
  },
  {
    matches: (config) => isSlidingWindowConfig(config),
    build: (config) => {
      const window = config as unknown as SlidingWindowConfig;
      const trace = traceSlidingWindow(window);
      return { trace, validation: validateSlidingWindowTrace(trace, window) };
    }
  },
  {
    matches: (config) => isPrefixSumsConfig(config),
    build: (config) => {
      const prefix = config as unknown as PrefixSumsConfig;
      const trace = tracePrefixSums(prefix);
      return { trace, validation: validatePrefixSumsTrace(trace, prefix) };
    }
  },
  {
    matches: (config) => isSelectionSortConfig(config),
    build: (config) => {
      const selection = config as unknown as SelectionSortConfig;
      const trace = traceSelectionSort(selection);
      return { trace, validation: validateSelectionTrace(trace, selection) };
    }
  }
];

export function isStepsConfig(config: unknown): config is Record<string, unknown> {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return BUILDERS.some((builder) => builder.matches(record));
}

export function buildStepsRun(config: unknown): StepsBuild | null {
  if (!isStepsConfig(config)) return null;
  const builder = BUILDERS.find((item) => item.matches(config as Record<string, unknown>));
  return builder ? builder.build(config as Record<string, unknown>) : null;
}
