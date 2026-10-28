/**
 * Scene inspection: the checks that run on the *plan*, before a frame is encoded.
 *
 * The renderer draws a set of sampled moments with the layout recorder switched
 * on, then the recorded geometry is tested: text that left its safe area or had to
 * be cut, text sitting on top of an animated object, a pointer whose tip is not on
 * the object it names, and an anchor that resolved to nothing.
 *
 * Separately, the algorithm state the picture shows at the end of every beat is
 * compared with the verified trace, so a scene that drifts from the data fails
 * here rather than shipping.
 */

import { createCanvas } from '@napi-rs/canvas';

import { beginAudit, endAudit, type AuditShape, type Rect } from './audit.ts';
import { drawMoment } from './index.ts';
import type { MotionPlan } from './plan.ts';
import { binaryStateAt, stackStateAt } from './index.ts';
import { SAFE, type Dims } from './stage.ts';

export type SceneCheck = { id: string; label: string; ok: boolean; detail: string };

export type SceneAudit = {
  ok: boolean;
  sampled: number;
  checks: SceneCheck[];
  issues: string[];
};

/** Moments worth inspecting: every fade-in, mid-beat and fade-out, plus every state change. */
export function sampleTimes(plan: MotionPlan): number[] {
  const times = new Set<number>();
  const push = (value: number) =>
    times.add(Math.max(0, Math.min(plan.durationMs - 1, Math.round(value))));

  for (const beat of plan.beats) {
    if (beat.key === 'brand') continue;
    push(beat.startMs + 260);
    push(beat.startMs + (beat.endMs - beat.startMs) * 0.5);
    push(beat.endMs - 240);
  }
  if (plan.kind === 'stack') {
    for (const op of plan.ops) {
      const w = op.endMs - op.startMs;
      push(op.startMs + w * 0.18);
      push(op.startMs + w * 0.55);
      push(op.startMs + w * 0.88);
    }
  } else {
    for (const window of plan.steps) {
      const w = window.endMs - window.startMs;
      push(window.startMs + w * 0.4);
      push(window.endMs - 120);
    }
  }
  return [...times].sort((a, b) => a - b);
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function outside(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x < bounds.x - 2 ||
    rect.y < bounds.y - 2 ||
    rect.x + rect.w > bounds.x + bounds.w + 2 ||
    rect.y + rect.h > bounds.y + bounds.h + 2
  );
}

function insideTarget(point: { x: number; y: number }, target: Rect, tolerance: number): boolean {
  return (
    point.x >= target.x - tolerance &&
    point.x <= target.x + target.w + tolerance &&
    point.y >= target.y - tolerance &&
    point.y <= target.y + target.h + tolerance
  );
}

export type RecordedMoment = { at: number; shapes: AuditShape[] };

/** Lays out the sampled moments and returns everything the recorder saw, per moment. */
export function recordLayout(
  plan: MotionPlan,
  dims: Dims
): { moments: RecordedMoment[]; missing: string[]; sampled: number } {
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext('2d');
  const times = sampleTimes(plan);
  const moments: RecordedMoment[] = [];
  const missing: string[] = [];

  for (const at of times) {
    beginAudit(at);
    drawMoment(ctx, plan, at, dims);
    const result = endAudit();
    moments.push({ at, shapes: result.shapes });
    for (const id of result.missingAnchors) if (!missing.includes(id)) missing.push(id);
  }
  return { moments, missing, sampled: times.length };
}

