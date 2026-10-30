/**
 * The animation plan: one description of the whole video in time.
 *
 * A plan is built from a *verified* trace (stack events or binary search steps)
 * plus the beat durations stored on the lesson's storyboard. The renderer only
 * ever reads the plan, so preview frames and exported frames share the same
 * deterministic timeline, and no visual value is invented separately from the
 * algorithm's own states.
 */

import type { BinarySearchStep } from '../algorithms/binary-search.ts';
import type { StackEvent } from '../algorithms/stack.ts';
import type { ArrayStep } from '../algorithms/arrays.ts';
import type { LinkedListStep } from '../algorithms/linked-lists.ts';

export type BeatKey = 'open' | 'intro' | 'setup' | 'op' | 'trace' | 'lifo' | 'complexity' | 'brand';

export type Beat = {
  key: BeatKey;
  /** Storyboard scene this beat came from (`hook`, `concept`, `execution`, …). */
  sceneType: string;
  startMs: number;
  endMs: number;
  sceneIndex: number;
  title: string;
  caption: string;
};

export type PlanCopy = {
  title: string;
  hook: string;
  objective: string;
  takeaway: string;
  cta: string;
  time: string;
  space: string;
  example: string;
};

export type PlanBrand = {
  name: string;
  accent: string;
  background: string;
  panel: string;
  ink: string;
  watermark: string;
  outro: string;
  /** The personal identity on every opening and closing frame. */
  presenter: string;
  role: string;
  closing: string;
  /** Closing call to action, and the presenter's social handle. */
  cta: string;
  instagram: string;
  linkedin: string;
  openingStyle: string;
};

/** The branded opening: title, kicker and the presenter credit. */
export type PlanOpening = {
  title: string;
  kicker: string;
  presenter: string;
  role: string;
  style: string;
};

/** One solid value known to the stack: born on a push, retired on a pop. */
export type StackBlock = {
  id: string;
  value: number;
  /** Slot index counted from the bottom (0 = resting on the platform). */
  slot: number;
  bornMs: number;
  landedMs: number;
  /** When a POP starts removing it, and when it is fully gone. */
  deathMs: number | null;
  goneMs: number | null;
};

export type StackOpWindow = {
  index: number;
  event: StackEvent;
  startMs: number;
  endMs: number;
  blockId: string | null;
};

export type StackPlan = {
  kind: 'stack';
  durationMs: number;
  brand: PlanBrand;
  copy: PlanCopy;
  opening: PlanOpening;
  beats: Beat[];
  ops: StackOpWindow[];
  blocks: StackBlock[];
  maxSlots: number;
};

export type BinaryStepWindow = {
  step: BinarySearchStep;
  index: number;
  startMs: number;
  endMs: number;
};

export type BinaryPlan = {
  kind: 'binary';
  durationMs: number;
  brand: PlanBrand;
  copy: PlanCopy;
  opening: PlanOpening;
  beats: Beat[];
  array: number[];
  target: number;
  foundIndex: number | null;
  steps: BinaryStepWindow[];
  /** Window inside the trace beat used for the closing halving demonstration. */
  halving: { startMs: number; endMs: number } | null;
  /** Intro of the trace beat: the array settles before the first comparison. */
  traceIntro: { startMs: number; endMs: number } | null;
};

export type ArrayVisitWindow = {
  step: ArrayStep;
  index: number;
  startMs: number;
  endMs: number;
};

export type ArrayPlan = {
  kind: 'array';
  durationMs: number;
  brand: PlanBrand;
  copy: PlanCopy;
  opening: PlanOpening;
  beats: Beat[];
  array: number[];
  total: number;
  steps: ArrayVisitWindow[];
  /** The array settles before the first cell is added. */
  traceIntro: { startMs: number; endMs: number } | null;
  /** The frozen result at the end of the trace, held before the next beat. */
  hold: { startMs: number; endMs: number } | null;
};

export type LinkedVisitWindow = {
  step: LinkedListStep;
  index: number;
  startMs: number;
  endMs: number;
};

export type LinkedPlan = {
  kind: 'linked';
  durationMs: number;
  brand: PlanBrand;
  copy: PlanCopy;
  opening: PlanOpening;
  beats: Beat[];
  values: number[];
  target: number;
  foundIndex: number | null;
  steps: LinkedVisitWindow[];
  traceIntro: { startMs: number; endMs: number } | null;
  hold: { startMs: number; endMs: number } | null;
};

export type MotionPlan = StackPlan | BinaryPlan | ArrayPlan | LinkedPlan;

export type PlanScene = {
  type: string;
  durationMs: number;
  title: string;
  caption: string;
  subtitle?: string;
};

/** Beat durations come from the persisted storyboard, in order. */
function windows(scenes: PlanScene[]): { scene: PlanScene; index: number; startMs: number; endMs: number }[] {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const duration = Math.max(1, Math.round(Number(scene.durationMs) || 0));
    const window = { scene, index, startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return window;
  });
}

/**
 * The opening copy the renderer shows, read from the storyboard's own opening
 * beat so the title on screen is exactly the title the storyboard stores. The
 * presenter and the professional title come from the brand row.
 */
