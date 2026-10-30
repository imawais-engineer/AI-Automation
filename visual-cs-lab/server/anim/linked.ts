/**
 * Linked list animation.
 *
 * Nodes are separate objects on the stage, each holding a value and a `next`
 * pointer drawn as an arrow to the node after it. There is no index to jump to,
 * so the trace beat is the walk: `curr` starts at the head and follows the links
 * one node at a time, and only the nodes the verified trace visited are lit.
 * The walk stops at the match — the tail stays dormant, which is the cost.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { clamp01, easeInOutCubic, easeOutCubic, envelope, lerp, track } from './easing.ts';
import type { LinkedPlan } from './plan.ts';
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

const NODE_W = 140;
const NODE_H = 112;
const GAP = 42;
const ROW_TOP = -40;
const LINK_Y = ROW_TOP + NODE_H / 2;
const CURR_Y = ROW_TOP - 62;
const HEAD_Y = ROW_TOP + NODE_H + 66;

function rowWidth(plan: LinkedPlan): number {
  return plan.values.length * NODE_W + (plan.values.length - 1) * GAP;
}

function nodeCenter(plan: LinkedPlan, index: number): number {
  return -rowWidth(plan) / 2 + index * (NODE_W + GAP) + NODE_W / 2;
}

export type LinkedVisitState = {
  /** Nodes the pointer has reached. */
  reached: number;
  active: number | null;
  /** How far into the active visit (0..1). */
  focus: number;
  matched: number | null;
  done: boolean;
};

/** The walk the picture shows at `t`, read from the verified visits. */
export function linkedStateAt(plan: LinkedPlan, tMs: number): LinkedVisitState {
  let reached = 0;
  let matched: number | null = null;
  for (const window of plan.steps) {
    const w = Math.max(1, window.endMs - window.startMs);
    if (tMs >= window.endMs) {
      reached = window.index + 1;
      if (window.step.match) matched = window.step.nodeIndex;
      continue;
    }
    if (tMs < window.startMs) break;
    const focus = track(tMs, window.startMs + w * 0.1, window.startMs + w * 0.4);
    return { reached: window.index, active: window.step.nodeIndex, focus, matched, done: false };
  }
  return {
    reached,
    active: null,
    focus: 0,
    matched,
    done: plan.steps.length > 0 && reached === plan.steps.length
  };
}

function cameraFor(plan: LinkedPlan, tMs: number): Camera {
  const base = { x: 0, y: 44, zoom: 1.02 };
  const opening = plan.beats.find((beat) => beat.key === 'open');
  if (opening && tMs < opening.endMs) {
    const p = easeInOutCubic(clamp01((tMs - opening.startMs) / Math.max(1, opening.endMs - opening.startMs)));
    return { x: 0, y: lerp(88, base.y, p), zoom: lerp(1.08, base.zoom, p) };
  }
  if (plan.hold && tMs >= plan.hold.startMs) {
    const p = easeInOutCubic(clamp01((tMs - plan.hold.startMs) / 700));
    return { x: 0, y: lerp(base.y, 52, p), zoom: lerp(base.zoom, 1.03, p) };
  }
  return { x: Math.sin(tMs / 5400) * 9, y: base.y + Math.sin(tMs / 3900) * 4, zoom: base.zoom };
}

