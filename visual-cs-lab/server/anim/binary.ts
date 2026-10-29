/**
 * Binary search animation.
 *
 * Five solid number blocks on one continuous stage. LOW, HIGH, MID, the active
 * range and the discarded half are all read from the verified step list, so the
 * motion cannot disagree with the trace: the markers literally move to the
 * indices the algorithm visited.
 *
 * Each marker is anchored to the rendered bounds of its block, and the labels are
 * placed as a row that never overlaps itself — LOW, HIGH and MID always sit over
 * the block they name, even when all three land on the same index.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import {
  bump,
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  envelope,
  lerp,
  track
} from './easing.ts';
import type { Beat, BinaryPlan } from './plan.ts';
import type { Rect } from './anchors.ts';
import {
  BAND,
  SAFE,
  backdrop,
  brandEnd,
  captionBar,
  curtain,
  drawBlock,
  drawChip,
  footer,
  hudHeader,
  hudOperation,
  openingReveal,
  paletteOf,
  popCamera,
  pushCamera,
  safeBox,
  subjectSilhouette,
  toast,
  type Camera,
  type Dims,
  type Palette
} from './stage.ts';
import { drawText, textWidth } from '../render/layout.ts';
import { recordPointer } from './audit.ts';
import { rgba, roundRect } from '../render/paint.ts';

/** Widest block, and the widest row that still fits inside the safe margin. */
const BLOCK_W_MAX = 158;
const BLOCK_W_MIN = 96;
const BLOCK_H = 168;
const GAP = 22;
const ROW_MAX = 900;

/** Block width for the array length: long arrays shrink to keep the row readable. */
export function blockWidth(count: number): number {
  if (count <= 1) return BLOCK_W_MAX;
  return Math.max(BLOCK_W_MIN, Math.min(BLOCK_W_MAX, (ROW_MAX - (count - 1) * GAP) / count));
}
const BLOCK_TOP = -70;
const MARKER_Y = BLOCK_TOP - 56;
const BRACKET_Y = BLOCK_TOP - 160;
const RANGE_LABEL_Y = BLOCK_TOP - 196;
const CALLOUT_Y = BLOCK_TOP - 250;

export type BinaryMarkerState = {
  low: number;
  high: number;
  /** Fractional while the MID marker travels to the next index. */
  mid: number | null;
  /** Index → how far it has been discarded (0 = active, 1 = fully dimmed). */
  eliminated: Map<number, number>;
  matched: number | null;
  comparing: number | null;
};

function blockCenter(plan: BinaryPlan, index: number): number {
  const width = blockWidth(plan.array.length);
  const total = plan.array.length * width + (plan.array.length - 1) * GAP;
  return -total / 2 + index * (width + GAP) + width / 2;
}

/** The rendered rect of one block at the current moment. */
function blockRect(plan: BinaryPlan, index: number, discarded = 0): Rect {
  const width = blockWidth(plan.array.length);
  return {
    x: blockCenter(plan, index) - width / 2,
    y: BLOCK_TOP + discarded * 26,
    w: width,
    h: BLOCK_H
  };
}

function rangeWidth(plan: BinaryPlan, from: number, to: number): { x: number; w: number } {
  const width = blockWidth(plan.array.length);
  const left = blockCenter(plan, from) - width / 2;
  const right = blockCenter(plan, to) + width / 2;
  return { x: left, w: Math.max(0, right - left) };
}

