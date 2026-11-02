/**
 * The structure painter.
 *
 * One renderer for the queue, the hash table and both tree shorts: it draws
 * whatever frame the plan's timeline is on, then the same header, hook, operation
 * banner, result toast, complexity panel and branded closing the other shorts use.
 * Because the frame comes from a verified trace step, the picture can only show
 * states the algorithm produced.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { clamp01, easeInOutCubic, easeOutCubic, envelope, lerp, track } from './easing.ts';
import { factsPanel } from './facts.ts';
import type { Camera, Dims, Palette } from './stage.ts';
import type { StructurePlan } from './plan.ts';
import type { StructureFrame, StructureNode, StructureTone } from './structure-types.ts';
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
  toast
} from './stage.ts';
import { drawText } from '../render/layout.ts';
import { rgba } from '../render/paint.ts';

const TONE: Record<StructureTone, 'normal' | 'active' | 'match' | 'dim'> = {
  normal: 'normal',
  active: 'active',
  done: 'match',
  dim: 'dim'
};

export type StructureState = {
  /** Index of the step being shown, or -1 before the trace starts. */
  index: number;
  frame: StructureFrame | null;
  previous: StructureFrame | null;
  /** How far into the current step window, 0..1. */
  progress: number;
  /** True once the trace has run out and the result is held. */
  hold: boolean;
};

/** The frame the picture shows at `tMs`, read from the verified step windows. */
export function structureStateAt(plan: StructurePlan, tMs: number): StructureState {
  let previous: StructureFrame | null = null;
  for (const window of plan.steps) {
    if (tMs < window.startMs) {
      return { index: -1, frame: null, previous, progress: 0, hold: false };
    }
    if (tMs < window.endMs) {
      return {
        index: window.index,
        frame: window.frame,
        previous,
        progress: (tMs - window.startMs) / Math.max(1, window.endMs - window.startMs),
        hold: false
      };
    }
    previous = window.frame;
  }
  const last = plan.steps[plan.steps.length - 1];
  return {
    index: last ? last.index : -1,
    frame: last ? last.frame : null,
    previous,
    progress: 1,
    hold: true
  };
}

function cameraFor(plan: StructurePlan, tMs: number): Camera {
  const base = { x: 0, y: 20, zoom: 1.02 };
  const opening = plan.beats.find((beat) => beat.key === 'open');
  if (opening && tMs < opening.endMs) {
    const p = easeInOutCubic(clamp01((tMs - opening.startMs) / Math.max(1, opening.endMs - opening.startMs)));
    return { x: 0, y: lerp(84, base.y, p), zoom: lerp(1.08, base.zoom, p) };
  }
  if (plan.hold && tMs >= plan.hold.startMs) {
    const p = easeInOutCubic(clamp01((tMs - plan.hold.startMs) / 700));
    return { x: 0, y: lerp(base.y, 30, p), zoom: lerp(base.zoom, 1.03, p) };
  }
  return { x: Math.sin(tMs / 5200) * 8, y: base.y + Math.sin(tMs / 4100) * 4, zoom: base.zoom };
}

