/**
 * Stack animation.
 *
 * One continuous stage for the whole short: a plinth, a vertical tower of solid
 * blocks, a TOP pointer and a moving camera. Every block position comes from the
 * verified `StackEvent` list — a push drops a block onto slot `items.length - 1`,
 * a pop lifts and retires the block the trace says was removed. The environment
 * never cuts away between operations.
 *
 * The TOP pointer is not positioned by hand: it is anchored to the rendered bounds
 * of the block that is currently on top, so it follows every push, pop and camera
 * move exactly.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import {
  bump,
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  envelope,
  lerp,
  track
} from './easing.ts';
import { AnchorMap, type Rect } from './anchors.ts';
import { recordObject } from './audit.ts';
import type { Beat, StackBlock, StackPlan } from './plan.ts';
import {
  BAND,
  SAFE,
  accentTone,
  backdrop,
  brandEnd,
  captionBar,
  curtain,
  drawAnchorLabel,
  drawBlock,
  drawChip,
  drawPlatform,
  hudHeader,
  hudOperation,
  inkTone,
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
import { drawText } from '../render/layout.ts';
import { rgba, roundRect } from '../render/paint.ts';

const FLOOR_Y = 430;
const SLOT = 136;
const BLOCK_W = 460;
const BLOCK_H = 118;
const ENTRY_DROP = 320;

const camYFor = (count: number): number => 470 - 68 * Math.min(count, 6);
const platformSurfaceY = FLOOR_Y - 20;

/** Camera keys: framing follows the tower as it grows, without cutting. */
function cameraKeys(plan: StackPlan): { at: number; y: number; zoom: number }[] {
  const keys: { at: number; y: number; zoom: number }[] = [{ at: 0, y: camYFor(0), zoom: 1.02 }];
  for (const op of plan.ops) {
    const count = op.event.items.length;
    keys.push({ at: op.endMs - 40, y: camYFor(count), zoom: 1 });
  }
  for (const beat of plan.beats) {
    if (beat.key === 'open') {
      // A slow push-in through the opening, so the title sits in a moving frame.
      keys.push({ at: beat.startMs, y: camYFor(0) + 30, zoom: 1 });
      keys.push({ at: beat.endMs, y: camYFor(0) - 10, zoom: 1.04 });
    }
    if (beat.key === 'lifo') {
      const count = plan.ops[plan.ops.length - 1]?.event.items.length ?? 0;
      keys.push({ at: beat.startMs, y: camYFor(count) + 10, zoom: 0.98 });
      keys.push({ at: beat.endMs, y: camYFor(count) + 10, zoom: 0.98 });
    }
    if (beat.key === 'brand') {
      keys.push({ at: beat.startMs, y: camYFor(0) + 60, zoom: 0.94 });
    }
  }
  return keys.sort((a, b) => a.at - b.at);
}

function sampleCamera(plan: StackPlan, tMs: number): Camera {
  const keys = cameraKeys(plan);
  let index = 0;
  while (index < keys.length - 1 && tMs > keys[index + 1].at) index++;
  if (index >= keys.length - 1) {
    const last = keys[keys.length - 1];
    return { x: 0, y: last.y, zoom: last.zoom };
  }
  const from = keys[index];
  const to = keys[index + 1];
  const p = easeInOutCubic(track(tMs, from.at, to.at));
  const breathe = Math.sin(tMs / 3400) * 5;
  return {
    x: Math.sin(tMs / 5200) * 12,
    y: lerp(from.y, to.y, p) + breathe,
    zoom: lerp(from.zoom, to.zoom, p) + Math.sin(tMs / 6400) * 0.008
  };
}

/** Blocks alive at `t`, with the motion state the renderer needs. */
export type StackBlockState = {
  block: StackBlock;
  /** Bottom edge of the block in design coordinates. */
  bottom: number;
  x: number;
  alpha: number;
  scale: number;
  glow: number;
  tone: 'normal' | 'active' | 'match';
  /** Rendered bounds, including the scale animation. */
  rect: Rect;
};

