/**
 * Stack animation.
 *
 * One continuous stage for the whole short: a plinth, a vertical tower of solid
 * blocks, a TOP pointer and a moving camera. Every block position comes from the
 * verified `StackEvent` list — a push drops a block onto slot `items.length - 1`,
 * a pop lifts and retires the block the trace says was removed. The environment
 * never cuts away between operations.
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
import type { Beat, StackBlock, StackPlan } from './plan.ts';
import {
  backdrop,
  brandEnd,
  captionBar,
  curtain,
  drawBlock,
  drawChip,
  drawPlatform,
  drawTopPointer,
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

const FLOOR_Y = 430;
const SLOT = 136;
const BLOCK_W = 460;
const BLOCK_H = 118;
const ENTRY_DROP = 320;

const camYFor = (count: number): number => 470 - 68 * Math.min(count, 6);
const surfaceYFor = (count: number): number => (count === 0 ? FLOOR_Y - 20 : FLOOR_Y - count * SLOT);

/** Camera keys: framing follows the tower as it grows, without cutting. */
function cameraKeys(plan: StackPlan): { at: number; y: number; zoom: number }[] {
  const keys: { at: number; y: number; zoom: number }[] = [{ at: 0, y: camYFor(0), zoom: 1.02 }];
  for (const op of plan.ops) {
    const count = op.event.items.length;
    keys.push({ at: op.endMs - 40, y: camYFor(count), zoom: 1 });
  }
  for (const beat of plan.beats) {
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

    out.push({ block, bottom, x, alpha: clamp01(alpha), scale, glow: clamp01(glow), tone });
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

function pointerY(plan: StackPlan, tMs: number): { y: number; empty: boolean } {
  let settled = 0;
  let y = surfaceYFor(0);
  for (const op of plan.ops) {
    const from = surfaceYFor(settled);
    settled = op.event.items.length;
    const to = surfaceYFor(settled);
    if (tMs >= op.endMs) {
      y = to;
      continue;
    }
    if (tMs <= op.startMs) break;
    const w = op.endMs - op.startMs;
    const p = easeInOutCubic(track(tMs, op.startMs + w * 0.42, op.startMs + w * 0.78));
    y = lerp(from, to, p);
    return { y, empty: settled === 0 && p > 0.5 };
  }
  if (settled === 0) y = surfaceYFor(0);
  return { y, empty: settled === 0 };
}

function beatProgress(beat: Beat, tMs: number): number {
  return clamp01((tMs - beat.startMs) / Math.max(1, beat.endMs - beat.startMs));
}

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
  ctx.fillStyle = rgba('#050a12', 0.86);
  roundRect(ctx, x, y, w, h, 26 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.3);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  text(ctx, 'EVERY OPERATION TOUCHES ONLY THE TOP', x + 34 * k, y + 52 * k, {
    size: 24 * k,
    color: rgba(pal.ink, 0.55),
    mono: true
  });
  const rows = [
    { label: 'PUSH', value: plan.copy.time.match(/O\([^)]+\)/)?.[0] || 'O(1)' },
    { label: 'POP', value: 'O(1)' },
    { label: 'PEEK', value: 'O(1)' }
  ];
  rows.forEach((row, index) => {
    const rowY = y + 108 * k + index * 0;
    const chipW = (w - 68 * k) / 3;
    const cx = x + 34 * k + index * chipW;
    ctx.fillStyle = rgba(index === 0 ? pal.accent : pal.violet, 0.1);
    roundRect(ctx, cx, rowY - 26 * k, chipW - 14 * k, 68 * k, 16 * k);
    ctx.fill();
    text(ctx, row.label, cx + 18 * k, rowY + 16 * k, { size: 28 * k, color: pal.ink, weight: 700, mono: true });
    text(ctx, row.value, cx + chipW - 32 * k, rowY + 16 * k, {
      size: 28 * k,
      color: pal.accent,
      weight: 800,
      mono: true,
      align: 'right'
    });
  });
  ctx.restore();

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
  ctx.fillStyle = rgba('#080e18', 0.94);
  roundRect(ctx, insetX, insetY, insetW, insetH, 30 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.coral, 0.45);
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();

  drawChip(ctx, insetX + 34 * k, insetY + 54 * k, 'EXAMPLE · NOT PART OF THE TRACE', {
    size: 22 * k,
    color: pal.coral,
    align: 'left'
  });
  text(ctx, 'POP() on an empty stack', insetX + 34 * k, insetY + 138 * k, {
    size: 42 * k,
    color: pal.ink,
    weight: 800
  });
  text(ctx, 'returned EMPTY · size stays 0', insetX + 34 * k, insetY + 188 * k, {
    size: 30 * k,
    color: rgba(pal.ink, 0.65),
    mono: true
  });

  const emptyX = insetX + insetW / 2;
  const plateY = insetY + insetH - 118 * k;
  ctx.fillStyle = rgba(pal.accent, 0.1);
  roundRect(ctx, emptyX - 200 * k, plateY - 22 * k, 400 * k, 44 * k, 12 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.3);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  text(ctx, 'TOP = empty', emptyX, plateY + 60 * k, {
    size: 30 * k,
    color: pal.coral,
    weight: 700,
    mono: true,
    align: 'center'
  });

  const popPulse = bump(tMs, beat.startMs + (beat.endMs - beat.startMs) * 0.62, 900);
  drawChip(ctx, emptyX, plateY - 74 * k - popPulse * 10 * k, 'POP() → EMPTY', {
    size: 28 * k,
    color: pal.coral,
    align: 'center',
    filled: true
  });
  ctx.restore();
}

