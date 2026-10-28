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

export type BeatKey = 'intro' | 'setup' | 'op' | 'lifo' | 'complexity' | 'brand';

export type Beat = {
  key: BeatKey;
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

export type MotionPlan = StackPlan | BinaryPlan;

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
      scene.type === 'hook'
        ? 'intro'
        : scene.type === 'summary'
          ? 'lifo'
          : scene.type === 'complexity'
            ? 'complexity'
            : scene.type === 'brand'
              ? 'brand'
              : 'setup';

    beats.push({ key, startMs, endMs, sceneIndex: index, title: scene.title, caption });
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
      scene.type === 'hook'
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
    beats.push({ key, startMs, endMs, sceneIndex: index, title: scene.title, caption: scene.caption || '' });
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
    beats,
    array,
    target,
    foundIndex,
    steps: stepWindows,
    halving: { startMs: traceStartMs + introMs + stepsMs, endMs: traceEndMs },
    traceIntro: { startMs: traceStartMs, endMs: traceStartMs + introMs }
  };
}