/** The algorithm state the picture is showing at `t`. */
export function binaryStateAt(plan: BinaryPlan, tMs: number): BinaryMarkerState {
  const last = plan.array.length - 1;
  let low = 0;
  let high = last;
  let mid: number | null = null;
  let matched: number | null = null;
  let comparing: number | null = null;
  const eliminated = new Map<number, number>();

  for (const window of plan.steps) {
    const step = window.step;
    const w = Math.max(1, window.endMs - window.startMs);

    if (tMs >= window.endMs) {
      low = step.nextLow;
      high = step.nextHigh;
      mid = step.mid;
      step.eliminated.forEach((index) => eliminated.set(index, 1));
      if (step.comparison === 'equal') matched = step.mid;
      continue;
    }
    if (tMs < window.startMs) break;

    const midTravel = easeInOutCubic(track(tMs, window.startMs + w * 0.04, window.startMs + w * 0.3));
    mid = lerp(mid ?? step.mid, step.mid, midTravel);
    const compare = track(tMs, window.startMs + w * 0.3, window.startMs + w * 0.52);
    if (compare > 0) comparing = step.mid;
    step.eliminated.forEach((index) => {
      const progress = track(tMs, window.startMs + w * 0.5, window.startMs + w * 0.74);
      if (progress > 0) eliminated.set(index, progress);
    });
    const bounds = easeInOutCubic(track(tMs, window.startMs + w * 0.62, window.startMs + w * 0.92));
    low = lerp(step.low, step.nextLow, bounds);
    high = lerp(step.high, step.nextHigh, bounds);
    if (step.comparison === 'equal' && tMs >= window.startMs + w * 0.52) matched = step.mid;
    break;
  }

  return { low, high, mid, eliminated, matched, comparing };
}

function cameraFor(plan: BinaryPlan, tMs: number): Camera {
  const base = { x: 0, y: 30, zoom: 1.02 };
  const opening = plan.beats.find((beat) => beat.key === 'open');
  if (opening && tMs < opening.endMs) {
    // The opening settles the camera: a slow push-in ends exactly as the array appears.
    const p = easeInOutCubic(clamp01((tMs - opening.startMs) / Math.max(1, opening.endMs - opening.startMs)));
    return { x: 0, y: lerp(74, base.y, p), zoom: lerp(1.07, base.zoom, p) };
  }
  const foundWindow = plan.steps.find((window) => window.step.comparison === 'equal');
  const halving = plan.halving;
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity' && beat.title.toLowerCase().includes('complex'));
  if (foundWindow && tMs >= foundWindow.endMs) {
    const center = blockCenter(plan, foundWindow.step.mid);
    const push = easeInOutCubic(clamp01((tMs - foundWindow.endMs) / 900));
    // A small push-in only: the whole row must stay inside the safe margins.
    return {
      x: lerp(0, center * 0.1, push),
      y: lerp(base.y, 46, push),
      zoom: lerp(base.zoom, 1.03, push)
    };
  }
  if (halving && tMs >= halving.startMs) {
    const p = easeInOutCubic(clamp01((tMs - halving.startMs) / 800));
    return { x: 0, y: lerp(base.y, 70, p), zoom: lerp(base.zoom, 0.98, p) };
  }
  if (complexityBeat && tMs >= complexityBeat.startMs) {
    return { x: 0, y: 20, zoom: 0.98 };
  }
  return {
    x: Math.sin(tMs / 5600) * 10,
    y: base.y + Math.sin(tMs / 3800) * 5,
    zoom: base.zoom
  };
}

type MarkerSpec = {
  key: 'low' | 'high' | 'mid';
  index: number;
  label: string;
  color: string;
  filled?: boolean;
};

type PlacedMarker = MarkerSpec & { rect: Rect; stemX: number };

/**
 * Lays the LOW / HIGH / MID labels out as one row: each chip is centred over the
 * index it names, clamped into the frame, and pushed aside only when another chip
 * would overlap it. The stem is drawn from the chip to the true column, so a
 * shifted chip never pretends to point somewhere else.
 */
function layoutMarkers(
  ctx: SKRSContext2D,
  plan: BinaryPlan,
  markers: MarkerSpec[],
  bounds: Rect
): PlacedMarker[] {
  const size = 22;
  const gap = 10;
  const withWidth = markers
    .map((marker) => {
      const w = Math.round(textWidth(ctx, marker.label, 'mono', 600, size) + 30);
      return { ...marker, w, h: 44 };
    })
    .sort((a, b) => blockCenter(plan, a.index) - blockCenter(plan, b.index));

  let cursor = bounds.x;
  return withWidth.map((marker) => {
    const stemX = blockCenter(plan, marker.index);
    let x = stemX - marker.w / 2;
    x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - marker.w, x));
    if (x < cursor) x = cursor;
    if (x + marker.w > bounds.x + bounds.w) x = bounds.x + bounds.w - marker.w;
    cursor = x + marker.w + gap;
    return {
      key: marker.key,
      index: marker.index,
      label: marker.label,
      color: marker.color,
      filled: marker.filled,
      rect: { x, y: MARKER_Y - marker.h / 2, w: marker.w, h: marker.h },
      stemX
    };
  });
}