export function judgeLayout(
  plan: MotionPlan,
  dims: Dims,
  recorded: { moments: RecordedMoment[]; missing: string[] }
): SceneCheck[] {
  const k = dims.width / 1080;
  const bounds: Rect = { x: SAFE * k, y: 10 * k, w: dims.width - SAFE * 2 * k, h: dims.height - 20 * k };
  const textCount = recorded.moments.reduce(
    (sum, moment) => sum + moment.shapes.filter((shape) => shape.kind === 'text').length,
    0
  );
  const objectCount = recorded.moments.reduce(
    (sum, moment) => sum + moment.shapes.filter((shape) => shape.kind === 'object').length,
    0
  );
  const escaped: string[] = [];
  const cut: string[] = [];
  const collisions: string[] = [];
  const misaligned: string[] = [];
  let pointerCount = 0;

  // Every check runs on one moment at a time: shapes from different frames of an
  // animation never collided with each other.
  for (const moment of recorded.moments) {
    const texts = moment.shapes.filter((shape) => shape.kind === 'text' && shape.rect);
    const objects = moment.shapes.filter((shape) => shape.kind === 'object' && shape.rect);
    const pointers = moment.shapes.filter((shape) => shape.kind === 'pointer');
    const objectGroups = new Set(objects.map((shape) => shape.group));

    // 1. Contains: overlay text inside the safe area, never cut. A label drawn
    //    inside a moving object travels with it and is measured by its own box.
    for (const shape of texts) {
      if (objectGroups.has(shape.group)) {
        if (shape.truncated) cut.push(`${shape.text || ''} @${Math.round(moment.at)}ms`);
        continue;
      }
      if (outside(shape.rect as Rect, bounds)) {
        escaped.push(`${shape.text || shape.group} @${Math.round(moment.at)}ms`);
      }
      if (shape.truncated) cut.push(`${shape.text || ''} @${Math.round(moment.at)}ms`);
    }

    // 2. Collisions: text over an animated object, or two unrelated labels over each other.
    for (const text of texts) {
      const rect = text.rect as Rect;
      for (const object of objects) {
        if (object.group === text.group) continue;
        const area = overlap(rect, object.rect as Rect);
        if (area > rect.w * rect.h * 0.2 && area > 90 * k * k) {
          collisions.push(`“${text.text || ''}” over ${object.text ?? object.group} @${Math.round(moment.at)}ms`);
          break;
        }
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (texts[i].group === texts[j].group) continue;
        const area = overlap(texts[i].rect as Rect, texts[j].rect as Rect);
        const smaller = Math.min(
          (texts[i].rect as Rect).w * (texts[i].rect as Rect).h,
          (texts[j].rect as Rect).w * (texts[j].rect as Rect).h
        );
        if (area > smaller * 0.2 && area > 60 * k * k) {
          collisions.push(
            `“${texts[i].text || ''}” over “${texts[j].text || ''}” @${Math.round(moment.at)}ms`
          );
        }
      }
    }

    // 3. Pointers: every tip lands on the object it names.
    pointerCount += pointers.length;
    for (const pointer of pointers) {
      if (!pointer.target || !pointer.tail || !insideTarget(pointer.tail, pointer.target, 8 * k)) {
        misaligned.push(`${pointer.anchor} @${Math.round(moment.at)}ms`);
      }
    }
  }

  const unique = (items: string[]) => [...new Set(items)];
  const escapedList = unique(escaped);
  const cutList = unique(cut);
  const collisionList = unique(collisions);
  const misalignedList = unique(misaligned);
  const containmentOk = escapedList.length === 0 && cutList.length === 0;
  const containmentDetail = containmentOk
    ? `${textCount} text blocks checked inside the 9:16 safe area`
    : [
        escapedList.length ? `${escapedList.length} text block(s) outside the safe area (${escapedList[0]})` : '',
        cutList.length ? `${cutList.length} block(s) had to be cut (${cutList[0]})` : ''
      ]
        .filter(Boolean)
        .join('; ');

  const checks: SceneCheck[] = [
    {
      id: 'text_containment',
      label: 'Text stays inside its container',
      ok: containmentOk,
      detail: containmentDetail
    },
    {
      id: 'text_collisions',
      label: 'Text does not cover animated objects or other labels',
      ok: collisionList.length === 0,
      detail:
        collisionList.length === 0
          ? `${textCount} blocks clear of ${objectCount} objects across ${recorded.moments.length} moments`
          : collisionList.slice(0, 3).join('; ')
    },
    {
      id: 'pointer_alignment',
      label: 'Pointers land on their targets',
      ok: misalignedList.length === 0 && recorded.missing.length === 0,
      detail:
        recorded.missing.length > 0
          ? `missing anchor(s): ${recorded.missing.join(', ')}`
          : misalignedList.length === 0
            ? `${pointerCount} pointer endpoints verified against rendered bounds`
            : `${misalignedList.length} pointer(s) missed: ${misalignedList.slice(0, 3).join(', ')}`
    }
  ];
  return checks;
}

/**
 * The algorithm state the frame shows must equal the verified trace at the end of
 * every beat: the stack contents, or LOW/HIGH/MID and the matched index.
 */
export function verifyPlanStates(plan: MotionPlan): SceneCheck {
  const problems: string[] = [];

  if (plan.kind === 'stack') {
    for (const op of plan.ops) {
      const at = Math.max(op.startMs, op.endMs - 1);
      const shown = stackStateAt(plan, at);
      const expected = op.event.items;
      if (shown.items.join(',') !== expected.join(',')) {
        problems.push(
          `STEP ${op.index + 1} shows [${shown.items.join(', ')}] but the trace is [${expected.join(', ')}]`
        );
      }
      const expectedTop = expected.length ? expected[expected.length - 1] : null;
      if (shown.top !== expectedTop) {
        problems.push(`STEP ${op.index + 1} TOP shows ${String(shown.top)} but should be ${String(expectedTop)}`);
      }
    }
  } else {
    for (const window of plan.steps) {
      const at = Math.max(window.startMs, window.endMs - 1);
      const shown = binaryStateAt(plan, at);
      const step = window.step;
      if (Math.round(shown.low) !== step.nextLow || Math.round(shown.high) !== step.nextHigh) {
        problems.push(
          `comparison ${step.n} shows range ${Math.round(shown.low)}–${Math.round(shown.high)} but the trace says ${step.nextLow}–${step.nextHigh}`
        );
      }
      if (shown.mid === null || Math.round(shown.mid) !== step.mid) {
        problems.push(`comparison ${step.n} MID does not land on index ${step.mid}`);
      }
      const expectedMatch = step.comparison === 'equal' ? step.mid : null;
      if (expectedMatch !== null && shown.matched !== expectedMatch) {
        problems.push(`comparison ${step.n} should mark index ${expectedMatch} as found`);
      }
    }
  }

  const beats = plan.beats.length;
  return {
    id: 'algorithm_state',
    label: 'Pointers match the verified algorithm state',
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${plan.kind === 'stack' ? plan.ops.length : plan.steps.length} verified states across ${beats} beats match the trace`
        : problems.slice(0, 3).join('; ')
  };
}

/** Full inspection of a plan: layout geometry plus algorithm state. */
export function inspectPlan(plan: MotionPlan, dims: Dims = { width: 540, height: 960 }): SceneAudit {
  const recorded = recordLayout(plan, dims);
  const checks = [...judgeLayout(plan, dims, recorded), verifyPlanStates(plan)];
  const issues = checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.detail}`);
  return { ok: issues.length === 0, sampled: recorded.sampled, checks, issues };
}
