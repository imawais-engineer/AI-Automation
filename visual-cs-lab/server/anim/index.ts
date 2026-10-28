/**
 * Motion engine entry point.
 *
 * `planFor()` turns a lesson + its concept into one deterministic animation
 * plan, and `drawMoment()` paints that plan at any timestamp. The preview, the
 * scene thumbnails and the exported MP4 all go through these two functions, so
 * there is a single renderer, not a slideshow renderer plus a video renderer.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { runConcept, type ConceptInput, type LessonInput, type Scene } from '../scenes.ts';
import { buildBinaryPlan, buildStackPlan, type MotionPlan, type PlanBrand, type PlanCopy } from './plan.ts';
import { drawStack } from './stack.ts';
import { drawBinary } from './binary.ts';
import type { Dims } from './stage.ts';

export type { MotionPlan, PlanBrand, PlanCopy } from './plan.ts';
export { stackStateAt } from './stack.ts';
export { binaryStateAt } from './binary.ts';

export type PlanBrandInput = PlanBrand;
export type SceneLike = Scene;

export function planBrand(brand: {
  name: string;
  accent: string;
  background: string;
  panel: string;
  ink: string;
  watermark: string;
  outro: string;
}): PlanBrand {
  return {
    name: brand.name,
    accent: brand.accent,
    background: brand.background,
    panel: brand.panel,
    ink: brand.ink,
    watermark: brand.watermark,
    outro: brand.outro
  };
}

export function planCopy(lesson: LessonInput, concept: ConceptInput): PlanCopy {
  return {
    title: lesson.title,
    hook: lesson.hook,
    objective: lesson.objective,
    takeaway: lesson.key_takeaway,
    cta: lesson.cta,
    time: concept.complexity_time,
    space: concept.complexity_space,
    example: concept.example_input
  };
}

/**
 * Builds the animation plan for a lesson. The trace is re-run from the concept's
 * trusted configuration here, so a stored storyboard can never animate states the
 * algorithm did not produce.
 */
export function planFor(args: {
  lesson: LessonInput;
  concept: ConceptInput;
  scenes: Scene[];
  brand: PlanBrand;
}): MotionPlan {
  const { lesson, concept, scenes, brand } = args;
  if (scenes.length === 0) {
    throw new Error('The lesson has no storyboard beats yet — build it from the verified trace first.');
  }

  const run = runConcept(concept);
  const copy = planCopy(lesson, concept);

  if (run.kind === 'stack') {
    if (!run.validation.ok) {
      throw new Error(`The stack trace is not verified: ${run.validation.failures.join(' ')}`);
    }
    return buildStackPlan({ scenes, events: run.events, copy, brand });
  }

  if (run.kind === 'binary-search') {
    if (!run.validation.ok) {
      throw new Error(`The binary search trace is not verified: ${run.validation.failures.join(' ')}`);
    }
    return buildBinaryPlan({
      scenes,
      steps: run.steps,
      array: run.input,
      target: run.target ?? 0,
      foundIndex: run.foundIndex,
      copy,
      brand
    });
  }

  throw new Error('This concept has no animation configuration, so there is nothing to animate.');
}

export function planDurationMs(plan: MotionPlan): number {
  return plan.durationMs;
}

/** Paints the plan at `tMs`. */
export function drawMoment(ctx: SKRSContext2D, plan: MotionPlan, tMs: number, dims: Dims): void {
  if (plan.kind === 'stack') drawStack(ctx, plan, tMs, dims);
  else drawBinary(ctx, plan, tMs, dims);
}

/** Start time of a beat, used for thumbnails and scene previews. */
export function beatWindow(plan: MotionPlan, index: number): { startMs: number; endMs: number } | null {
  const beat = plan.beats[index];
  return beat ? { startMs: beat.startMs, endMs: beat.endMs } : null;
}
