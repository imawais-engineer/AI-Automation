/**
 * Binary search animation.
 *
 * Five solid number blocks on one continuous stage. LOW, HIGH, MID, the active
 * range and the discarded half are all read from the verified step list, so the
 * motion cannot disagree with the trace: the markers literally move to the
 * indices the algorithm visited.
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
import {
  backdrop,
  brandEnd,
  captionBar,
  curtain,
  drawBlock,
  drawChip,
  footer,
  hudHeader,
  hudOperation,
  paletteOf,
  popCamera,
  pushCamera,
  text,
  toast,
  type Camera,
  type Dims,
  type Palette
} from './stage.ts';
import { rgba, roundRect } from '../render/paint.ts';
import { SANS } from '../render/typography.ts';

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
const STAGE_Y = 430;

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
  const foundWindow = plan.steps.find((window) => window.step.comparison === 'equal');
  const halving = plan.halving;
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity' && beat.title.toLowerCase().includes('complex'));
  if (foundWindow && tMs >= foundWindow.endMs) {
    const center = blockCenter(plan, foundWindow.step.mid);
    const push = easeInOutCubic(clamp01((tMs - foundWindow.endMs) / 900));
    return {
      x: lerp(0, center * 0.45, push),
      y: lerp(base.y, 60, push),
      zoom: lerp(base.zoom, 1.1, push)
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

function bracketAndMarkers(
  ctx: SKRSContext2D,
  plan: BinaryPlan,
  state: BinaryMarkerState,
  pal: Palette,
  alpha: number
): void {
  const lowIndex = Math.max(0, Math.min(plan.array.length - 1, Math.round(state.low)));
  const highIndex = Math.max(0, Math.min(plan.array.length - 1, Math.round(state.high)));
  const span = rangeWidth(plan, state.low, state.high);
  const y = BLOCK_TOP - 96;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Active range bracket.
  const bracket = ctx.createLinearGradient(span.x, 0, span.x + span.w, 0);
  bracket.addColorStop(0, rgba(pal.accent, 0.8));
  bracket.addColorStop(1, rgba(pal.violet, 0.8));
  ctx.strokeStyle = bracket;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(span.x, y);
  ctx.lineTo(span.x + span.w, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(span.x, y - 16);
  ctx.lineTo(span.x, y + 16);
  ctx.moveTo(span.x + span.w, y - 16);
  ctx.lineTo(span.x + span.w, y + 16);
  ctx.stroke();

  const candidates = Math.max(0, Math.round(state.high) - Math.round(state.low) + 1);
  text(ctx, `search range · ${candidates} candidate${candidates === 1 ? '' : 's'}`, (span.x + span.x + span.w) / 2, y - 34, {
    size: 26,
    color: rgba(pal.ink, 0.6),
    mono: true,
    align: 'center'
  });

  // LOW / HIGH markers with stems to their blocks.
  const width = blockWidth(plan.array.length);
  const lowX = blockCenter(plan, lowIndex) - width / 2;
  const highX = blockCenter(plan, highIndex) + width / 2;
  const markerY = y + 66;
  for (const marker of [
    { x: lowX, label: 'LOW', color: pal.accent, index: lowIndex },
    { x: highX, label: 'HIGH', color: pal.violet, index: highIndex }
  ]) {
    ctx.strokeStyle = rgba(marker.color, 0.7);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(marker.x, markerY);
    ctx.lineTo(marker.x, BLOCK_TOP - 4);
    ctx.stroke();
    drawChip(ctx, marker.x, markerY, `${marker.label} ${marker.index}`, {
      size: 22,
      color: marker.color,
      align: 'center'
    });
  }

  if (state.mid !== null) {
    const midX = blockCenter(plan, state.mid);
    const midIndex = Math.round(state.mid);
    const active = state.matched !== null ? pal.coral : pal.ink;
    ctx.strokeStyle = rgba(active, 0.55);
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, markerY - 20);
    ctx.lineTo(midX, BLOCK_TOP - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    drawChip(ctx, midX, markerY - 48, `MID ${midIndex}`, {
      size: 22,
      color: state.matched !== null ? pal.coral : pal.ink,
      align: 'center',
      filled: state.matched !== null
    });
  }

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
  const midX = blockCenter(plan, step.mid);
  const y = BLOCK_TOP - 196;
  const lift = bump(tMs, active.startMs + (active.endMs - active.startMs) * 0.3, (active.endMs - active.startMs) * 0.6);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, -lift * 8);
  drawChip(ctx, midX, y, `${step.midValue} ${symbol} ${step.target}`, {
    size: 34,
    color: step.comparison === 'equal' ? pal.coral : pal.ink,
    align: 'center',
    filled: step.comparison === 'equal'
  });
  if (state.comparing !== null) {
    ctx.strokeStyle = rgba(pal.accent, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, y + 34);
    ctx.lineTo(midX, BLOCK_TOP - 80);
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
  const h = 340 * k;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba('#050a12', 0.88);
  roundRect(ctx, x, y, w, h, 28 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.28);
  ctx.lineWidth = 2 * k;
  ctx.stroke();

  text(ctx, 'EACH COMPARISON HALVES THE RANGE', x + 34 * k, y + 54 * k, {
    size: 24 * k,
    color: rgba(pal.ink, 0.55),
    mono: true
  });

  // n → n/2 → n/4 bars, drawn from the real array size.
  const sizes = [plan.array.length, Math.ceil(plan.array.length / 2), Math.ceil(plan.array.length / 4), 1];
  const barW = w - 68 * k;
  sizes.forEach((size, index) => {
    const appear = track(p, 0.08 + index * 0.12, 0.3 + index * 0.12);
    if (appear <= 0) return;
    const ratio = size / plan.array.length;
    const rowY = y + 104 * k + index * 52 * k;
    ctx.fillStyle = rgba(pal.accent, 0.16);
    roundRect(ctx, x + 34 * k, rowY, barW * ratio * easeOutCubic(appear), 28 * k, 14 * k);
    ctx.fill();
    text(ctx, `${size}`, x + 34 * k + barW * ratio + 18 * k, rowY + 22 * k, {
      size: 24 * k,
      color: rgba(pal.ink, 0.7),
      mono: true,
      alpha: appear
    });
  });

  text(ctx, `${plan.steps.length} comparisons for ${plan.array.length} elements`, x + 34 * k, y + h - 74 * k, {
    size: 30 * k,
    color: pal.ink,
    weight: 700
  });
  drawChip(ctx, x + w - 34 * k, y + h - 84 * k, `TIME ${plan.copy.time || 'O(log n)'}`, {
    size: 24 * k,
    color: pal.accent,
    align: 'right'
  });
  drawChip(ctx, x + w - 34 * k, y + h - 30 * k, `SPACE ${plan.copy.space || 'O(1)'}`, {
    size: 24 * k,
    color: pal.violet,
    align: 'right'
  });
  ctx.restore();
}

/** Draws one moment of the binary search short. */
export function drawBinary(ctx: SKRSContext2D, plan: BinaryPlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const cam = cameraFor(plan, tMs);
  const state = binaryStateAt(plan, tMs);
  const brandBeat = plan.beats.find((item) => item.key === 'brand');
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);
  const traceBeat = plan.beats.find((item) => item.title.toLowerCase().includes('trace'));

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

  const arrayAlpha = clamp01((tMs - (plan.beats[0]?.startMs ?? 0) - 200) / 700) * (inBrand ? 0.4 : 1);

  plan.array.forEach((value, index) => {
    const center = blockCenter(plan, index);
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
      x: center - BLOCK_W / 2,
      y: BLOCK_TOP + discarded * 26,
      w: BLOCK_W,
      h: BLOCK_H,
      value,
      pal,
      tone,
      alpha: arrayAlpha * (1 - discarded * 0.66),
      scale: isMatch ? 1 + 0.05 * bump(tMs, (plan.steps[plan.steps.length - 1]?.endMs ?? 0) - 300, 900) : 1,
      glow,
      valueSize: BLOCK_W * 0.47
    });

    text(ctx, String(index), center, BLOCK_TOP + BLOCK_H + 58 + discarded * 26, {
      size: 28,
      color: rgba(pal.ink, inRange ? 0.62 : 0.26),
      mono: true,
      align: 'center',
      alpha: arrayAlpha
    });
  });

  // Discarded half: a struck-through band, still legible for context.
  if (state.eliminated.size > 0) {
    const discardedIndices = [...state.eliminated.entries()];
    const progress = Math.max(...discardedIndices.map(([, value]) => value));
    for (const [index, value] of discardedIndices) {
      if (value <= 0.15) continue;
      const center = blockCenter(plan, index);
      ctx.save();
      ctx.globalAlpha = (1 - value * 0.7) * arrayAlpha * 0.9;
      ctx.strokeStyle = rgba(pal.coral, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(center - BLOCK_W / 2 + 18, BLOCK_TOP + BLOCK_H - 24 + value * 26);
      ctx.lineTo(center + BLOCK_W / 2 - 18, BLOCK_TOP + 24 + value * 26);
      ctx.stroke();
      ctx.restore();
    }
    if (progress > 0.6) {
      const discardedX =
        discardedIndices.reduce((sum, [index]) => sum + blockCenter(plan, index), 0) / discardedIndices.length;
      text(ctx, 'discarded', discardedX, BLOCK_TOP + BLOCK_H + 116, {
        size: 24,
        color: rgba(pal.coral, 0.7),
        mono: true,
        align: 'center',
        alpha: arrayAlpha * 0.9
      });
    }
  }

  if (!inBrand) {
    bracketAndMarkers(ctx, plan, state, pal, arrayAlpha);
    comparisonCallout(ctx, plan, state, pal, tMs, arrayAlpha);
  }

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  const headerAlpha = 1 - track(tMs, (brandBeat?.startMs ?? Infinity), (brandBeat?.startMs ?? Infinity) + 300);
  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.name,
    step: 'BINARY SEARCH',
    alpha: headerAlpha
  });

  const k = dims.width / 1080;
  const activeStep = plan.steps.find((window) => tMs >= window.startMs && tMs < window.endMs);

  const targetAlpha = clamp01((tMs - (plan.beats[0]?.startMs ?? 0)) / 700) * (inBrand ? 0.25 : 1);
  drawChip(ctx, 64 * k, 290 * k, `TARGET ${plan.target}`, {
    size: 26 * k,
    color: pal.coral,
    align: 'left',
    filled: true,
    alpha: targetAlpha
  });
  if (plan.foundIndex !== null) {
    drawChip(ctx, dims.width - 64 * k, 290 * k, `SORTED · ${plan.array.length} VALUES`, {
      size: 22 * k,
      color: pal.accent,
      align: 'right',
      alpha: targetAlpha * 0.95
    });
  }

  const hookBeat = plan.beats.find((item) => item.key === 'intro');
  const setupBeat = plan.beats.find((item) => item.key === 'setup');

  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${Math.round(72 * k)}px ${SANS}`;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = 'left';
    const words = (plan.copy.hook || 'Check the middle, discard half, repeat.').split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > dims.width - 150 * k && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((item, index) => ctx.fillText(item, 64 * k, 420 * k + index * 86 * k));
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
  }

  if (traceBeat && tMs >= traceBeat.startMs && tMs < traceBeat.endMs) {
    const alpha = envelope(tMs, traceBeat.startMs, traceBeat.endMs, 240, 260);
    if (activeStep) {
      const step = activeStep.step;
      hudOperation(ctx, dims, pal, {
        label: `MID = floor((${step.low} + ${step.high}) / 2) = ${step.mid}`,
        detail: `low ${step.low} · high ${step.high} · a[${step.mid}] = ${step.midValue} vs target ${step.target}`,
        alpha,
        y: 200
      });
      const found = step.comparison === 'equal';
      const foundAt = activeStep.startMs + (activeStep.endMs - activeStep.startMs) * 0.55;
      toast(ctx, dims, pal, {
        text: found ? `FOUND · INDEX ${step.mid}` : `${step.midValue} ${step.comparison === 'less' ? '<' : '>'} ${step.target}`,
        sub: found
          ? `${activeStep.index + 1} comparisons · verified trace`
          : step.comparison === 'less'
            ? `too small — discard indices < ${step.nextLow}`
            : `too large — discard indices > ${step.nextHigh}`,
        color: found ? pal.coral : pal.accent,
        alpha: found
          ? envelope(tMs, foundAt, activeStep.endMs + 700, 220, 260)
          : envelope(tMs, activeStep.startMs + 200, activeStep.endMs - 100, 220, 260),
        y: 590
      });
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
    mark: plan.brand.watermark || plan.brand.name,
    alpha: headerAlpha
  });
}