/** A link between two nodes, trimmed so the arrowhead lands on the target's edge. */
function drawEdge(
  ctx: SKRSContext2D,
  pal: Palette,
  from: StructureNode,
  to: StructureNode,
  alpha: number,
  bright: boolean
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const startX = from.x + ux * (from.h / 2 - 6);
  const startY = from.y + uy * (from.h / 2 - 6);
  const endX = to.x - ux * (to.h / 2 + 8);
  const endY = to.y - uy * (to.h / 2 + 8);

  ctx.save();
  ctx.globalAlpha = alpha * (bright ? 0.85 : 0.4);
  ctx.strokeStyle = bright ? pal.accent : inkTone(pal, 0.34);
  ctx.lineWidth = bright ? 4 : 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Arrowhead at the child end: the direction the ordering invariant sends you.
  const size = bright ? 16 : 13;
  ctx.fillStyle = bright ? pal.accent : inkTone(pal, 0.34);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - ux * size - uy * size * 0.55, endY - uy * size + ux * size * 0.55);
  ctx.lineTo(endX - ux * size + uy * size * 0.55, endY - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawNode(
  ctx: SKRSContext2D,
  pal: Palette,
  node: StructureNode,
  alpha: number,
  scale: number
): void {
  if (alpha <= 0.02) return;
  const tone = node.tone ?? 'normal';
  drawBlock(ctx, {
    x: node.x - node.w / 2,
    y: node.y - node.h / 2,
    w: node.w,
    h: node.h,
    value: node.value,
    pal,
    tone: TONE[tone],
    alpha,
    scale,
    glow: tone === 'active' ? 0.75 : tone === 'done' ? 0.28 : 0.04,
    valueSize: Math.min(node.w, node.h) * 0.36,
    group: `node:${node.id}`
  });

  if (node.sub) {
    drawText(ctx, node.sub, {
      box: { x: node.x - node.w / 2 - 10, y: node.y + node.h / 2 + 16, w: node.w + 20, h: 32 },
      role: 'mono',
      weight: 400,
      size: 26,
      minSize: 18,
      maxLines: 1,
      align: 'center',
      color: inkTone(pal, 0.5),
      alpha,
      group: `sub:${node.id}`
    });
  }
}

function drawMarker(
  ctx: SKRSContext2D,
  pal: Palette,
  node: StructureNode,
  label: string,
  tone: 'accent' | 'coral' | 'violet',
  place: 'above' | 'below',
  alpha: number
): void {
  if (alpha <= 0.02) return;
  const color = tone === 'coral' ? pal.coral : tone === 'violet' ? pal.violet : pal.accent;
  drawChip(ctx, node.x, node.y + (place === 'above' ? -node.h / 2 - 66 : node.h / 2 + 58), label, {
    size: 24,
    color,
    pal,
    align: 'center',
    alpha,
    maxWidth: 260,
    group: `marker:${node.id}`
  });
}

/** Draws one frame, animating arrivals, departures and the active node. */
function drawFrame(ctx: SKRSContext2D, pal: Palette, state: StructureState, alpha: number, tMs: number): void {
  const frame = state.frame;
  if (!frame || alpha <= 0.02) return;

  const current = new Map(frame.nodes.map((node) => [node.id, node]));
  const before = new Map((state.previous?.nodes ?? []).map((node) => [node.id, node]));
  const entering = easeOutCubic(clamp01(state.progress / 0.42));
  const leaving = 1 - clamp01(state.progress / 0.35);

  // Anything that just left the structure fades out where it stood, so a dequeue
  // or a removed key reads as a removal rather than a redraw.
  for (const node of before.values()) {
    if (current.has(node.id)) continue;
    drawNode(ctx, pal, node, alpha * leaving * 0.55, 1);
  }

  for (const edge of frame.edges) {
    const from = current.get(edge.from);
    const to = current.get(edge.to);
    if (!from || !to) continue;
    drawEdge(ctx, pal, from, to, alpha, (to.tone ?? 'normal') !== 'normal');
  }

  for (const label of frame.labels) {
    const width = label.align === 'left' ? 180 : 250;
    const box = {
      x: label.align === 'right' ? label.x - width : label.align === 'center' ? label.x - width / 2 : label.x,
      y: label.y - 22,
      w: width,
      h: 34
    };
    drawText(ctx, label.text, {
      box,
      role: 'mono',
      weight: 500,
      size: label.size ?? 26,
      minSize: 18,
      maxLines: 1,
      align: label.align ?? 'left',
      color: inkTone(pal, 0.42),
      alpha,
      group: 'structure-label'
    });
  }

  for (const node of frame.nodes) {
    const isNew = state.previous ? !before.has(node.id) : false;
    const p = isNew ? entering : 1;
    const pulse = (node.tone ?? 'normal') === 'active' ? 1 + 0.022 * Math.sin(tMs / 260) : 1;
    drawNode(ctx, pal, node, alpha * p, lerp(0.74, 1, p) * pulse);
  }

  for (const marker of frame.markers) {
    const node = current.get(marker.node);
    if (!node) continue;
    drawMarker(ctx, pal, node, marker.label, marker.tone ?? 'accent', marker.place ?? 'above', alpha * entering);
  }

  if (frame.note) {
    const bottom = Math.max(...frame.nodes.map((node) => node.y + node.h / 2 + 52), 180);
    drawChip(ctx, 0, bottom, frame.note, {
      size: 26,
      color: pal.accent,
      pal,
      align: 'center',
      alpha: alpha * 0.95,
      maxWidth: DESIGN_W - SAFE * 2,
      group: 'structure-note'
    });
  }
}

/** Paints the whole structure short at `tMs`. */
export function drawStructure(ctx: SKRSContext2D, plan: StructurePlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const cam = cameraFor(plan, tMs);
  const state = structureStateAt(plan, tMs);
  const k = dims.width / DESIGN_W;
  const openBeat = plan.beats.find((beat) => beat.key === 'open');
  const brandBeat = plan.beats.find((beat) => beat.key === 'brand');
  const inOpening = Boolean(openBeat && tMs >= openBeat.startMs && tMs < openBeat.endMs);
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);

  backdrop(ctx, dims, cam, pal, tMs, { horizon: -430, glow: inBrand ? 0.6 : 1 });
  pushCamera(ctx, dims, cam);

  const stageFade = brandBeat ? 1 - track(tMs, brandBeat.startMs, brandBeat.startMs + 420) : 1;
  const arrive = openBeat ? clamp01((tMs - (openBeat.endMs - 320)) / 700) : 1;
  // The complexity panel owns the frame: the structure leaves before it arrives,
  // so a bucket label or a tree level can never land under the panel's text.
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity');
  const panelFade = complexityBeat ? 1 - track(tMs, complexityBeat.startMs - 320, complexityBeat.startMs) : 1;
  const structureAlpha = arrive * stageFade * panelFade * (inBrand ? 0.2 : 1);
  drawFrame(ctx, pal, state, structureAlpha, tMs);

  popCamera(ctx);

  /* ---------------------------------------------------------------- overlays */

  const openFade = openBeat ? track(tMs, openBeat.endMs - 180, openBeat.endMs + 120) : 1;
  const headerAlpha = Math.min(
    1 - track(tMs, brandBeat?.startMs ?? Infinity, (brandBeat?.startMs ?? 0) + 300),
    openFade
  );

  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.presenter,
    step: plan.label,
    alpha: headerAlpha
  });

  if (inOpening && openBeat) {
    openingReveal(ctx, dims, pal, plan.opening, tMs, openBeat);
    openingHook(ctx, dims, pal, plan.copy.hook, envelope(tMs, openBeat.startMs + 140, openBeat.endMs - 80, 260, 240));
  }

  const rowAlpha = (openBeat ? clamp01((tMs - (openBeat.endMs - 300)) / 700) : 1) * (inBrand ? 0.25 : 1);
  drawChip(ctx, SAFE * k, BAND.kicker * k, plan.kickers[0], {
    size: 21 * k,
    color: pal.accent,
    pal,
    align: 'left',
    alpha: rowAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.5,
    group: 'kicker'
  });
  drawChip(ctx, dims.width - SAFE * k, BAND.kicker * k, plan.kickers[1], {
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
    const fitted = drawText(ctx, plan.copy.hook || plan.copy.objective, {
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
      label: setupBeat.title,
      detail: setupBeat.caption,
      alpha,
      accent: pal.coral
    });
    captionBar(ctx, dims, pal, { text: setupBeat.caption || plan.copy.objective, alpha });
  }

  const traceBeat = plan.beats.find((beat) => beat.key === 'trace');
  const activeWindow = plan.steps.find((window) => tMs >= window.startMs && tMs < window.endMs);
  if (traceBeat && tMs >= traceBeat.startMs && tMs < traceBeat.endMs) {
    const alpha = envelope(tMs, traceBeat.startMs, traceBeat.endMs, 240, 260);
    if (activeWindow) {
      hudOperation(ctx, dims, pal, {
        label: activeWindow.step.hudLabel,
        detail: activeWindow.step.hudDetail,
        alpha
      });
      captionBar(ctx, dims, pal, { text: activeWindow.step.message, alpha });
    } else if (plan.hold && tMs >= plan.hold.startMs) {
      hudOperation(ctx, dims, pal, {
        label: plan.result.title,
        detail: plan.result.sub,
        alpha
      });
      toast(ctx, dims, pal, {
        text: plan.result.title,
        sub: plan.result.sub,
        color: pal.coral,
        alpha: envelope(tMs, plan.hold.startMs + 180, traceBeat.endMs + 600, 220, 260),
        y: BAND.resultTop + 66
      });
      captionBar(ctx, dims, pal, { text: plan.holdCaption, alpha });
    } else {
      hudOperation(ctx, dims, pal, {
        label: traceBeat.title,
        detail: traceBeat.caption,
        alpha
      });
      captionBar(ctx, dims, pal, { text: traceBeat.caption, alpha });
    }
  }

  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    const alpha = envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 260, 300);
    curtain(ctx, dims, pal, 0.3);
    factsPanel(ctx, dims, pal, 'Complexity', plan.facts, alpha);
    captionBar(ctx, dims, pal, { text: complexityBeat.caption || plan.copy.time, alpha });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = clamp01((tMs - brandBeat.startMs) / Math.max(1, brandBeat.endMs - brandBeat.startMs));
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.24)) * 0.88);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }
}