export function blocksAt(plan: StackPlan, tMs: number): StackBlockState[] {
  const out: StackBlockState[] = [];
  const activeOp = plan.ops.find((op) => tMs >= op.startMs && tMs < op.endMs) ?? null;

  for (const block of plan.blocks) {
    if (tMs < block.bornMs) continue;
    if (block.goneMs !== null && tMs >= block.goneMs) continue;

    const slotBottom = FLOOR_Y - block.slot * SLOT;
    let bottom = slotBottom;
    let x = 0;
    let alpha = 1;
    let scale = 1;
    let glow = 0;
    let tone: StackBlockState['tone'] = 'normal';

    const landing = track(tMs, block.bornMs, block.landedMs);
    if (landing < 1) {
      bottom = slotBottom - (1 - easeOutCubic(landing)) * ENTRY_DROP;
      alpha = clamp01(landing * 4);
      scale = 1 + 0.04 * (1 - landing);
      glow = 0.55;
      tone = 'active';
    } else {
      const settle = bump(tMs, block.landedMs, 260);
      scale = 1 - 0.028 * settle;
      bottom += settle * 3;
      glow = Math.max(0, 0.75 - track(tMs, block.landedMs, block.landedMs + 1000) * 0.75);
    }

    if (block.deathMs !== null) {
      const exit = track(tMs, block.deathMs, block.goneMs ?? block.deathMs + 1);
      if (exit > 0) {
        const eased = easeInOutCubic(exit);
        bottom -= easeOutCubic(exit) * 130;
        x = eased * 520;
        alpha = 1 - easeInCubic(exit);
        scale = 1 + 0.05 * exit;
        glow = 1 - exit * 0.4;
        tone = 'match';
      }
    }

    // PEEK lifts the top value and lights it without removing it.
    if (activeOp && activeOp.event.op === 'top' && activeOp.event.top !== null) {
      const isTop = block.slot === activeOp.event.items.length - 1 && block.deathMs === null;
      if (isTop) {
        const lift = bump(tMs, activeOp.startMs + (activeOp.endMs - activeOp.startMs) * 0.14, (activeOp.endMs - activeOp.startMs) * 0.55);
        bottom -= lift * 34;
        glow = Math.max(glow, lift);
        tone = 'active';
      }
    }

    if (activeOp && activeOp.blockId === block.id && block.deathMs === null) {
      tone = 'active';
    }

    const cx = x + 0;
    const width = BLOCK_W * scale;
    const height = BLOCK_H * scale;
    const rect: Rect = { x: cx - width / 2, y: bottom - height, w: width, h: height };

    out.push({ block, bottom, x, alpha: clamp01(alpha), scale, glow: clamp01(glow), tone, rect });
  }

  return out.sort((a, b) => a.block.slot - b.block.slot);
}

/** The stack contents the visuals are showing at `t` — the TOP pointer reads this. */
export function stackStateAt(plan: StackPlan, tMs: number): { items: number[]; top: number | null; size: number } {
  const live = plan.blocks
    .filter((block) => tMs >= block.landedMs && (block.deathMs === null || tMs < block.deathMs))
    .sort((a, b) => a.slot - b.slot)
    .map((block) => block.value);
  return { items: live, top: live.length ? live[live.length - 1] : null, size: live.length };
}

/**
 * The block the TOP marker belongs to right now: the highest block that has landed
 * and is not already leaving — the same predicate `stackStateAt` counts with, so
 * TOP and the size readout can never disagree while a block is still dropping in.
 */
