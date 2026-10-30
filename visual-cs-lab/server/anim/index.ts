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
import { BRAND_DEFAULTS } from '../branding.ts';
import {
  buildArrayPlan,
  buildBinaryPlan,
  buildLinkedPlan,
  buildStackPlan,
  type MotionPlan,
  type PlanBrand,
  type PlanCopy
} from './plan.ts';
import { drawStack } from './stack.ts';
import { drawBinary } from './binary.ts';
import { drawArrays } from './arrays.ts';
import { drawLinked } from './linked.ts';
import type { Dims } from './stage.ts';

export type { MotionPlan, PlanBrand, PlanCopy } from './plan.ts';
export { stackStateAt } from './stack.ts';
export { binaryStateAt } from './binary.ts';
export { arrayStateAt } from './arrays.ts';
export { linkedStateAt } from './linked.ts';

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
  presenter?: string;
  role?: string;
  closing_line?: string;
  instagram_handle?: string;
  linkedin_handle?: string;
  opening_style?: string;
}): PlanBrand {
  return {
    name: brand.name,
    accent: brand.accent,
    background: brand.background,
    panel: brand.panel,
    ink: brand.ink,
    watermark: brand.watermark,
    outro: brand.outro,
    // The personal identity is what the opening and closing frames show; the
    // template name is only an internal label and never reaches a video frame.
    presenter: String(brand.presenter || '').trim() || BRAND_DEFAULTS.presenter,
    role: String(brand.role || '').trim() || BRAND_DEFAULTS.role,
    closing: String(brand.closing_line || '').trim() || BRAND_DEFAULTS.closing,
    // The closing line stays personal; the call to action is the platform ask.
    cta: String(brand.outro || '').trim() || BRAND_DEFAULTS.cta,
    instagram: String(brand.instagram_handle || '').trim() || BRAND_DEFAULTS.instagram,
    linkedin: String(brand.linkedin_handle || '').trim() || BRAND_DEFAULTS.linkedin,
    openingStyle: String(brand.opening_style || '').trim() || 'cinematic'
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

  if (run.kind === 'array') {
    if (!run.validation.ok) {
      throw new Error(`The array trace is not verified: ${run.validation.failures.join(' ')}`);
    }
    return buildArrayPlan({
      scenes,
      array: run.input,
      total: run.total,
      steps: run.arraySteps,
      copy,
      brand
    });
  }

  if (run.kind === 'linked-list') {
    if (!run.validation.ok) {
      throw new Error(`The linked list trace is not verified: ${run.validation.failures.join(' ')}`);
    }
    return buildLinkedPlan({
      scenes,
      values: run.input,
      target: run.target ?? 0,
      foundIndex: run.foundIndex,
      steps: run.linkedSteps,
      copy,
      brand
    });
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
  else if (plan.kind === 'binary') drawBinary(ctx, plan, tMs, dims);
  else if (plan.kind === 'array') drawArrays(ctx, plan, tMs, dims);
  else drawLinked(ctx, plan, tMs, dims);
}

/** Start time of a beat, used for thumbnails and scene previews. */
export function beatWindow(plan: MotionPlan, index: number): { startMs: number; endMs: number } | null {
  const beat = plan.beats[index];
  return beat ? { startMs: beat.startMs, endMs: beat.endMs } : null;
}
