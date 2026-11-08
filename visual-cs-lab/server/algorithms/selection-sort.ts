/**
 * Selection sort: the verified scan-and-swap trace behind the Selection Sort short.
 *
 * Each pass finds the smallest remaining value and swaps it into the front of
 * the unsorted suffix, so after pass i the first i cells are final. Selection
 * sort always makes n−1 passes and exactly one swap per pass, but it compares
 * every remaining pair — O(n²) comparisons with O(1) extra space and a very
 * small number of writes. `validateSelectionTrace` replays the same passes on a
 * plain array, so the animation can only show a step the scan really took.
 *
 * Keep this module dependency-free apart from the shared trace vocabulary: the
 * storyboard builder, the renderer and the API all read it.
 */

import type { Validation } from './stack.ts';
import type { StepsMeta, StepsStep, StepsTrace } from './steps.ts';

export type SelectionSortConfig = {
  kind: 'selection-sort';
  array: number[];
  expect?: { sorted?: number[]; comparisons?: number; swaps?: number };
};

function cleanArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

export function isSelectionSortConfig(config: unknown): config is SelectionSortConfig {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  return record.kind === 'selection-sort' && Array.isArray(record.array) && record.array.length > 1;
}

export function traceSelectionSort(config: { array: unknown }): StepsTrace {
  const working = cleanArray(config.array);
  const steps: StepsStep[] = [];
  const settled: number[] = [];
  let comparisons = 0;
  let swaps = 0;

  const push = (active: number[], message: string, hudLabel: string, hudDetail: string): void => {
    steps.push({
      n: steps.length + 1,
      rows: [{ label: 'a[]', cells: working.map(String), active, done: [...settled] }],
      pointers: active.length > 0 ? [{ index: active[active.length - 1], label: `j = ${active[active.length - 1]}`, tone: 'coral' }] : [],
      message,
      hudLabel,
      hudDetail
    });
  };

  push([], 'Find the smallest value and swap it to the front', 'pass 0', 'nothing settled yet');

  for (let start = 0; start < working.length - 1; start += 1) {
    let minIndex = start;
    for (let scan = start + 1; scan < working.length; scan += 1) {
      comparisons += 1;
      const smaller = working[scan] < working[minIndex];
      push(
        [minIndex, scan],
        `a[${scan}] = ${working[scan]} ${smaller ? '<' : '≥'} min ${working[minIndex]} at a[${minIndex}]`,
        `min = ${working[smaller ? scan : minIndex]}`,
        `${comparisons} comparison${comparisons === 1 ? '' : 's'} · pass ${start + 1}`
      );
      if (smaller) minIndex = scan;
    }

    if (minIndex !== start) {
      const held = working[start];
      working[start] = working[minIndex];
      working[minIndex] = held;
      swaps += 1;
      settled.push(start);
      push(
        [start],
        `Swap ${held} and ${working[start]} — a[${start}] is final.`,
        `swap · position ${start} settled`,
        `${swaps} swap${swaps === 1 ? '' : 's'} · ${comparisons} comparisons`
      );
    } else {
      settled.push(start);
      push(
        [start],
        `a[${start}] = ${working[start]} is already the smallest — no swap needed.`,
        `position ${start} settled`,
        `${swaps} swap${swaps === 1 ? '' : 's'} · ${comparisons} comparisons`
      );
    }
  }
  settled.push(working.length - 1);

  const sorted = [...working];
  const meta: StepsMeta = {
    label: 'SELECTION SORT',
    kickers: ['scan the rest', 'one swap per pass'],
    facts: [
      { label: 'Comparisons', value: String(comparisons) },
      { label: 'Swaps', value: String(swaps) },
      { label: 'Writes', value: `at most ${working.length - 1}` }
    ],
    result: { title: `[${sorted.join(', ')}]`, sub: `${comparisons} comparisons · ${swaps} swaps for ${working.length} values` },
    holdCaption: 'Selection sort compares everything but writes almost nothing: one swap per pass.',
    complexity: { time: 'O(n²) always', space: 'O(1)' },
    copy: {
      hook: 'Look through everything, take the smallest, and put it where it belongs.',
      setupTitle: 'One pass settles one position',
      setupCaption: 'The settled prefix never moves again; each pass only scans the unsorted suffix.',
      traceTitle: `Trace · ${comparisons} comparisons across ${working.length - 1} passes`,
      traceSubtitle: 'scan for the minimum · swap it to the front · shrink the suffix',
      traceCaption: 'The scan length shrinks every pass, but the sum of 1..n−1 is still n²/2 comparisons.',
      complexityTitle: 'O(n²) comparisons, O(n) writes',
      complexityCaption: `${comparisons} comparisons and only ${swaps} swaps. Space: O(1) — the array is sorted in place.`
    }
  };

  return { steps, meta };
}

/** Replays the passes on the plain array and compares the settled result. */
export function validateSelectionTrace(trace: StepsTrace, config: SelectionSortConfig): Validation {
  const failures: string[] = [];
  const input = trace.steps[0]?.rows[0].cells.map(Number) ?? [];
  const working = [...input];
  let comparisons = 0;
  let swaps = 0;

  for (let start = 0; start < working.length - 1; start += 1) {
    let minIndex = start;
    for (let scan = start + 1; scan < working.length; scan += 1) {
      comparisons += 1;
      if (working[scan] < working[minIndex]) minIndex = scan;
    }
    if (minIndex !== start) {
      [working[start], working[minIndex]] = [working[minIndex], working[start]];
      swaps += 1;
    }
  }

  const last = trace.steps[trace.steps.length - 1]?.rows[0]?.cells.map(Number) ?? [];
  if (last.join(',') !== working.join(',')) {
    failures.push(`the last frame shows [${last.join(', ')}] but the passes sort to [${working.join(', ')}]`);
  }
  if (config.expect?.sorted && config.expect.sorted.join(',') !== working.join(',')) {
    failures.push(`expected [${config.expect.sorted.join(', ')}], the passes produce [${working.join(', ')}]`);
  }
  if (config.expect?.comparisons !== undefined && config.expect.comparisons !== comparisons) {
    failures.push(`expected ${config.expect.comparisons} comparisons, the passes make ${comparisons}`);
  }
  if (config.expect?.swaps !== undefined && config.expect.swaps !== swaps) {
    failures.push(`expected ${config.expect.swaps} swaps, the passes make ${swaps}`);
  }
  if (!trace.meta.result.sub.startsWith(String(comparisons))) {
    failures.push(`the result line says “${trace.meta.result.sub}” but the passes make ${comparisons} comparisons`);
  }

  return { ok: failures.length === 0, failures: failures.slice(0, 4) };
}