function openingOf(scenes: PlanScene[], brand: PlanBrand): PlanOpening {
  const open = scenes.find((scene) => scene.type === 'open');
  return {
    title: String(open?.title || '').trim(),
    kicker: String(open?.subtitle || '').trim(),
    presenter: brand.presenter || brand.name,
    role: brand.role || '',
    style: brand.openingStyle || 'cinematic'
  };
}

export function beatAt(beats: Beat[], tMs: number): Beat | null {
  if (beats.length === 0) return null;
  for (const beat of beats) {
    if (tMs >= beat.startMs && tMs < beat.endMs) return beat;
  }
  return beats[beats.length - 1];
}

export function buildStackPlan(args: {
  scenes: PlanScene[];
  events: StackEvent[];
  copy: PlanCopy;
  brand: PlanBrand;
}): StackPlan {
  const { scenes, events, copy, brand } = args;
  const beats: Beat[] = [];
  const ops: StackOpWindow[] = [];
  const blocks: StackBlock[] = [];

  for (const { scene, index, startMs, endMs } of windows(scenes)) {
    const caption = scene.caption || scene.subtitle || '';
    if (scene.type === 'execution') {
      const event = events[ops.length];
      if (!event) {
        throw new Error(
          `The storyboard has ${scenes.filter((item) => item.type === 'execution').length} operation beats but the verified trace has ${events.length} steps — rebuild the storyboard.`
        );
      }
      const duration = endMs - startMs;
      const opIndex = ops.length;
      let blockId: string | null = null;

      if (event.op === 'push') {
        const id = `b${opIndex}`;
        const bornMs = startMs + Math.round(duration * 0.08);
        const landedMs = bornMs + Math.round(duration * 0.4);
        blocks.push({
          id,
          value: Number(event.value),
          slot: event.items.length - 1,
          bornMs,
          landedMs,
          deathMs: null,
          goneMs: null
        });
        blockId = id;
      } else if (event.op === 'pop' && event.returned !== null) {
        const top = blocks
          .filter((block) => block.deathMs === null && block.slot === event.items.length)
          .sort((a, b) => b.slot - a.slot)[0];
        if (top) {
          top.deathMs = startMs + Math.round(duration * 0.34);
          top.goneMs = top.deathMs + Math.round(duration * 0.4);
          blockId = top.id;
        }
      }

      ops.push({ index: opIndex, event, startMs, endMs, blockId });
      beats.push({
        key: 'op',
        sceneType: scene.type,
        startMs,
        endMs,
        sceneIndex: index,
        title:
          event.op === 'push'
            ? `PUSH(${event.value})`
            : event.op === 'pop'
              ? 'POP()'
              : 'PEEK()',
        caption
      });
      continue;
    }

    const key: BeatKey =
      scene.type === 'open'
        ? 'open'
        : scene.type === 'hook'
          ? 'intro'
          : scene.type === 'summary'
            ? 'lifo'
            : scene.type === 'complexity'
              ? 'complexity'
              : scene.type === 'brand'
                ? 'brand'
                : 'setup';

    beats.push({ key, sceneType: scene.type, startMs, endMs, sceneIndex: index, title: scene.title, caption });
  }

  if (ops.length !== events.length) {
    throw new Error(
      `The storyboard animates ${ops.length} operations but the verified trace has ${events.length} — rebuild the storyboard.`
    );
  }

  const maxSlots = events.reduce((max, event) => Math.max(max, event.items.length), 0);
  return {
    kind: 'stack',
    durationMs: windows(scenes).reduce((sum, item) => sum + (item.endMs - item.startMs), 0),
    brand,
    copy,
    opening: openingOf(scenes, brand),
    beats,
    ops,
    blocks,
    maxSlots
  };
}

export function buildBinaryPlan(args: {
  scenes: PlanScene[];
  steps: BinarySearchStep[];
  array: number[];
  target: number;
  foundIndex: number | null;
  copy: PlanCopy;
  brand: PlanBrand;
}): BinaryPlan {
  const { scenes, steps, array, target, foundIndex, copy, brand } = args;
  const beats: Beat[] = [];
  let traceStartMs = -1;
  let traceEndMs = -1;

  for (const { scene, index, startMs, endMs } of windows(scenes)) {
    const key: BeatKey =
      scene.type === 'open'
        ? 'open'
        : scene.type === 'hook'
          ? 'intro'
          : scene.type === 'trace'
            ? 'complexity'
            : scene.type === 'complexity'
              ? 'complexity'
              : scene.type === 'brand'
                ? 'brand'
                : 'setup';

    if (scene.type === 'trace') {
      traceStartMs = startMs;
      traceEndMs = endMs;
    }
    beats.push({ key, sceneType: scene.type, startMs, endMs, sceneIndex: index, title: scene.title, caption: scene.caption || '' });
  }

  if (traceStartMs < 0) {
    throw new Error('The storyboard has no trace beat to animate — rebuild it from the verified trace.');
  }

  // Inside the trace beat: the array settles, each verified comparison gets an
  // equal share, and the closing share demonstrates the halving principle.
  const span = traceEndMs - traceStartMs;
  const introMs = Math.round(Math.min(6000, span * 0.2));
  const halvingMs = Math.round(span * 0.24);
  const stepsMs = span - introMs - halvingMs;
  const perStep = stepsMs / Math.max(1, steps.length);

  const stepWindows: BinaryStepWindow[] = steps.map((step, index) => ({
    step,
    index,
    startMs: Math.round(traceStartMs + introMs + index * perStep),
    endMs: Math.round(traceStartMs + introMs + (index + 1) * perStep)
  }));

  return {
    kind: 'binary',
    durationMs: beats.length > 0 ? beats[beats.length - 1].endMs : 0,
    brand,
    copy,
    opening: openingOf(scenes, brand),
    beats,
    array,
    target,
    foundIndex,
    steps: stepWindows,
    halving: { startMs: traceStartMs + introMs + stepsMs, endMs: traceEndMs },
    traceIntro: { startMs: traceStartMs, endMs: traceStartMs + introMs }
  };
}