/** One `next` arrow, with the arrowhead landing on the node it points at. */
function drawLink(ctx: SKRSContext2D, x1: number, x2: number, pal: Palette, alpha: number, lit: boolean): void {
  if (alpha <= 0.02) return;
  const color = lit ? rgba(pal.accent, 0.9 * alpha) : rgba(pal.ink, 0.26 * alpha);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lit ? 3.4 : 2.2;
  ctx.beginPath();
  ctx.moveTo(x1, LINK_Y);
  ctx.lineTo(x2 - 12, LINK_Y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, LINK_Y);
  ctx.lineTo(x2 - 16, LINK_Y - 9);
  ctx.lineTo(x2 - 16, LINK_Y + 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A pointer chip with a stem onto the node it names. */
function drawPointer(
  ctx: SKRSContext2D,
  cx: number,
  y: number,
  label: string,
  direction: 'up' | 'down',
  pal: Palette,
  color: string,
  alpha: number
): void {
  if (alpha <= 0.02) return;
  const chip = drawChip(ctx, cx, y, label, {
    size: 26,
    color,
    pal,
    align: 'center',
    filled: true,
    alpha,
    maxWidth: 210,
    group: 'pointer'
  });
  const edge = direction === 'down' ? y + chip.height / 2 : y - chip.height / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(color, 0.95);
  ctx.beginPath();
  if (direction === 'down') {
    ctx.moveTo(cx, edge + 18);
    ctx.lineTo(cx - 12, edge + 2);
    ctx.lineTo(cx + 12, edge + 2);
  } else {
    ctx.moveTo(cx, edge - 18);
    ctx.lineTo(cx - 12, edge - 2);
    ctx.lineTo(cx + 12, edge - 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Paints the whole Linked Lists short at `tMs`. */
export function drawLinked(ctx: SKRSContext2D, plan: LinkedPlan, tMs: number, dims: Dims): void {
  const pal = paletteOf(plan.brand);
  const cam = cameraFor(plan, tMs);
  const state = linkedStateAt(plan, tMs);
  const k = dims.width / DESIGN_W;
  const openBeat = plan.beats.find((beat) => beat.key === 'open');
  const brandBeat = plan.beats.find((beat) => beat.key === 'brand');
  const inOpening = Boolean(openBeat && tMs >= openBeat.startMs && tMs < openBeat.endMs);
  const inBrand = Boolean(brandBeat && tMs >= brandBeat.startMs);

  backdrop(ctx, dims, cam, pal, tMs, { horizon: -430, glow: inBrand ? 0.6 : 1 });
  pushCamera(ctx, dims, cam);

  const total = rowWidth(plan);
  const baseline = ROW_TOP + NODE_H + 100;

  const pool = ctx.createRadialGradient(0, baseline + 14, 20, 0, baseline + 14, total * 0.6);
  pool.addColorStop(0, rgba(pal.accent, inBrand ? 0.05 : 0.12));
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, baseline + 16, total * 0.6, 80, 0, 0, Math.PI * 2);
  ctx.fill();

  const nodesStart = openBeat ? openBeat.endMs - 320 : (plan.beats[0]?.startMs ?? 0) + 200;
  // The complexity panel owns the frame: the chain leaves before the panel arrives.
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity');
  const panelFade = complexityBeat ? 1 - track(tMs, complexityBeat.startMs - 320, complexityBeat.startMs) : 1;
  const stageFade = brandBeat ? 1 - track(tMs, brandBeat.startMs, brandBeat.startMs + 420) : 1;
  const nodesAlpha = clamp01((tMs - nodesStart) / 700) * stageFade * panelFade;
  if (nodesAlpha <= 0.02) {
    popCamera(ctx);
    return drawOverlays(ctx, dims, pal, plan, tMs, state, nodesAlpha, inOpening, inBrand);
  }

  // Links first: they sit behind the nodes they join.
  for (let index = 0; index < plan.values.length - 1; index++) {
    const from = nodeCenter(plan, index) + NODE_W / 2 + 2;
    const to = nodeCenter(plan, index + 1) - NODE_W / 2 - 2;
    const lit = index < state.reached - 1 || (state.reached > 0 && index + 1 <= state.reached - 1);
    drawLink(ctx, from, to, pal, nodesAlpha, lit);
  }

  plan.values.forEach((value, index) => {
    const reached = index < state.reached;
    const isActive = state.active === index;
    const isMatch = state.matched === index;
    const known = reached || isActive;
    const tone = isMatch ? 'match' : isActive ? 'active' : known ? 'normal' : 'ghost';
    drawBlock(ctx, {
      x: nodeCenter(plan, index) - NODE_W / 2,
      y: ROW_TOP,
      w: NODE_W,
      h: NODE_H,
      value,
      pal,
      tone,
      alpha: nodesAlpha * (known ? 1 : 0.4),
      scale: isActive ? 1 + 0.03 * state.focus : isMatch ? 1.04 : 1,
      glow: isMatch ? 1 : isActive ? 0.65 : known ? 0.12 : 0,
      valueSize: NODE_W * 0.42,
      group: `node:${index}`
    });
  });

  if (!inBrand && !inOpening && nodesAlpha > 0.2) {
    // head never moves; it names the entry point of the whole structure.
    drawPointer(ctx, nodeCenter(plan, 0), HEAD_Y, 'head', 'up', pal, pal.violet, nodesAlpha);
    const focus = state.active ?? (state.matched !== null ? state.matched : null);
    if (focus !== null) {
      drawPointer(
        ctx,
        nodeCenter(plan, focus),
        CURR_Y,
        state.matched !== null && state.active === null ? 'match' : 'curr',
        'down',
        pal,
        state.matched !== null && state.active === null ? pal.coral : pal.accent,
        nodesAlpha
      );
    }
  }

  popCamera(ctx);
  drawOverlays(ctx, dims, pal, plan, tMs, state, nodesAlpha, inOpening, inBrand);
}

/** Every overlay lives in its own band, so copy never covers the chain. */
function drawOverlays(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  plan: LinkedPlan,
  tMs: number,
  state: LinkedVisitState,
  stageAlpha: number,
  inOpening: boolean,
  inBrand: boolean
): void {
  const k = dims.width / DESIGN_W;
  const openBeat = plan.beats.find((beat) => beat.key === 'open');
  const brandBeat = plan.beats.find((beat) => beat.key === 'brand');
  const complexityBeat = plan.beats.find((beat) => beat.key === 'complexity');

  const openFade = openBeat ? track(tMs, openBeat.endMs - 180, openBeat.endMs + 120) : 1;
  const headerAlpha = Math.min(
    1 - track(tMs, brandBeat?.startMs ?? Infinity, (brandBeat?.startMs ?? 0) + 300),
    openFade
  );

  hudHeader(ctx, dims, pal, {
    watermark: plan.brand.watermark || plan.brand.presenter,
    step: 'LINKED LIST',
    alpha: headerAlpha
  });

  if (inOpening && openBeat) {
    openingReveal(ctx, dims, pal, plan.opening, tMs, openBeat);
    openingHook(ctx, dims, pal, plan.copy.hook, envelope(tMs, openBeat.startMs + 140, openBeat.endMs - 80, 260, 240));
  }

  const pointerAlpha =
    clamp01((tMs - (openBeat ? openBeat.endMs - 300 : (plan.beats[0]?.startMs ?? 0))) / 700) *
    (inBrand ? 0.25 : 1);

  // The chain's identity and what it is being searched for, as a kicker pair.
  drawChip(ctx, SAFE * k, BAND.kicker * k, `${plan.values.length} NODES · HEAD`, {
    size: 21 * k,
    color: pal.accent,
    pal,
    align: 'left',
    alpha: pointerAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.5,
    group: 'kicker'
  });
  drawChip(ctx, dims.width - SAFE * k, BAND.kicker * k, `TARGET ${plan.target}`, {
    size: 21 * k,
    color: pal.violet,
    pal,
    align: 'right',
    alpha: pointerAlpha,
    maxWidth: (dims.width - 2 * SAFE * k) * 0.45,
    group: 'kicker'
  });

  const hookBeat = plan.beats.find((beat) => beat.key === 'intro');
  if (hookBeat && tMs >= hookBeat.startMs && tMs < hookBeat.endMs) {
    const p = clamp01((tMs - hookBeat.startMs) / Math.max(1, hookBeat.endMs - hookBeat.startMs));
    const alpha = envelope(tMs, hookBeat.startMs, hookBeat.endMs, 320, 380);
    const rise = (1 - easeOutCubic(track(p, 0, 0.42))) * 26 * k;
    const box = safeBox(k, BAND.hookTop, BAND.hookBottom);
    const fitted = drawText(ctx, plan.copy.hook || 'No index, no jump: you walk the links.', {
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
      label: 'node = value + next',
      detail: 'each node stores where the next one lives — no contiguous block',
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
      const step = activeWindow.step;
      hudOperation(ctx, dims, pal, {
        label: `node ${step.nodeIndex} · curr.value = ${step.value}`,
        detail: step.match
          ? `${step.value} = ${plan.target} → the walk ends here`
          : `${step.value} ≠ ${plan.target} → curr = curr.next (node ${step.nodeIndex + 1})`,
        alpha
      });
      captionBar(ctx, dims, pal, { text: step.message, alpha });
    } else if (plan.hold && tMs >= plan.hold.startMs) {
      const comparisons = plan.steps.length;
      hudOperation(ctx, dims, pal, {
        label: `visited ${comparisons} of ${plan.values.length} nodes`,
        detail: 'O(n) search — the pointer only moves forward',
        alpha
      });
      toast(ctx, dims, pal, {
        text: plan.foundIndex === null ? 'NOT FOUND · null' : `FOUND · NODE ${plan.foundIndex}`,
        sub:
          plan.foundIndex === null
            ? `${comparisons} nodes checked, then the chain ended`
            : `${plan.target} after ${comparisons} node${comparisons === 1 ? '' : 's'} · walk stops`,
        color: pal.coral,
        alpha: envelope(tMs, plan.hold.startMs + 180, traceBeat.endMs + 600, 220, 260)
      });
      captionBar(ctx, dims, pal, {
        text:
          plan.foundIndex === null
            ? `Every node checked — ${plan.target} is not in the list.`
            : `Found at node ${plan.foundIndex} — no node after it was touched.`,
        alpha
      });
    } else if (plan.traceIntro && tMs >= plan.traceIntro.startMs) {
      hudOperation(ctx, dims, pal, {
        label: 'curr = head',
        detail: 'follow next until the value matches, or the chain ends',
        alpha
      });
      captionBar(ctx, dims, pal, { text: `Search the list for ${plan.target}.`, alpha });
    }
  }

  if (complexityBeat && tMs >= complexityBeat.startMs && tMs < complexityBeat.endMs) {
    const alpha = envelope(tMs, complexityBeat.startMs, complexityBeat.endMs, 260, 300);
    curtain(ctx, dims, pal, 0.3);
    factsPanel(ctx, dims, pal, 'Complexity', [
      { label: 'Search', value: plan.copy.time || 'O(n) — walk from the head' },
      { label: 'Insert or delete at a known node', value: 'O(1) — relink two next pointers' },
      { label: 'This walk', value: `${plan.steps.length} nodes reached of ${plan.values.length}` }
    ], alpha);
    captionBar(ctx, dims, pal, {
      text: 'Search is O(n); relinking at a known node is O(1). Memory: O(n).',
      alpha
    });
  }

  if (brandBeat && tMs >= brandBeat.startMs) {
    const p = clamp01((tMs - brandBeat.startMs) / Math.max(1, brandBeat.endMs - brandBeat.startMs));
    curtain(ctx, dims, pal, easeOutCubic(track(p, 0, 0.24)) * 0.88);
    brandEnd(ctx, dims, pal, plan.brand, p);
  }

  void stageAlpha;
  void state;
}