function drawMarkers(
  ctx: SKRSContext2D,
  plan: BinaryPlan,
  state: BinaryMarkerState,
  pal: Palette,
  alpha: number
): void {
  const last = plan.array.length - 1;
  const lowIndex = Math.max(0, Math.min(last, Math.round(state.low)));
  const highIndex = Math.max(0, Math.min(last, Math.round(state.high)));
  const midIndex = state.mid === null ? null : Math.max(0, Math.min(last, Math.round(state.mid)));
  const bounds: Rect = { x: -ROW_MAX / 2 - 40, y: -900, w: ROW_MAX + 80, h: 1000 };

  const specs: MarkerSpec[] = [
    { key: 'low', index: lowIndex, label: `LOW ${lowIndex}`, color: pal.accent },
    { key: 'high', index: highIndex, label: `HIGH ${highIndex}`, color: pal.violet }
  ];
  if (midIndex !== null) {
    specs.push({
      key: 'mid',
      index: midIndex,
      label: `MID ${midIndex}`,
      color: state.matched !== null ? pal.coral : pal.ink,
      filled: state.matched !== null
    });
  }

  const placed = layoutMarkers(ctx, plan, specs, bounds);

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const marker of placed) {
    const target = blockRect(plan, marker.index);
    const tail = { x: marker.stemX, y: target.y };
    const head = { x: marker.rect.x + marker.rect.w / 2, y: marker.rect.y + marker.rect.h };

    // Leader line: a straight stem when the chip is over its column, an elbow
    // when it had to move aside — the endpoint stays on the named block.
    ctx.strokeStyle = rgba(marker.color, 0.72);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tail.x, tail.y - 18);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();

    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.arc(tail.x, tail.y, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = marker.filled ? marker.color : rgba('#060b14', 0.9);
    roundRect(ctx, marker.rect.x, marker.rect.y, marker.rect.w, marker.rect.h, marker.rect.h / 2);
    ctx.fill();
    ctx.strokeStyle = marker.filled ? rgba('#000000', 0.18) : rgba(marker.color, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();

    drawText(ctx, marker.label, {
      box: { x: marker.rect.x + 6, y: marker.rect.y, w: marker.rect.w - 12, h: marker.rect.h },
      role: 'mono',
      weight: 600,
      size: 22,
      minSize: 16,
      maxLines: 1,
      align: 'center',
      valign: 'middle',
      color: marker.filled ? '#06101a' : marker.color,
      alpha,
      group: `marker-${marker.key}`
    });

    recordPointer(ctx, `marker-${marker.key}`, {
      anchor: `index:${marker.index}`,
      tail,
      head,
      target
    });
  }

  // Active range bracket, drawn under the marker row.
  const span = rangeWidth(plan, state.low, state.high);
  const bracket = ctx.createLinearGradient(span.x, 0, span.x + span.w, 0);
  bracket.addColorStop(0, rgba(pal.accent, 0.85));
  bracket.addColorStop(1, rgba(pal.violet, 0.85));
  ctx.strokeStyle = bracket;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(span.x, BRACKET_Y);
  ctx.lineTo(span.x + span.w, BRACKET_Y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(span.x, BRACKET_Y - 15);
  ctx.lineTo(span.x, BRACKET_Y + 15);
  ctx.moveTo(span.x + span.w, BRACKET_Y - 15);
  ctx.lineTo(span.x + span.w, BRACKET_Y + 15);
  ctx.stroke();

  const candidates = Math.max(0, Math.round(state.high) - Math.round(state.low) + 1);
  const labelW = Math.min(ROW_MAX, Math.max(span.w + 120, 300));
  const labelCenter = Math.max(-ROW_MAX / 2 + labelW / 2, Math.min(ROW_MAX / 2 - labelW / 2, span.x + span.w / 2));
  drawText(ctx, `search range · ${candidates} candidate${candidates === 1 ? '' : 's'}`, {
    box: { x: labelCenter - labelW / 2, y: RANGE_LABEL_Y - 20, w: labelW, h: 40 },
    role: 'mono',
    weight: 400,
    size: 24,
    minSize: 17,
    maxLines: 1,
    align: 'center',
    color: rgba(pal.ink, 0.62),
    alpha,
    group: 'range-label'
  });
  ctx.restore();
}

function comparisonCallout(
  ctx: SKRSContext2D,
  plan: BinaryPlan,
  state: BinaryMarkerState,
  pal: Palette,
  tMs: number,
  alpha: number
): void {
  const active = plan.steps.find((window) => tMs >= window.startMs && tMs < window.endMs);
  if (!active || alpha <= 0.01) return;
  const step = active.step;
  const symbol = step.comparison === 'less' ? '<' : step.comparison === 'greater' ? '>' : '=';
  const label = `a[${step.mid}] = ${step.midValue} ${symbol} ${step.target}`;
  const midX = blockCenter(plan, step.mid);
  const lift = bump(tMs, active.startMs + (active.endMs - active.startMs) * 0.3, (active.endMs - active.startMs) * 0.6);
  const color = step.comparison === 'equal' ? pal.coral : pal.ink;
  const width = Math.min(ROW_MAX, textWidth(ctx, label, 'mono', 600, 30) + 56);
  const x = Math.max(-ROW_MAX / 2, Math.min(ROW_MAX / 2 - width, midX - width / 2));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, -lift * 8);
  drawChip(ctx, x, CALLOUT_Y, label, {
    size: 30,
    color,
    align: 'left',
    filled: step.comparison === 'equal',
    maxWidth: width,
    group: 'callout'
  });
  if (state.comparing !== null) {
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, CALLOUT_Y + 26);
    ctx.lineTo(midX, BLOCK_TOP - 74);
    ctx.stroke();
  }
  ctx.restore();
}