/** Beat key for a traversal lesson: the trace beat is what the animation runs on. */
function traversalKey(type: string): BeatKey {
  if (type === 'open') return 'open';
  if (type === 'hook') return 'intro';
  if (type === 'trace') return 'trace';
  if (type === 'complexity') return 'complexity';
  if (type === 'brand') return 'brand';
  return 'setup';
}

/**
 * The trace beat of a traversal lesson is split three ways: the data settles, every
 * verified visit gets an equal share, and the last share holds the frozen result so
 * the animation stops cleanly on the answer instead of cutting away from it.
 */
function traversalWindows<T>(
  steps: T[],
  traceStartMs: number,
  traceEndMs: number
): {
  windows: { step: T; index: number; startMs: number; endMs: number }[];
  intro: { startMs: number; endMs: number };
  hold: { startMs: number; endMs: number };
} {
  const span = Math.max(1, traceEndMs - traceStartMs);
  const introMs = Math.round(span * 0.12);
  const holdMs = Math.round(span * 0.16);
  const stepsMs = span - introMs - holdMs;
  const per = stepsMs / Math.max(1, steps.length);
  return {
    windows: steps.map((step, index) => ({
      step,
      index,
      startMs: Math.round(traceStartMs + introMs + index * per),
      endMs: Math.round(traceStartMs + introMs + (index + 1) * per)
    })),
    intro: { startMs: traceStartMs, endMs: traceStartMs + introMs },
    hold: { startMs: traceStartMs + introMs + stepsMs, endMs: traceEndMs }
  };
}

function traversalBeats(scenes: PlanScene[]): { beats: Beat[]; traceStartMs: number; traceEndMs: number } {
  const beats: Beat[] = [];
  let traceStartMs = -1;
  let traceEndMs = -1;
  for (const { scene, index, startMs, endMs } of windows(scenes)) {
    if (scene.type === 'trace') {
      traceStartMs = startMs;
      traceEndMs = endMs;
    }
    beats.push({
      key: traversalKey(scene.type),
      sceneType: scene.type,
      startMs,
      endMs,
      sceneIndex: index,
      title: scene.title,
      caption: scene.caption || ''
    });
  }
  if (traceStartMs < 0) {
    throw new Error('The storyboard has no trace beat to animate — rebuild it from the verified trace.');
  }
  return { beats, traceStartMs, traceEndMs };
}

/** The Arrays plan: one visited cell at a time, with the running total it produced. */
export function buildArrayPlan(args: {
  scenes: PlanScene[];
  array: number[];
  total: number;
  steps: ArrayStep[];
  copy: PlanCopy;
  brand: PlanBrand;
}): ArrayPlan {
  const { scenes, array, total, steps, copy, brand } = args;
  const { beats, traceStartMs, traceEndMs } = traversalBeats(scenes);
  const { windows: visitWindows, intro, hold } = traversalWindows(steps, traceStartMs, traceEndMs);
  return {
    kind: 'array',
    durationMs: beats[beats.length - 1].endMs,
    brand,
    copy,
    opening: openingOf(scenes, brand),
    beats,
    array,
    total,
    steps: visitWindows,
    traceIntro: intro,
    hold
  };
}

/** The Linked Lists plan: the pointer walks the links the trace actually followed. */
export function buildLinkedPlan(args: {
  scenes: PlanScene[];
  values: number[];
  target: number;
  foundIndex: number | null;
  steps: LinkedListStep[];
  copy: PlanCopy;
  brand: PlanBrand;
}): LinkedPlan {
  const { scenes, values, target, foundIndex, steps, copy, brand } = args;
  const { beats, traceStartMs, traceEndMs } = traversalBeats(scenes);
  const { windows: visitWindows, intro, hold } = traversalWindows(steps, traceStartMs, traceEndMs);
  return {
    kind: 'linked',
    durationMs: beats[beats.length - 1].endMs,
    brand,
    copy,
    opening: openingOf(scenes, brand),
    beats,
    values,
    target,
    foundIndex,
    steps: visitWindows,
    traceIntro: intro,
    hold
  };
}