function topBlockAt(blocks: StackBlockState[], tMs: number): StackBlockState | null {
  const candidates = blocks.filter(
    (item) => tMs >= item.block.landedMs && (item.block.deathMs === null || tMs < item.block.deathMs)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((top, item) => (item.block.slot > top.block.slot ? item : top), candidates[0]);
}

function beatProgress(beat: Beat, tMs: number): number {
  return clamp01((tMs - beat.startMs) / Math.max(1, beat.endMs - beat.startMs));
}

/* ---------------------------------------------------------------- explanation */

/**
 * Complexity beat: one card with three fitted rows, then the underflow example as
 * a clearly separate inset. Every string is measured into its own box, so the card
 * cannot overflow at any width.
 */
function complexityPanel(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  plan: StackPlan,
  beat: Beat,
  tMs: number
): void {
  const k = dims.width / 1080;
  const p = beatProgress(beat, tMs);
  const panel = envelope(tMs, beat.startMs, beat.endMs, 260, 320);
  if (panel <= 0.01) return;

  const x = 90 * k;
  const w = dims.width - 180 * k;
  const y = 300 * k;
  const h = 250 * k;

  ctx.save();
  ctx.globalAlpha = panel * (1 - track(p, 0.5, 0.62));
  ctx.fillStyle = rgba(pal.scrim, 0.88);
  roundRect(ctx, x, y, w, h, 26 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.3);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, 'EVERY OPERATION TOUCHES ONLY THE TOP', {
    box: { x: x + 34 * k, y: y + 30 * k, w: w - 68 * k, h: 34 * k },
    role: 'mono',
    weight: 400,
    size: 23 * k,
    minSize: 17 * k,
    maxLines: 1,
    color: inkTone(pal, 0.6),
    alpha: panel * (1 - track(p, 0.5, 0.62)),
    group: 'complexity'
  });

  const rows = [
    { label: 'PUSH', value: plan.copy.time.match(/O\([^)]+\)/)?.[0] || 'O(1)' },
    { label: 'POP', value: 'O(1)' },
    { label: 'PEEK', value: 'O(1)' }
  ];
  const rowY = y + 92 * k;
  const chipW = (w - 68 * k) / 3;
  rows.forEach((row, index) => {
    const cx = x + 34 * k + index * chipW;
    ctx.save();
    ctx.globalAlpha = panel * (1 - track(p, 0.5, 0.62));
    ctx.fillStyle = rgba(index === 0 ? pal.accent : pal.violet, 0.1);
    roundRect(ctx, cx, rowY, chipW - 16 * k, 76 * k, 16 * k);
    ctx.fill();
    ctx.restore();

    drawText(ctx, row.label, {
      box: { x: cx + 18 * k, y: rowY + 18 * k, w: chipW * 0.52, h: 40 * k },
      role: 'mono',
      weight: 600,
      size: 26 * k,
      minSize: 18 * k,
      maxLines: 1,
      color: pal.ink,
      alpha: panel * (1 - track(p, 0.5, 0.62)),
      group: 'complexity'
    });
    drawText(ctx, row.value, {
      box: { x: cx + chipW * 0.5 - 16 * k, y: rowY + 16 * k, w: chipW * 0.42, h: 44 * k },
      role: 'mono',
      weight: 600,
      size: 28 * k,
      minSize: 18 * k,
      maxLines: 1,
      align: 'right',
      color: accentTone(pal, pal.accent),
      alpha: panel * (1 - track(p, 0.5, 0.62)),
      group: 'complexity'
    });
  });

  const under = track(p, 0.52, 0.62) * (1 - track(p, 0.9, 1));
  if (under <= 0.01) return;

  // Underflow is demonstrated as an explicit, separate example.
  const insetW = (dims.width - 180 * k) * 0.94;
  const insetH = 470 * k;
  const insetX = (dims.width - insetW) / 2;
  const insetY = 560 * k;
  const rise = (1 - easeOutCubic(track(p, 0.52, 0.68))) * 40 * k;

  ctx.save();
  ctx.globalAlpha = under;
  ctx.translate(0, rise);
  ctx.fillStyle = rgba(pal.scrim, 0.94);
  roundRect(ctx, insetX, insetY, insetW, insetH, 30 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.coral, 0.45);
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();

  drawChip(ctx, insetX + 34 * k, insetY + 54 * k, 'EXAMPLE · NOT PART OF THE TRACE', {
    size: 20 * k,
    color: pal.coral,
    pal,
    align: 'left',
    maxWidth: insetW - 68 * k,
    group: 'complexity'
  });

  drawText(ctx, 'POP() on an empty stack', {
    box: { x: insetX + 34 * k, y: insetY + 96 * k, w: insetW - 68 * k, h: 60 * k },
    role: 'display',
    weight: 600,
    size: 42 * k,
    minSize: 28 * k,
    maxLines: 1,
    color: pal.ink,
    group: 'complexity'
  });
  drawText(ctx, 'returned EMPTY · size stays 0', {
    box: { x: insetX + 34 * k, y: insetY + 158 * k, w: insetW - 68 * k, h: 40 * k },
    role: 'mono',
    weight: 400,
    size: 28 * k,
    minSize: 20 * k,
    maxLines: 1,
    color: inkTone(pal, 0.68),
    group: 'complexity'
  });

  const emptyX = insetX + insetW / 2;
  const plateY = insetY + insetH - 116 * k;
  ctx.save();
  ctx.fillStyle = rgba(pal.accent, 0.1);
  roundRect(ctx, emptyX - 200 * k, plateY - 22 * k, 400 * k, 44 * k, 12 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.3);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, 'TOP = empty', {
    box: { x: insetX + 34 * k, y: plateY + 36 * k, w: insetW - 68 * k, h: 44 * k },
    role: 'mono',
    weight: 600,
    size: 28 * k,
    minSize: 20 * k,
    maxLines: 1,
    align: 'center',
    color: accentTone(pal, pal.coral),
    group: 'complexity'
  });

  const popPulse = bump(tMs, beat.startMs + (beat.endMs - beat.startMs) * 0.62, 900);
  drawChip(ctx, emptyX, plateY - 66 * k - popPulse * 10 * k, 'POP() → EMPTY', {
    size: 26 * k,
    color: pal.coral,
    pal,
    align: 'center',
    filled: true,
    maxWidth: insetW - 68 * k,
    group: 'complexity'
  });
  ctx.restore();
}