function halvingPanel(
  ctx: SKRSContext2D,
  dims: Dims,
  plan: BinaryPlan,
  pal: Palette,
  beat: Beat,
  tMs: number
): void {
  const k = dims.width / 1080;
  const alpha = envelope(tMs, beat.startMs, beat.endMs, 300, 320);
  if (alpha <= 0.01) return;
  const p = clamp01((tMs - beat.startMs) / Math.max(1, beat.endMs - beat.startMs));

  const x = 80 * k;
  const w = dims.width - 160 * k;
  const y = 300 * k;
  const h = 360 * k;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba('#050a12', 0.9);
  roundRect(ctx, x, y, w, h, 28 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.28);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, 'EACH COMPARISON HALVES THE RANGE', {
    box: { x: x + 34 * k, y: y + 30 * k, w: w - 68 * k, h: 34 * k },
    role: 'mono',
    weight: 400,
    size: 23 * k,
    minSize: 16 * k,
    maxLines: 1,
    color: rgba(pal.ink, 0.6),
    alpha,
    group: 'halving'
  });

  // n → n/2 → n/4 bars, drawn from the real array size.
  const sizes = [plan.array.length, Math.ceil(plan.array.length / 2), Math.ceil(plan.array.length / 4), 1];
  const barW = w - 68 * k - 90 * k;
  sizes.forEach((size, index) => {
    const appear = track(p, 0.08 + index * 0.12, 0.3 + index * 0.12);
    if (appear <= 0) return;
    const ratio = size / plan.array.length;
    const rowY = y + 92 * k + index * 56 * k;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(pal.accent, 0.18);
    roundRect(ctx, x + 34 * k, rowY, Math.max(6, barW * ratio * easeOutCubic(appear)), 30 * k, 15 * k);
    ctx.fill();
    ctx.restore();
    drawText(ctx, `${size}`, {
      box: { x: x + 34 * k + barW + 16 * k, y: rowY + 2 * k, w: 60 * k, h: 30 * k },
      role: 'mono',
      weight: 600,
      size: 22 * k,
      minSize: 16 * k,
      maxLines: 1,
      color: rgba(pal.ink, 0.78),
      alpha: alpha * appear,
      group: 'halving'
    });
  });

  drawText(ctx, `${plan.steps.length} comparisons for ${plan.array.length} elements`, {
    box: { x: x + 34 * k, y: y + h - 92 * k, w: w - 68 * k, h: 40 * k },
    role: 'text',
    weight: 500,
    size: 28 * k,
    minSize: 19 * k,
    maxLines: 1,
    color: pal.ink,
    alpha,
    group: 'halving'
  });
  drawChip(ctx, x + 34 * k, y + h - 40 * k, `TIME ${plan.copy.time || 'O(log n)'}`, {
    size: 22 * k,
    color: pal.accent,
    align: 'left',
    maxWidth: (w - 68 * k) / 2,
    alpha,
    group: 'halving'
  });
  drawChip(ctx, x + w - 34 * k, y + h - 40 * k, `SPACE ${plan.copy.space || 'O(1)'}`, {
    size: 22 * k,
    color: pal.violet,
    align: 'right',
    maxWidth: (w - 68 * k) / 2,
    alpha,
    group: 'halving'
  });
}