function lifoOverlay(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  plan: StackPlan,
  beat: Beat,
  tMs: number
): void {
  const k = dims.width / 1080;
  const p = beatProgress(beat, tMs);
  const alpha = envelope(tMs, beat.startMs, beat.endMs, 240, 300);
  if (alpha <= 0.01) return;

  const last = plan.ops[plan.ops.length - 1];
  const items = last ? last.event.items : [];
  const topValue = items.length ? items[items.length - 1] : null;
  const bottomValue = items.length ? items[0] : null;

  ctx.save();
  ctx.globalAlpha = alpha;
  const cardW = dims.width - 180 * k;
  const cardX = 90 * k;
  const cardY = dims.height - 470 * k;
  ctx.fillStyle = rgba('#050a12', 0.85);
  roundRect(ctx, cardX, cardY, cardW, 150 * k, 24 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.28);
  ctx.lineWidth = 2 * k;
  ctx.stroke();
  text(ctx, 'LIFO', cardX + 32 * k, cardY + 70 * k, { size: 52 * k, color: pal.accent, weight: 800, mono: true });
  text(ctx, 'Last In, First Out', cardX + 32 * k, cardY + 114 * k, {
    size: 30 * k,
    color: rgba(pal.ink, 0.75),
    weight: 600
  });
  text(ctx, `${topValue ?? '—'} leaves before ${bottomValue ?? '—'}`, cardX + cardW - 32 * k, cardY + 74 * k, {
    size: 28 * k,
    color: pal.coral,
    weight: 700,
    mono: true,
    align: 'right'
  });
  text(ctx, `${String(topValue ?? '—')} was pushed last`, cardX + cardW - 32 * k, cardY + 114 * k, {
    size: 24 * k,
    color: rgba(pal.ink, 0.55),
    mono: true,
    align: 'right'
  });
  ctx.restore();

  // A ghost of the newest value lifts out and returns: the LIFO demonstration.
  if (topValue !== null) {
    const lift = Math.sin(Math.PI * clamp01(track(p, 0.12, 0.82)));
    ctx.save();
    ctx.globalAlpha = alpha * (0.35 + 0.45 * lift);
    ctx.translate(0, -lift * 90);
    drawBlock(ctx, {
      x: -BLOCK_W / 2,
      y: FLOOR_Y - items.length * SLOT + (SLOT - BLOCK_H) / 2,
      w: BLOCK_W,
      h: BLOCK_H,
      value: topValue,
      pal,
      tone: 'match',
      glow: lift,
      alpha: 0.9
    });
    ctx.restore();
  }
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

  backdrop(ctx, dims, cam, pal, tMs, { glow: inBrand ? 0.6 : 1 });

  pushCamera(ctx, dims, cam);
  drawPlatform(ctx, { x: -430, y: FLOOR_Y, w: 860, pal, alpha: inBrand ? 0.35 : 1 });
  text(ctx, 'STACK', 0, FLOOR_Y + 112, {
    size: 24,
    color: rgba(pal.ink, 0.3),
    mono: true,
    align: 'center'
  });

  const blocks = blocksAt(plan, tMs);
  for (const item of blocks) {
    const y = item.bottom - BLOCK_H;
    drawBlock(ctx, {
      x: -BLOCK_W / 2 + item.x,
      y,
      w: BLOCK_W,
      h: BLOCK_H,
      value: item.block.value,
      pal,
      tone: item.tone,
      alpha: item.alpha,
      scale: item.scale,
      glow: item.glow
    });
  }

  // Slot indices on the left keep the spatial order unambiguous.
  for (const item of blocks) {
    if (item.alpha < 0.5) continue;
    const y = item.bottom - BLOCK_H / 2;
    text(ctx, String(item.block.slot), -BLOCK_W / 2 - 46, y + 9, {
      size: 26,
      color: rgba(pal.ink, 0.38),
      mono: true,
      align: 'right',
      alpha: item.alpha
    });
    ctx.fillStyle = rgba(pal.ink, 0.16);
    ctx.fillRect(-BLOCK_W / 2 - 34, y, 16, 2);
  }

  if (!inBrand) {
    const pointer = pointerY(plan, tMs);
    drawTopPointer(ctx, {
      x: BLOCK_W / 2,
      y: pointer.empty ? FLOOR_Y - 8 : pointer.y - BLOCK_H / 2,
      label: 'TOP',
      sub: pointer.empty ? 'empty' : String(state.top ?? '—'),
      pal,
      alpha: 0.95,
      color: pointer.empty ? pal.coral : pal.accent
    });

    // Size readout on the platform edge.
    text(ctx, `size ${state.size}`, -430, FLOOR_Y + 54, {
      size: 24,
      color: rgba(pal.ink, 0.42),
      mono: true
    });
  }

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  const headerAlpha = 1 - track(tMs, (brandBeat?.startMs ?? Infinity), (brandBeat?.startMs ?? Infinity) + 300);
  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.name,
    step: activeOp ? `STEP ${String(activeOp.index + 1).padStart(2, '0')} / ${String(plan.ops.length).padStart(2, '0')}` : 'STACK',
    alpha: headerAlpha
  });

  const k = dims.width / 1080;
  const hookBeat = plan.beats.find((item) => item.key === 'intro');
  const setupBeat = plan.beats.find((item) => item.key === 'setup');

  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const p = beatProgress(hookBeat, tMs);
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    drawChip(ctx, 64 * k, 300 * k, 'STACK · LIFO', { size: 24 * k, color: pal.accent, align: 'left' });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, (1 - easeOutCubic(track(p, 0, 0.4))) * 28 * k);
    ctx.font = `800 ${Math.round(74 * k)}px ${SANS}`;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const words = (plan.copy.hook || 'A stack only lets you touch the top.').split(' ');
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
    lines.slice(0, 3).forEach((item, index) => ctx.fillText(item, 64 * k, 410 * k + index * 88 * k));
    ctx.strokeStyle = rgba(pal.accent, 0.9);
    ctx.lineWidth = 5 * k;
    const grow = easeOutCubic(track(p, 0.2, 0.55));
    ctx.beginPath();
    ctx.moveTo(64 * k, 410 * k + lines.slice(0, 3).length * 88 * k + 6 * k);
    ctx.lineTo(64 * k + 190 * k * grow, 410 * k + lines.slice(0, 3).length * 88 * k + 6 * k);
    ctx.stroke();
    ctx.restore();
  }

  if (setupBeat && tMs >= setupBeat.startMs && tMs < setupBeat.endMs) {
    const alpha = envelope(tMs, setupBeat.startMs, setupBeat.endMs, 220, 260);
    drawChip(ctx, 64 * k, 300 * k, 'STACK · LIFO', { size: 24 * k, color: pal.accent, align: 'left', alpha });
    hudOperation(ctx, dims, pal, {
      label: 'PUSH adds · POP removes',
      detail: 'only the top element is reachable',
      alpha
    });
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
    lifoOverlay(ctx, dims, pal, plan, lifoBeat, tMs);
    captionBar(ctx, dims, pal, {
      text: plan.copy.takeaway || 'The last value in is the first value out.',
      alpha: envelope(tMs, lifoBeat.startMs, lifoBeat.endMs, 240, 300)
    });
  }

  const complexityBeat = plan.beats.find((item) => item.key === 'complexity');
  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    const p = beatProgress(complexityBeat, tMs);
    if (p > 0.5) curtain(ctx, dims, pal, 0.32 * track(p, 0.5, 0.6));
    complexityPanel(ctx, dims, pal, plan, complexityBeat, tMs);
    captionBar(ctx, dims, pal, {
      text:
        p < 0.5
          ? `PUSH, POP and PEEK are ${plan.copy.time || 'O(1)'} — only the top is touched. Space: ${plan.copy.space || 'O(n)'}.`
          : 'Underflow: popping an empty stack returns EMPTY instead of a value.',
      alpha: envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 240, 300)
    });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = beatProgress(brandBeat, tMs);
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.22)) * 0.85);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }

  footer(ctx, dims, pal, {
    progress: plan.durationMs > 0 ? tMs / plan.durationMs : 0,
    mark: plan.brand.watermark || plan.brand.name,
    alpha: headerAlpha
  });
}