/**
 * The LIFO card, stacked directly above the caption strip.
 *
 * `caption` is the strip the frame already reserved, so the card sits clear of it
 * at every caption length: the two panels never draw over each other.
 */
function lifoOverlay(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  plan: StackPlan,
  beat: Beat,
  tMs: number,
  caption: Rect
): void {
  const k = dims.width / 1080;
  const alpha = envelope(tMs, beat.startMs, beat.endMs, 240, 300);
  if (alpha <= 0.01) return;

  const last = plan.ops[plan.ops.length - 1];
  const items = last ? last.event.items : [];
  const topValue = items.length ? items[items.length - 1] : null;
  const bottomValue = items.length ? items[0] : null;

  const cardW = dims.width - 180 * k;
  const cardX = 90 * k;
  const cardH = 150 * k;
  const cardY = Math.min(dims.height - 470 * k, caption.y - 24 * k - cardH);
  const card: Rect = { x: cardX, y: cardY, w: cardW, h: cardH };

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.scrim, 0.86);
  roundRect(ctx, cardX, cardY, cardW, cardH, 24 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.28);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  ctx.restore();

  // A solid panel is an obstacle: text from another panel over it would be a fault.
  if (alpha >= 0.15) recordObject(ctx, 'lifo', card, 'LIFO panel');

  drawText(ctx, 'LIFO', {
    box: { x: cardX + 32 * k, y: cardY + 26 * k, w: 150 * k, h: 56 * k },
    role: 'display',
    weight: 700,
    size: 48 * k,
    minSize: 30 * k,
    maxLines: 1,
    color: accentTone(pal, pal.accent),
    alpha,
    group: 'lifo'
  });
  drawText(ctx, 'Last In, First Out', {
    box: { x: cardX + 32 * k, y: cardY + 90 * k, w: cardW * 0.5, h: 40 * k },
    role: 'text',
    weight: 500,
    size: 28 * k,
    minSize: 20 * k,
    maxLines: 1,
    color: inkTone(pal, 0.78),
    alpha,
    group: 'lifo'
  });
  drawText(ctx, `${topValue ?? '—'} leaves before ${bottomValue ?? '—'}`, {
    box: { x: cardX + cardW * 0.46, y: cardY + 30 * k, w: cardW * 0.5 - 32 * k, h: 44 * k },
    role: 'mono',
    weight: 600,
    size: 26 * k,
    minSize: 18 * k,
    maxLines: 1,
    align: 'right',
    color: accentTone(pal, pal.coral),
    alpha,
    group: 'lifo'
  });
  drawText(ctx, `${String(topValue ?? '—')} was pushed last`, {
    box: { x: cardX + cardW * 0.46, y: cardY + 88 * k, w: cardW * 0.5 - 32 * k, h: 40 * k },
    role: 'mono',
    weight: 400,
    size: 23 * k,
    minSize: 17 * k,
    maxLines: 1,
    align: 'right',
    color: inkTone(pal, 0.6),
    alpha,
    group: 'lifo'
  });
}

