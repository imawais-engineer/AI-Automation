/**
 * Arrays animation.
 *
 * One contiguous row of cells, addressed by index. The hook is the difference
 * between the two costs: reading `a[i]` is a single jump, while summing the array
 * means visiting every cell. The trace beat is that walk — the pointer moves to
 * the index the verified step visited and the running total updates to the value
 * that step produced, so the number on screen is always the array's own prefix sum.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { clamp01, easeInOutCubic, easeOutCubic, envelope, lerp, track } from './easing.ts';
import type { ArrayPlan } from './plan.ts';
import { factsPanel } from './facts.ts';
import {
  BAND,
  DESIGN_W,
  SAFE,
  backdrop,
  brandEnd,
  captionBar,
  curtain,
  drawBlock,
  drawChip,
  hudHeader,
  hudOperation,
  inkTone,
  openingHook,
  openingReveal,
  paletteOf,
  popCamera,
  pushCamera,
  safeBox,
  toast,
  type Camera,
  type Dims,
  type Palette
} from './stage.ts';
import { drawText } from '../render/layout.ts';
import { rgba } from '../render/paint.ts';

const CELL_W_MAX = 164;
const CELL_W_MIN = 88;
const CELL_H = 168;
const GAP = 24;
const ROW_MAX = 900;
const ROW_TOP = -60;
const INDEX_Y = ROW_TOP + CELL_H + 34;
const POINTER_Y = ROW_TOP - 58;
const SUM_Y = ROW_TOP - 210;

/** Cell width for the array length: longer rows shrink to stay inside the margin. */
export function cellWidth(count: number): number {
  if (count <= 1) return CELL_W_MAX;
  return Math.max(CELL_W_MIN, Math.min(CELL_W_MAX, (ROW_MAX - (count - 1) * GAP) / count));
}

function rowWidth(plan: ArrayPlan): number {
  const w = cellWidth(plan.array.length);
  return plan.array.length * w + (plan.array.length - 1) * GAP;
}

function cellCenter(plan: ArrayPlan, index: number): number {
  const w = cellWidth(plan.array.length);
  return -rowWidth(plan) / 2 + index * (w + GAP) + w / 2;
}

export type ArrayVisitState = {
  /** Cells already added to the total. */
  visited: number;
  /** The running total the picture shows. */
  sum: number;
  /** The cell the pointer is on, or null between visits. */
  active: number | null;
  /** How far into adding the active cell (0..1). */
  adding: number;
  done: boolean;
};

/** The array state the picture shows at `t`, read from the verified visits. */
export function arrayStateAt(plan: ArrayPlan, tMs: number): ArrayVisitState {
  let visited = 0;
  let sum = 0;
  for (const window of plan.steps) {
    const w = Math.max(1, window.endMs - window.startMs);
    if (tMs >= window.endMs) {
      visited = window.index + 1;
      sum = window.step.sum;
      continue;
    }
    if (tMs < window.startMs) break;
    const adding = track(tMs, window.startMs + w * 0.42, window.startMs + w * 0.68);
    return { visited: window.index, sum: lerp(sum, window.step.sum, adding), active: window.index, adding, done: false };
  }
  return { visited, sum, active: null, adding: 0, done: plan.steps.length > 0 && visited === plan.steps.length };
}

function cameraFor(plan: ArrayPlan, tMs: number): Camera {
  const base = { x: 0, y: 40, zoom: 1.02 };
  const opening = plan.beats.find((beat) => beat.key === 'open');
  if (opening && tMs < opening.endMs) {
    const p = easeInOutCubic(clamp01((tMs - opening.startMs) / Math.max(1, opening.endMs - opening.startMs)));
    return { x: 0, y: lerp(84, base.y, p), zoom: lerp(1.08, base.zoom, p) };
  }
  const hold = plan.hold;
  if (hold && tMs >= hold.startMs) {
    const p = easeInOutCubic(clamp01((tMs - hold.startMs) / 700));
    return { x: 0, y: lerp(base.y, 48, p), zoom: lerp(base.zoom, 1.03, p) };
  }
  return { x: Math.sin(tMs / 5200) * 9, y: base.y + Math.sin(tMs / 4100) * 4, zoom: base.zoom };
}