/** Draws one moment of the binary search short. */
export function drawBinary(ctx: SKRSContext2D, plan: BinaryPlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const cam = cameraFor(plan, tMs);
  const state = binaryStateAt(plan, tMs);
  const brandBeat = plan.beats.find((item) => item.key === 'brand');
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);
  const traceBeat = plan.beats.find((item) => item.title.toLowerCase().includes('trace'));
  const openBeat = plan.beats.find((item) => item.key === 'open');
  const inOpening = Boolean(openBeat && tMs >= openBeat.startMs && tMs < openBeat.endMs);
  const k = dims.width / 1080;

  backdrop(ctx, dims, cam, pal, tMs, { horizon: -420, glow: inBrand ? 0.6 : 1 });

  pushCamera(ctx, dims, cam);
  // The array sits on a lit baseline rather than a plinth: the blocks are the
  // subject, and a platform would leave a large empty object under them.
  const BLOCK_W = blockWidth(plan.array.length);
  const total = plan.array.length * BLOCK_W + (plan.array.length - 1) * GAP;
  const baseline = BLOCK_TOP + BLOCK_H + 96;
  const pool = ctx.createRadialGradient(0, baseline + 24, 20, 0, baseline + 24, total * 0.62);
  pool.addColorStop(0, rgba(pal.accent, inBrand ? 0.05 : 0.14));
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, baseline + 26, total * 0.62, 90, 0, 0, Math.PI * 2);
  ctx.fill();

  const rule = ctx.createLinearGradient(-total / 2, 0, total / 2, 0);
  rule.addColorStop(0, rgba(pal.accent, 0));
  rule.addColorStop(0.5, rgba(pal.accent, inBrand ? 0.18 : 0.5));
  rule.addColorStop(1, rgba(pal.accent, 0));
  ctx.fillStyle = rule;
  ctx.fillRect(-total / 2 + 10, baseline, total - 20, 3);

  // The array arrives as the opening hands over, so the title is never drawn over
  // the data it introduces.
  const arrayStart = openBeat ? openBeat.endMs - 300 : (plan.beats[0]?.startMs ?? 0) + 200;
  // The array leaves with the lesson: by the time the closing name is on screen the
  // stage is clear behind it.
  const stageFade = brandBeat ? 1 - track(tMs, brandBeat.startMs, brandBeat.startMs + 420) : 1;
  const arrayAlpha = clamp01((tMs - arrayStart) / 700) * stageFade;
  if (inOpening && openBeat) {
    const glow =
      easeOutCubic(track(tMs, openBeat.startMs + 120, openBeat.startMs + 720)) *
      (1 - track(tMs, openBeat.endMs - 460, openBeat.endMs));
    subjectSilhouette(ctx, 'binary', pal, glow * 0.6);
  }

  plan.array.forEach((value, index) => {
    // A block that is barely visible is not drawn at all: nothing off screen may
    // be recorded, or it would be reported as colliding with the opening title.
    if (arrayAlpha <= 0.15) return;
    const rect = blockRect(plan, index, state.eliminated.get(index) ?? 0);
    const discarded = state.eliminated.get(index) ?? 0;
    const isMid = state.comparing === index || (state.mid !== null && Math.round(state.mid) === index);
    const isMatch = state.matched === index;
    const tone = isMatch ? 'match' : isMid ? 'active' : discarded > 0.2 ? 'dim' : 'normal';
    const inRange = index >= Math.round(state.low) && index <= Math.round(state.high);
    const glow = isMatch
      ? 1
      : isMid && state.comparing !== null
        ? 0.75
        : inRange
          ? 0.18
          : 0;

    drawBlock(ctx, {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      value,
      pal,
      tone,
      alpha: arrayAlpha * (1 - discarded * 0.66),
      scale: isMatch ? 1 + 0.05 * bump(tMs, (plan.steps[plan.steps.length - 1]?.endMs ?? 0) - 300, 900) : 1,
      glow,
      valueSize: BLOCK_W * 0.44,
      group: `index:${index}`
    });

    drawText(ctx, String(index), {
      box: { x: rect.x - 12, y: BLOCK_TOP + BLOCK_H + 30 + discarded * 26, w: rect.w + 24, h: 34 },
      role: 'mono',
      weight: 400,
      size: 26,
      minSize: 17,
      maxLines: 1,
      align: 'center',
      color: rgba(pal.ink, inRange ? 0.64 : 0.28),
      alpha: arrayAlpha,
      group: 'index-label'
    });
  });

  // Discarded half: a struck-through band, still legible for context.
  if (state.eliminated.size > 0) {
    const discardedIndices = [...state.eliminated.entries()];
    const progress = Math.max(...discardedIndices.map(([, value]) => value));
    for (const [index, value] of discardedIndices) {
      if (value <= 0.15) continue;
      const rect = blockRect(plan, index, value);
      ctx.save();
      ctx.globalAlpha = (1 - value * 0.7) * arrayAlpha * 0.9;
      ctx.strokeStyle = rgba(pal.coral, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rect.x + 18, rect.y + rect.h - 24);
      ctx.lineTo(rect.x + rect.w - 18, rect.y + 24);
      ctx.stroke();
      ctx.restore();
    }
    if (progress > 0.6) {
      const discardedX =
        discardedIndices.reduce((sum, [index]) => sum + blockCenter(plan, index), 0) / discardedIndices.length;
      const width = Math.min(ROW_MAX, 240);
      const labelX = Math.max(-ROW_MAX / 2, Math.min(ROW_MAX / 2 - width, discardedX - width / 2));
      drawText(ctx, 'discarded', {
        box: { x: labelX, y: BLOCK_TOP + BLOCK_H + 108, w: width, h: 36 },
        role: 'mono',
        weight: 400,
        size: 23,
        minSize: 16,
        maxLines: 1,
        align: 'center',
        color: rgba(pal.coral, 0.8),
        alpha: arrayAlpha * 0.9,
        group: 'discarded'
      });
    }
  }

  // Markers belong to the lesson, not to the opening frame.
  if (!inBrand && !inOpening) {
    drawMarkers(ctx, plan, state, pal, arrayAlpha);
    comparisonCallout(ctx, plan, state, pal, tMs, arrayAlpha);
  }

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  const openFade = openBeat ? track(tMs, openBeat.endMs - 180, openBeat.endMs + 120) : 1;
  const headerAlpha = Math.min(
    1 - track(tMs, (brandBeat?.startMs ?? Infinity), (brandBeat?.startMs ?? Infinity) + 300),
    openFade
  );
  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.presenter,
    step: 'BINARY SEARCH',
    alpha: headerAlpha
  });

  if (inOpening && openBeat) {
    openingReveal(ctx, dims, pal, plan.opening, tMs, openBeat);
  }

  const activeStep = plan.steps.find((window) => tMs >= window.startMs && tMs < window.endMs);

  const targetAlpha =
    clamp01((tMs - (openBeat ? openBeat.endMs - 300 : (plan.beats[0]?.startMs ?? 0))) / 700) *
    (inBrand ? 0.25 : 1);
  drawChip(ctx, SAFE * k, BAND.kicker * k, `TARGET ${plan.target}`, {
    size: 24 * k,
    color: pal.coral,
    align: 'left',
    filled: true,
    alpha: targetAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.45,
    group: 'kicker'
  });
  drawChip(ctx, dims.width - SAFE * k, BAND.kicker * k, `SORTED · ${plan.array.length} VALUES`, {
    size: 21 * k,
    color: pal.accent,
    align: 'right',
    alpha: targetAlpha * 0.95,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.45,
    group: 'kicker'
  });

  const hookBeat = plan.beats.find((item) => item.key === 'intro');
  const setupBeat = plan.beats.find((item) => item.key === 'setup');

  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const p = clamp01((tMs - hookBeat.startMs) / Math.max(1, hookBeat.endMs - hookBeat.startMs));
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    const rise = (1 - easeOutCubic(track(p, 0, 0.42))) * 26 * k;
    const box = safeBox(k, BAND.hookTop, BAND.hookBottom);
    const fitted = drawText(ctx, plan.copy.hook || 'Check the middle, discard half, repeat.', {
      box: { ...box, y: box.y + rise },
      role: 'display',
      weight: 700,
      size: 88 * k,
      minSize: 44 * k,
      maxLines: 4,
      lineHeight: 1.12,
      color: pal.ink,
      alpha,
      group: 'hook'
    });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba(pal.coral, 0.9);
    ctx.lineWidth = 5 * k;
    const grow = easeOutCubic(track(p, 0.2, 0.6));
    const ruleY = box.y + rise + fitted.height + 22 * k;
    ctx.beginPath();
    ctx.moveTo(SAFE * k, ruleY);
    ctx.lineTo(SAFE * k + 200 * k * grow, ruleY);
    ctx.stroke();
    ctx.restore();
  }

  if (setupBeat && tMs >= setupBeat.startMs && tMs < setupBeat.endMs) {
    const alpha = envelope(tMs, setupBeat.startMs, setupBeat.endMs, 240, 280);
    hudOperation(ctx, dims, pal, {
      label: 'Sorted input required',
      detail: 'halving only works because the values are ordered',
      alpha,
      accent: pal.coral
    });
    captionBar(ctx, dims, pal, { text: setupBeat.caption || plan.copy.objective, alpha });
  }

  if (traceBeat && tMs >= traceBeat.startMs && tMs < traceBeat.endMs) {
    const alpha = envelope(tMs, traceBeat.startMs, traceBeat.endMs, 240, 260);
    if (activeStep) {
      const step = activeStep.step;
      hudOperation(ctx, dims, pal, {
        label: `mid = floor((${step.low} + ${step.high}) / 2) = ${step.mid}`,
        detail: `low ${step.low} · high ${step.high} · a[${step.mid}] = ${step.midValue} vs ${step.target}`,
        alpha
      });
      const found = step.comparison === 'equal';
      const foundAt = activeStep.startMs + (activeStep.endMs - activeStep.startMs) * 0.55;
      if (found) {
        toast(ctx, dims, pal, {
          text: `FOUND · INDEX ${step.mid}`,
          sub: `${activeStep.index + 1} comparisons · verified trace`,
          color: pal.coral,
          alpha: envelope(tMs, foundAt, activeStep.endMs + 700, 220, 260)
        });
      }
      captionBar(ctx, dims, pal, { text: step.message, alpha });
    } else if (plan.traceIntro && tMs >= plan.traceIntro.startMs) {
      hudOperation(ctx, dims, pal, {
        label: 'mid = floor((low + high) / 2)',
        detail: 'inclusive bounds · zero-based indices',
        alpha
      });
      captionBar(ctx, dims, pal, {
        text: `Sorted array of ${plan.array.length}. Search for ${plan.target}.`,
        alpha
      });
    }
  }

  const complexityBeat = plan.beats.find(
    (item) => item.key === 'complexity' && !item.title.toLowerCase().includes('trace')
  );
  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    curtain(ctx, dims, pal, 0.28);
    halvingPanel(ctx, dims, plan, pal, complexityBeat, tMs);
    captionBar(ctx, dims, pal, {
      text: `O(log n) time · ${plan.copy.space || 'O(1)'} auxiliary space for this iterative version.`,
      alpha: envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 260, 300)
    });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = clamp01((tMs - brandBeat.startMs) / Math.max(1, brandBeat.endMs - brandBeat.startMs));
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.24)) * 0.88);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }

  footer(ctx, dims, pal, {
    progress: plan.durationMs > 0 ? tMs / plan.durationMs : 0,
    mark: plan.brand.watermark || plan.brand.presenter,
    alpha: headerAlpha
  });
}