/**
 * A ghost of the newest value lifting out of the tower and settling back: the LIFO
 * demonstration.
 *
 * It is drawn inside the stage camera, so it stays anchored just above the block it
 * copies however the camera is framed — as a screen-space overlay it landed in the
 * frame's top-left corner, clipped by the edge.
 */
function lifoGhost(ctx: SKRSContext2D, pal: Palette, plan: StackPlan, beat: Beat, tMs: number): void {
  const alpha = envelope(tMs, beat.startMs, beat.endMs, 240, 300);
  if (alpha <= 0.01) return;

  const last = plan.ops[plan.ops.length - 1];
  const items = last ? last.event.items : [];
  const topValue = items.length ? items[items.length - 1] : null;
  if (topValue === null) return;

  const p = beatProgress(beat, tMs);
  const lift = Math.sin(Math.PI * clamp01(track(p, 0.12, 0.82)));
  // It floats clear of the tower it belongs to, so it never covers the real block
  // or its value while it hovers.
  const y = FLOOR_Y - items.length * SLOT - BLOCK_H - 26 - lift * 90;
  const cx = 0;
  const cy = y + BLOCK_H / 2;

  ctx.save();
  ctx.globalAlpha = alpha * (0.5 + 0.4 * lift);

  // A hollow, dashed copy reads as "the same value leaving", not as a third element.
  const halo = ctx.createRadialGradient(cx, cy, BLOCK_W * 0.15, cx, cy, BLOCK_W * 0.72);
  halo.addColorStop(0, rgba(pal.coral, 0.16 * (0.4 + lift)));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, BLOCK_W * 0.72, 0, Math.PI * 2);
  ctx.fill();

  ctx.setLineDash([20, 14]);
  roundRect(ctx, -BLOCK_W / 2, y, BLOCK_W, BLOCK_H, 18);
  ctx.fillStyle = rgba(pal.coral, 0.07);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.coral, 0.8);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  recordObject(ctx, 'lifo-ghost', { x: -BLOCK_W / 2, y, w: BLOCK_W, h: BLOCK_H }, String(topValue));
  drawText(ctx, String(topValue), {
    box: { x: -BLOCK_W / 2, y, w: BLOCK_W, h: BLOCK_H },
    role: 'display',
    weight: 700,
    size: 54,
    minSize: 30,
    maxLines: 1,
    align: 'center',
    valign: 'middle',
    color: rgba(pal.coral, 0.95),
    alpha: alpha * (0.5 + 0.4 * lift),
    group: 'lifo-ghost'
  });
}