/** The `i` pointer above the active cell: a chip and a stem onto the cell it names. */
function drawPointer(
  ctx: SKRSContext2D,
  plan: ArrayPlan,
  state: ArrayVisitState,
  pal: Palette,
  alpha: number
): void {
  if (state.active === null || alpha <= 0.02) return;
  const cx = cellCenter(plan, state.active);
  const chip = drawChip(ctx, cx, POINTER_Y, `i = ${state.active}`, {
    size: 28,
    color: pal.accent,
    pal,
    align: 'center',
    filled: true,
    alpha,
    maxWidth: 220,
    group: 'pointer'
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.accent, 0.9);
  ctx.beginPath();
  ctx.moveTo(cx, POINTER_Y + chip.height / 2 + 16);
  ctx.lineTo(cx - 12, POINTER_Y + chip.height / 2);
  ctx.lineTo(cx + 12, POINTER_Y + chip.height / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The running total, above the row and clear of the pointer chip. */
function drawSum(ctx: SKRSContext2D, plan: ArrayPlan, state: ArrayVisitState, pal: Palette, alpha: number): void {
  if (alpha <= 0.02) return;
  const value = Math.round(state.sum);
  drawChip(ctx, 0, SUM_Y, `sum = ${value}`, {
    size: 40,
    color: state.done ? pal.coral : pal.violet,
    pal,
    align: 'center',
    alpha,
    maxWidth: 520,
    group: 'sum'
  });
}

/** Paints the whole Arrays short at `tMs`. */
export function drawArrays(ctx: SKRSContext2D, plan: ArrayPlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const cam = cameraFor(plan, tMs);
  const state = arrayStateAt(plan, tMs);
  const k = dims.width / DESIGN_W;
  const openBeat = plan.beats.find((beat) => beat.key === 'open');
  const brandBeat = plan.beats.find((beat) => beat.key === 'brand');
  const inOpening = Boolean(openBeat && tMs >= openBeat.startMs && tMs < openBeat.endMs);
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);

  backdrop(ctx, dims, cam, pal, tMs, { horizon: -430, glow: inBrand ? 0.6 : 1 });
  pushCamera(ctx, dims, cam);

  const width = cellWidth(plan.array.length);
  const total = rowWidth(plan);
  const baseline = ROW_TOP + CELL_H + 92;

  const pool = ctx.createRadialGradient(0, baseline + 20, 20, 0, baseline + 20, total * 0.6);
  pool.addColorStop(0, rgba(pal.accent, inBrand ? 0.05 : 0.13));
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, baseline + 22, total * 0.6, 84, 0, 0, Math.PI * 2);
  ctx.fill();

  // The row's baseline: a rule the cells stand on, so they read as one block of memory.
  const rule = ctx.createLinearGradient(-total / 2, 0, total / 2, 0);
  rule.addColorStop(0, rgba(pal.accent, 0));
  rule.addColorStop(0.5, rgba(pal.accent, inBrand ? 0.16 : 0.46));
  rule.addColorStop(1, rgba(pal.accent, 0));
  ctx.fillStyle = rule;
  ctx.fillRect(-total / 2 + 8, baseline, total - 16, 3);

  const cellsStart = openBeat ? openBeat.endMs - 320 : (plan.beats[0]?.startMs ?? 0) + 200;
  // The complexity panel owns the frame: the row leaves before the panel arrives,
  // so no label can ever land on a cell.
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity');
  const panelFade = complexityBeat ? 1 - track(tMs, complexityBeat.startMs - 320, complexityBeat.startMs) : 1;
  const stageFade = brandBeat ? 1 - track(tMs, brandBeat.startMs, brandBeat.startMs + 420) : 1;
  const cellsAlpha = clamp01((tMs - cellsStart) / 700) * stageFade * panelFade;

  plan.array.forEach((value, index) => {
    if (cellsAlpha <= 0.15) return;
    const x = cellCenter(plan, index) - width / 2;
    const visited = index < state.visited;
    const isActive = state.active === index;
    const isDone = state.done;
    const tone = visited || isActive ? 'active' : isDone ? 'dim' : 'normal';
    drawBlock(ctx, {
      x,
      y: ROW_TOP,
      w: width,
      h: CELL_H,
      value,
      pal,
      tone,
      alpha: cellsAlpha,
      scale: isActive ? 1 + 0.04 * state.adding : 1,
      glow: isActive ? 0.7 : visited ? 0.22 : 0.05,
      valueSize: width * 0.44,
      group: `cell:${index}`
    });

    drawText(ctx, String(index), {
      box: { x: x - 10, y: INDEX_Y, w: width + 20, h: 32 },
      role: 'mono',
      weight: 400,
      size: 26,
      minSize: 17,
      maxLines: 1,
      align: 'center',
      color: visited || isActive ? inkTone(pal, 0.66) : rgba(pal.ink, pal.dark ? 0.32 : 0.46),
      alpha: cellsAlpha,
      group: 'index-label'
    });
  });

  if (!inBrand && !inOpening && cellsAlpha > 0.2) {
    drawPointer(ctx, plan, state, pal, cellsAlpha);
    drawSum(ctx, plan, state, pal, cellsAlpha);
  }

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  const openFade = openBeat ? track(tMs, openBeat.endMs - 180, openBeat.endMs + 120) : 1;
  const headerAlpha = Math.min(
    1 - track(tMs, brandBeat?.startMs ?? Infinity, (brandBeat?.startMs ?? 0) + 300),
    openFade
  );

  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.presenter,
    step: 'ARRAYS',
    alpha: headerAlpha
  });

  if (inOpening && openBeat) {
    openingReveal(ctx, dims, pal, plan.opening, tMs, openBeat);
    openingHook(ctx, dims, pal, plan.copy.hook, envelope(tMs, openBeat.startMs + 140, openBeat.endMs - 80, 260, 240));
  }

  const rowAlpha =
    clamp01((tMs - (openBeat ? openBeat.endMs - 300 : (plan.beats[0]?.startMs ?? 0))) / 700) *
    (inBrand ? 0.25 : 1);

  // The row's identity and its one-step read, as a kicker pair.
  drawChip(ctx, SAFE * k, BAND.kicker * k, `${plan.array.length} CELLS · CONTIGUOUS`, {
    size: 21 * k,
    color: pal.accent,
    pal,
    align: 'left',
    alpha: rowAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.5,
    group: 'kicker'
  });
  drawChip(ctx, dims.width - SAFE * k, BAND.kicker * k, 'a[i] IN ONE STEP', {
    size: 21 * k,
    color: pal.accent,
    pal,
    align: 'right',
    alpha: rowAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.45,
    group: 'kicker'
  });

  const hookBeat = plan.beats.find((beat) => beat.key === 'intro');
  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const p = clamp01((tMs - hookBeat.startMs) / Math.max(1, hookBeat.endMs - hookBeat.startMs));
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    const rise = (1 - easeOutCubic(track(p, 0, 0.42))) * 26 * k;
    const box = safeBox(k, BAND.hookTop, BAND.hookBottom);
    const fitted = drawText(ctx, plan.copy.hook || 'Reading a cell is one step. Summing them all is not.', {
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

  const setupBeat = plan.beats.find((beat) => beat.key === 'setup');
  if (setupBeat && tMs >= setupBeat.startMs && tMs < setupBeat.endMs) {
    const alpha = envelope(tMs, setupBeat.startMs, setupBeat.endMs, 240, 280);
    hudOperation(ctx, dims, pal, {
      label: 'Address = base + i × slot',
      detail: 'one multiplication, one read — no walking required',
      alpha,
      accent: pal.coral
    });
    captionBar(ctx, dims, pal, { text: setupBeat.caption || plan.copy.objective, alpha });
  }

  const traceBeat = plan.beats.find((beat) => beat.key === 'trace');
  const activeWindow = plan.steps.find((window) => tMs >= window.startMs && tMs < window.endMs);
  const lastWindow = plan.steps[plan.steps.length - 1];
  if (traceBeat && tMs >= traceBeat.startMs && tMs < traceBeat.endMs) {
    const alpha = envelope(tMs, traceBeat.startMs, traceBeat.endMs, 240, 260);
    if (activeWindow) {
      hudOperation(ctx, dims, pal, {
        label: `i = ${activeWindow.step.index} · a[${activeWindow.step.index}] = ${activeWindow.step.value}`,
        detail: `sum ${Math.round(arrayStateAt(plan, tMs).sum)} after ${activeWindow.step.index + 1} of ${plan.array.length} cells`,
        alpha
      });
      captionBar(ctx, dims, pal, { text: activeWindow.step.message, alpha });
    } else if (plan.hold && tMs >= plan.hold.startMs) {
      const first = plan.steps[0]?.startMs ?? traceBeat.startMs;
      hudOperation(ctx, dims, pal, {
        label: `${plan.array.length} cells visited · 1 step each`,
        detail: `O(n) traversal · every cell was read once`,
        alpha
      });
      toast(ctx, dims, pal, {
        text: `SUM = ${plan.total}`,
        sub: `${plan.array.length} values added left to right`,
        color: pal.coral,
        alpha: envelope(tMs, plan.hold.startMs + 180, traceBeat.endMs + 600, 220, 260),
        y: BAND.resultTop + 66
      });
      captionBar(ctx, dims, pal, {
        text: `Total ${plan.total} — the walk stops at the end of the array.`,
        alpha
      });
      void first;
    } else if (plan.traceIntro && tMs >= plan.traceIntro.startMs) {
      hudOperation(ctx, dims, pal, {
        label: `visit every cell, left to right`,
        detail: `a[0] … a[${plan.array.length - 1}] · index i advances by one`,
        alpha
      });
      captionBar(ctx, dims, pal, { text: `Sum all ${plan.array.length} values.`, alpha });
    }
  }

  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    const alpha = envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 260, 300);
    curtain(ctx, dims, pal, 0.3);
    factsPanel(ctx, dims, pal, 'Complexity', [
      { label: 'Read or write by index', value: plan.copy.time || 'O(1)' },
      { label: 'Insert or delete in the middle', value: 'O(n) — later elements shift' },
      { label: 'This traversal', value: `O(n) — ${plan.array.length} cells, ${plan.array.length} steps` }
    ], alpha);
    captionBar(ctx, dims, pal, {
      text: `Access by index is O(1); this traversal is O(n). Memory: O(n).`,
      alpha
    });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = clamp01((tMs - brandBeat.startMs) / Math.max(1, brandBeat.endMs - brandBeat.startMs));
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.24)) * 0.88);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }

  void lastWindow;
}