/** The opening headline: Space Grotesk, large, fitted and deliberately broken. */
function hookHeadline(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  plan: StackPlan,
  beat: Beat,
  tMs: number
): void {
  const k = dims.width / 1080;
  const p = beatProgress(beat, tMs);
  const alpha = envelope(tMs, beat.startMs, beat.endMs, 320, 380);
  const rise = (1 - easeOutCubic(track(p, 0, 0.42))) * 26 * k;
  const box = safeBox(k, BAND.hookTop, BAND.hookBottom);

  const fitted = drawText(ctx, plan.copy.hook || 'A stack only lets you touch the top.', {
    box: { ...box, y: box.y + rise },
    role: 'display',
    weight: 700,
    size: 92 * k,
    minSize: 46 * k,
    maxLines: 4,
    lineHeight: 1.12,
    color: pal.ink,
    alpha,
    group: 'hook'
  });

  const ruleY = box.y + rise + fitted.height + 22 * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgba(pal.accent, 0.9);
  ctx.lineWidth = 5 * k;
  const grow = easeOutCubic(track(p, 0.2, 0.6));
  ctx.beginPath();
  ctx.moveTo(SAFE * k, ruleY);
  ctx.lineTo(SAFE * k + 200 * k * grow, ruleY);
  ctx.stroke();
  ctx.restore();
}

/** Draws one moment of the stack short. */
export function drawStack(ctx: SKRSContext2D, plan: StackPlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const beat = plan.beats.find((item) => tMs >= item.startMs && tMs < item.endMs) ?? plan.beats[plan.beats.length - 1];
  const activeOp = plan.ops.find((op) => tMs >= op.startMs && tMs < op.endMs) ?? null;
  const state = stackStateAt(plan, tMs);
  const cam = sampleCamera(plan, tMs);
  const brandBeat = plan.beats.find((item) => item.key === 'brand');
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);
  const openBeat = plan.beats.find((item) => item.key === 'open');
  const inOpening = Boolean(openBeat && tMs >= openBeat.startMs && tMs < openBeat.endMs);
  const k = dims.width / 1080;
  // The underflow inset owns the frame in the second half of the complexity beat,
  // so the tower fades out instead of sitting underneath the card.
  const complexityBeatForStage = plan.beats.find((item) => item.key === 'complexity');
  const stageFade = complexityBeatForStage
    ? 1 - track(beatProgress(complexityBeatForStage, tMs), 0.48, 0.58)
    : 1;

  backdrop(ctx, dims, cam, pal, tMs, { glow: inBrand ? 0.6 : 1 });

  const anchors = new AnchorMap();
  const obstacles: Rect[] = [];

  pushCamera(ctx, dims, cam);
  drawPlatform(ctx, { x: -430, y: FLOOR_Y, w: 860, pal, alpha: (inBrand ? 0.35 : 1) * stageFade });
  // The opening frames preview the subject as a lit silhouette above the title;
  // it fades out as the first real block is pushed.
  if (inOpening && openBeat) {
    const glow =
      easeOutCubic(track(tMs, openBeat.startMs + 120, openBeat.startMs + 720)) *
      (1 - track(tMs, openBeat.endMs - 460, openBeat.endMs));
    subjectSilhouette(ctx, 'stack', pal, glow * 0.6);
  }
  const blocks = blocksAt(plan, tMs);
  for (const item of blocks) {
    drawBlock(ctx, {
      x: item.x - BLOCK_W / 2,
      y: item.bottom - BLOCK_H,
      w: BLOCK_W,
      h: BLOCK_H,
      value: item.block.value,
      pal,
      tone: item.tone,
      alpha: item.alpha * stageFade,
      scale: item.scale,
      glow: item.glow,
      group: `block:${item.block.id}`
    });
    anchors.set(`block:${item.block.id}`, item.rect);
    if (item.alpha > 0.4) obstacles.push(item.rect);
  }

  // The LIFO demonstration lifts a ghost of the newest value out of the tower, in
  // the same camera space as the blocks it copies.
  const lifoBeatStage = plan.beats.find((item) => item.key === 'lifo');
  if (lifoBeatStage && tMs >= lifoBeatStage.startMs && tMs < lifoBeatStage.endMs) {
    lifoGhost(ctx, pal, plan, lifoBeatStage, tMs);
  }

  // Slot indices on the left keep the spatial order unambiguous.
  for (const item of blocks) {
    if (item.alpha < 0.5 || stageFade < 0.5) continue;
    const centerY = item.rect.y + item.rect.h / 2;
    drawText(ctx, String(item.block.slot), {
      box: { x: item.rect.x - 132, y: centerY - 20, w: 96, h: 40 },
      role: 'mono',
      weight: 400,
      size: 25,
      minSize: 18,
      maxLines: 1,
      align: 'right',
      color: inkTone(pal, 0.42),
      alpha: item.alpha * stageFade,
      group: 'slot-index'
    });
    ctx.fillStyle = rgba(pal.ink, 0.16);
    ctx.fillRect(item.rect.x - 30, centerY, 16, 2);
  }

  // The opening owns the frame: no pointer or readout is drawn over the title.
  if (!inBrand && !inOpening && stageFade > 0.2) {
    const top = topBlockAt(blocks, tMs);
    const platformAnchor: Rect = { x: -300, y: platformSurfaceY - 60, w: 600, h: 60 };
    const anchor = top ? top.rect : anchors.set('platform', platformAnchor);
    const anchorId = top ? `block:${top.block.id}` : 'platform';
    const empty = !top;
    const pointerObstacles = obstacles.filter((rect) => rect !== anchor);

    drawAnchorLabel(ctx, {
      anchor,
      anchorId,
      group: 'top-pointer',
      label: 'TOP',
      sub: empty ? 'empty' : String(top?.block.value ?? '—'),
      pal,
      color: empty ? pal.coral : pal.accent,
      bounds: { x: -SAFE, y: -760, w: 1080 + SAFE * 2, h: 1520 },
      obstacles: pointerObstacles,
      prefer: ['right', 'left', 'above'],
      size: 26,
      gap: 34
    });

    // Size readout sits on the plinth's own lip, never below it.
    drawText(ctx, `size ${state.size}`, {
      box: { x: -420, y: FLOOR_Y - 2, w: 240, h: 30 },
      role: 'mono',
      weight: 600,
      size: 21,
      minSize: 16,
      maxLines: 1,
      color: inkTone(pal, 0.6),
      group: 'stage-label'
    });
  }

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  // Chrome stays off the opening frame and returns as it ends, so the title owns
  // the screen while it is on it.
  const openFade = openBeat ? track(tMs, openBeat.endMs - 180, openBeat.endMs + 120) : 1;
  const headerAlpha = Math.min(
    1 - track(tMs, (brandBeat?.startMs ?? Infinity), (brandBeat?.startMs ?? Infinity) + 300),
    openFade
  );
  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.presenter,
    step: activeOp ? `STEP ${String(activeOp.index + 1).padStart(2, '0')} / ${String(plan.ops.length).padStart(2, '0')}` : 'STACK',
    alpha: headerAlpha
  });

  if (inOpening && openBeat) {
    openingReveal(ctx, dims, pal, plan.opening, tMs, openBeat);
  }

  const hookBeat = plan.beats.find((item) => item.key === 'intro');
  const setupBeat = plan.beats.find((item) => item.key === 'setup');

  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    drawChip(ctx, SAFE * k, BAND.kicker * k, 'STACK · LIFO', {
      size: 23 * k,
      color: pal.accent,
      pal,
      align: 'left',
      alpha,
      maxWidth: dims.width - 2 * SAFE * k,
      group: 'kicker'
    });
    hookHeadline(ctx, dims, pal, plan, hookBeat, tMs);
  }

  if (setupBeat && tMs >= setupBeat.startMs && tMs < setupBeat.endMs) {
    const alpha = envelope(tMs, setupBeat.startMs, setupBeat.endMs, 220, 260);
    drawChip(ctx, SAFE * k, BAND.kicker * k, 'STACK · LIFO', {
      size: 23 * k,
      color: pal.accent,
      pal,
      align: 'left',
      alpha,
      maxWidth: dims.width - 2 * SAFE * k,
      group: 'kicker'
    });
    hudOperation(ctx, dims, pal, {
      label: 'PUSH adds · POP removes',
      detail: 'only the top element is reachable',
      alpha
    });
    captionBar(ctx, dims, pal, { text: beat.caption || plan.copy.objective, alpha });
  }

  if (activeOp) {
    const w = activeOp.endMs - activeOp.startMs;
    const alpha = envelope(tMs, activeOp.startMs, activeOp.endMs, 200, 220);
    const op = activeOp.event;
    hudOperation(ctx, dims, pal, {
      label: op.op === 'push' ? `PUSH(${op.value})` : op.op === 'pop' ? 'POP()' : 'PEEK()',
      detail: `TOP ${state.top ?? '—'} · size ${state.size}`,
      alpha
    });

    if (op.op === 'top' && op.returned !== null) {
      const t0 = activeOp.startMs + w * 0.34;
      const alpha2 = envelope(tMs, t0, activeOp.startMs + w * 0.96, 200, 260);
      toast(ctx, dims, pal, {
        text: `PEEK → ${op.returned}`,
        sub: 'read only · nothing removed',
        color: pal.accent,
        alpha: alpha2,
        scale: 0.94 + easeOutCubic(track(tMs, t0, t0 + 260)) * 0.06
      });
    }
    if (op.op === 'pop' && op.returned !== null) {
      const t0 = activeOp.startMs + w * 0.3;
      const alpha2 = envelope(tMs, t0, activeOp.startMs + w * 0.94, 200, 240);
      toast(ctx, dims, pal, {
        text: `POP → ${op.returned}`,
        sub: 'the newest value leaves first',
        color: pal.coral,
        alpha: alpha2,
        scale: 0.94 + easeOutCubic(track(tMs, t0, t0 + 240)) * 0.06
      });
    }
    if (op.op === 'push') {
      const t0 = activeOp.startMs + w * 0.52;
      const alpha2 = envelope(tMs, t0, activeOp.startMs + w * 0.98, 200, 240);
      toast(ctx, dims, pal, {
        text: `PUSH → ${op.value}`,
        sub: `now on top · size ${state.size}`,
        color: pal.violet,
        alpha: alpha2,
        scale: 0.94 + easeOutCubic(track(tMs, t0, t0 + 240)) * 0.06
      });
    }
    captionBar(ctx, dims, pal, { text: activeOp.event.message, alpha: alpha * 0.98 });
  }

  const lifoBeat = plan.beats.find((item) => item.key === 'lifo');
  if (lifoBeat && tMs >= lifoBeat.startMs && tMs < lifoBeat.endMs) {
    // The strip is laid out first so the card above it is placed against its real
    // height instead of overlapping it.
    const strip = captionBar(ctx, dims, pal, {
      text: plan.copy.takeaway || 'The last value in is the first value out.',
      alpha: envelope(tMs, lifoBeat.startMs, lifoBeat.endMs, 240, 300)
    });
    lifoOverlay(ctx, dims, pal, plan, lifoBeat, tMs, strip);
  }

  const complexityBeat = plan.beats.find((item) => item.key === 'complexity');
  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    const p = beatProgress(complexityBeat, tMs);
    if (p > 0.5) curtain(ctx, dims, pal, 0.32 * track(p, 0.5, 0.6));
    complexityPanel(ctx, dims, pal, plan, complexityBeat, tMs);
    // The concept stores the whole phrase ("O(1) push, pop and peek"), so only its
    // complexity token reads correctly inside this sentence.
    const timeToken = plan.copy.time.match(/O\([^)]+\)/)?.[0] || 'O(1)';
    captionBar(ctx, dims, pal, {
      text:
        p < 0.5
          ? `PUSH, POP and PEEK are ${timeToken} each — only the top is touched. Space: ${plan.copy.space || 'O(n)'}.`
          : 'Underflow: popping an empty stack returns EMPTY instead of a value.',
      alpha: envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 240, 300)
    });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = beatProgress(brandBeat, tMs);
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.22)) * 0.85);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }

}
