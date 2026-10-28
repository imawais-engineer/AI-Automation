/**
 * Shared visual language of the motion engine: stage, 2.5D objects, cameras and
 * the on-screen overlays.
 *
 * The whole video is drawn in a 1080 × 1920 design space and scaled to whatever
 * the output profile asks for, so a 540 × 960 preview is the same composition as
 * the 1080 × 1920 export.
 *
 * Three typographic roles carry the hierarchy — Space Grotesk for headlines, Inter
 * for explanation, JetBrains Mono for code, indices and state — and every overlay
 * owns a band of the frame, so copy can never drift into the animation area.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { clamp01, easeOutCubic, lerp, track } from './easing.ts';
import { recordObject, recordPointer, recordText, type Rect } from './audit.ts';
import { type Side, anchorEdgePoint, chipEdgePoint, overlapArea, placeChip } from './anchors.ts';
import { drawText, ellipsize, fitText, textWidth } from '../render/layout.ts';
import { mix, rgba, roundRect } from '../render/paint.ts';
import { fontString, type FontRole } from '../render/typography.ts';

export type Dims = { width: number; height: number };
export type Camera = { x: number; y: number; zoom: number };

export type Palette = {
  bg: string;
  panel: string;
  ink: string;
  accent: string;
  coral: string;
  violet: string;
};

export type BrandLike = {
  name: string;
  accent: string;
  background: string;
  panel: string;
  ink: string;
  watermark: string;
  outro: string;
};

export function paletteOf(brand: BrandLike): Palette {
  return {
    bg: brand.background || '#0b1220',
    panel: brand.panel || '#141c2e',
    ink: brand.ink || '#e6edf7',
    accent: brand.accent || '#22d3ee',
    coral: '#ff8a70',
    violet: '#a78bfa'
  };
}

export const DESIGN_W = 1080;
export const DESIGN_H = 1920;
export const SAFE = 64;

/**
 * The frame's overlay grid, in design pixels. Each overlay is only allowed inside
 * its own band, which is what keeps a banner, a result card, a pointer label and
 * the caption strip from ever landing on top of each other.
 */
export const BAND = {
  headerTop: 46,
  headerRule: 104,
  kicker: 150,
  operationTop: 196,
  operationBottom: 306,
  hookTop: 214,
  hookBottom: 760,
  resultTop: 336,
  resultBottom: 508,
  captionGap: 194,
  footer: 78
};

/** Content box of the frame for a given width factor. */
export function safeBox(k: number, top = 0, bottom = DESIGN_H): Rect {
  return { x: SAFE * k, y: Math.max(0, top) * k, w: (DESIGN_W - SAFE * 2) * k, h: (bottom - top) * k };
}

export function font(size: number, weight = 400, mono = false): string {
  return fontString(mono ? 'mono' : 'text', weight, size);
}

export function displayFont(size: number, weight = 700): string {
  return fontString('display', weight, size);
}

/**
 * One fitted line of text at a baseline. Long strings are cut with an ellipsis
 * instead of running past `maxWidth`, so a watermark can never reach the frame edge.
 */
export function text(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  opts: {
    size: number;
    color: string;
    weight?: number;
    mono?: boolean;
    display?: boolean;
    align?: CanvasTextAlign;
    alpha?: number;
    maxWidth?: number;
  }
): number {
  const role: FontRole = opts.display ? 'display' : opts.mono ? 'mono' : 'text';
  const weight = opts.weight ?? 600;
  const maxWidth = opts.maxWidth ?? DESIGN_W * 2;
  const cut = ellipsize(ctx, value, maxWidth, role, weight, opts.size);
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = fontString(role, weight, opts.size);
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(cut.text, x, y);
  ctx.restore();
  return cut.width;
}

/** Pushes the design-space camera. Pair with `popCamera`. */
export function pushCamera(ctx: SKRSContext2D, dims: Dims, cam: Camera): number {
  const k = dims.width / DESIGN_W;
  ctx.save();
  ctx.translate(dims.width / 2, dims.height / 2);
  ctx.scale(k * cam.zoom, k * cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  return k;
}

export function popCamera(ctx: SKRSContext2D): void {
  ctx.restore();
}

/**
 * Deep stage: a soft vertical gradient, a perspective floor and a single
 * spotlight pool. The camera moves at reduced parallax so the room feels large.
 */
export function backdrop(
  ctx: SKRSContext2D,
  dims: Dims,
  cam: Camera,
  pal: Palette,
  tMs: number,
  opts: { horizon?: number; glow?: number } = {}
): void {
  const { width: W, height: H } = dims;
  const k = W / DESIGN_W;
  const horizon = opts.horizon ?? -260;

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, mix(pal.bg, '#02040a', 0.55));
  base.addColorStop(0.55, mix(pal.bg, '#060a13', 0.2));
  base.addColorStop(1, mix(pal.bg, '#000000', 0.35));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const breathe = 0.7 + Math.sin(tMs / 2800) * 0.08;
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.52, 0, W * 0.5, H * 0.52, H * 0.62);
  glow.addColorStop(0, rgba(pal.accent, 0.16 * (opts.glow ?? 1) * breathe));
  glow.addColorStop(0.45, rgba(pal.violet, 0.05));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Parallax floor grid.
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(k, k);
  ctx.translate(-cam.x * 0.22, -cam.y * 0.28);

  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 16; i++) {
    const p = i / 16;
    const y = horizon + Math.pow(p, 2.3) * 2300;
    ctx.strokeStyle = rgba(pal.accent, 0.05 * (1 - p * 0.7));
    ctx.beginPath();
    ctx.moveTo(-1400, y);
    ctx.lineTo(1400, y);
    ctx.stroke();
  }
  for (let i = -9; i <= 9; i++) {
    const spread = i * 190;
    ctx.strokeStyle = rgba(pal.accent, i % 3 === 0 ? 0.055 : 0.028);
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(spread, 1500);
    ctx.stroke();
  }
  ctx.restore();

  // Vignette keeps overlays readable over the glow.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.82);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

/** A glass plinth: the floor the data structure stands on. */
export function drawPlatform(
  ctx: SKRSContext2D,
  opts: { x: number; y: number; w: number; pal: Palette; alpha?: number; lift?: number }
): void {
  const { x, y, w, pal } = opts;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0) return;
  const depth = 74;
  const lip = 26;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Light pool on the floor, under the data structure.
  const pool = ctx.createRadialGradient(0, y + 40, 0, 0, y + 40, w * 0.72);
  pool.addColorStop(0, rgba(pal.accent, 0.22));
  pool.addColorStop(0.6, rgba(pal.accent, 0.06));
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, y + 46, w * 0.72, 120, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top face, drawn in perspective.
  const topGradient = ctx.createLinearGradient(0, y - depth, 0, y);
  topGradient.addColorStop(0, mix(pal.panel, pal.accent, 0.26));
  topGradient.addColorStop(1, mix(pal.panel, '#050810', 0.5));
  ctx.fillStyle = topGradient;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - depth * 0.55, y - depth);
  ctx.lineTo(x + depth * 0.55, y - depth);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.45);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Front lip.
  const lipGradient = ctx.createLinearGradient(0, y, 0, y + lip);
  lipGradient.addColorStop(0, mix(pal.panel, '#000000', 0.15));
  lipGradient.addColorStop(1, mix(pal.panel, '#000000', 0.72));
  ctx.fillStyle = lipGradient;
  roundRect(ctx, x, y - 6, w, lip, 10);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 0.08);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();
}

export type BlockTone = 'normal' | 'active' | 'match' | 'dim' | 'ghost';

export type BlockOptions = {
  /** Top-left of the front face, in design coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  value: number | string;
  pal: Palette;
  tone?: BlockTone;
  alpha?: number;
  scale?: number;
  glow?: number;
  valueSize?: number;
  /** Audit group; the value text shares it so it is not reported as a collision. */
  group?: string;
};

/**
 * A solid, slightly extruded block. Light comes from above: the top face is the
 * brightest plane, the front face is a vertical gradient, the right plane falls
 * into shadow, and a contact shadow anchors it to whatever it rests on.
 */
export function drawBlock(ctx: SKRSContext2D, opts: BlockOptions): void {
  const { pal, w, h } = opts;
  const tone = opts.tone ?? 'normal';
  const alpha = clamp01(opts.alpha ?? 1);
  if (alpha <= 0) return;

  const group = opts.group ?? 'block';
  const dx = Math.round(w * 0.05);
  const dy = Math.round(h * 0.16);
  const cx = opts.x + w / 2;
  const cy = opts.y + h / 2;

  const scale = opts.scale ?? 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  // Shapes faded out are not on screen; recording them would invent collisions.
  if (alpha >= 0.15) {
    recordObject(ctx, group, { x: opts.x, y: opts.y - dy, w: w + dx, h: h + dy }, String(opts.value));
  }

  const glow = clamp01(opts.glow ?? 0);
  if (glow > 0.01) {
    const color = tone === 'match' ? pal.coral : pal.accent;
    const halo = ctx.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.95);
    halo.addColorStop(0, rgba(color, 0.3 * glow));
    halo.addColorStop(0.5, rgba(color, 0.12 * glow));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.95, 0, Math.PI * 2);
    ctx.fill();
  }

  // Contact shadow directly beneath the block.
  const shadow = ctx.createRadialGradient(cx, opts.y + h + 12, 4, cx, opts.y + h + 12, w * 0.62);
  shadow.addColorStop(0, `rgba(0,0,0,${0.52 * alpha})`);
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx, opts.y + h + 10, w * 0.6, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const faceTop =
    tone === 'match'
      ? mix(pal.panel, pal.coral, 0.42)
      : tone === 'active'
        ? mix(pal.panel, pal.violet, 0.3)
        : tone === 'dim'
          ? mix(pal.panel, '#05070c', 0.25)
          : mix(pal.panel, '#2c3c57', 0.32);
  const faceBottom =
    tone === 'match'
      ? mix(pal.panel, pal.coral, 0.06)
      : tone === 'active'
        ? mix(pal.panel, '#05070c', 0.5)
        : mix(pal.panel, '#04060c', 0.62);

  // Right plane (shadow side).
  ctx.fillStyle = mix(faceBottom, '#000000', 0.45);
  ctx.beginPath();
  ctx.moveTo(opts.x + w, opts.y);
  ctx.lineTo(opts.x + w + dx, opts.y - dy);
  ctx.lineTo(opts.x + w + dx, opts.y + h - dy);
  ctx.lineTo(opts.x + w, opts.y + h);
  ctx.closePath();
  ctx.fill();

  // Top plane (lit).
  const topFill = ctx.createLinearGradient(opts.x, opts.y - dy, opts.x + w, opts.y);
  topFill.addColorStop(0, mix(faceTop, '#ffffff', 0.24));
  topFill.addColorStop(1, mix(faceTop, '#ffffff', 0.06));
  ctx.fillStyle = topFill;
  ctx.beginPath();
  ctx.moveTo(opts.x, opts.y);
  ctx.lineTo(opts.x + dx, opts.y - dy);
  ctx.lineTo(opts.x + w + dx, opts.y - dy);
  ctx.lineTo(opts.x + w, opts.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 0.16);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Front face.
  const face = ctx.createLinearGradient(opts.x, opts.y, opts.x, opts.y + h);
  face.addColorStop(0, faceTop);
  face.addColorStop(1, faceBottom);
  ctx.fillStyle = face;
  roundRect(ctx, opts.x, opts.y, w, h, Math.round(h * 0.14));
  ctx.fill();

  const edge = tone === 'match' ? pal.coral : tone === 'active' ? pal.violet : pal.accent;
  ctx.strokeStyle = rgba(edge, tone === 'dim' ? 0.14 : 0.36);
  ctx.lineWidth = 2.2;
  roundRect(ctx, opts.x, opts.y, w, h, Math.round(h * 0.14));
  ctx.stroke();

  // Inner top highlight, so the solid reads as a lit surface.
  ctx.strokeStyle = rgba('#ffffff', tone === 'dim' ? 0.06 : 0.16);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(opts.x + w * 0.05, opts.y + 4);
  ctx.lineTo(opts.x + w * 0.95, opts.y + 4);
  ctx.stroke();

  if (tone === 'ghost') {
    ctx.globalAlpha = alpha * 0.35;
  }

  // The value is data, so it is set in the mono face and fitted to the face.
  const inkColor = tone === 'dim' ? rgba(pal.ink, 0.42) : tone === 'match' ? '#fff6f2' : pal.ink;
  drawText(ctx, String(opts.value), {
    box: { x: opts.x + w * 0.14, y: opts.y + h * 0.2, w: w * 0.72, h: h * 0.62 },
    role: 'mono',
    weight: 600,
    size: opts.valueSize ?? h * 0.5,
    minSize: h * 0.2,
    maxLines: 1,
    align: 'center',
    valign: 'middle',
    color: inkColor,
    group,
    truncateOk: true
  });

  ctx.restore();
}

export type AnchorLabelOptions = {
  /** The target object's rendered bounds — recomputed every frame. */
  anchor: Rect;
  anchorId: string;
  group: string;
  label: string;
  sub?: string;
  pal: Palette;
  color: string;
  /** The frame (or overlay card) the chip must stay inside. */
  bounds: Rect;
  obstacles?: Rect[];
  prefer?: Side[];
  gap?: number;
  filled?: boolean;
  alpha?: number;
  /** Draw the chip above the anchor and keep a straight stem. */
  role?: FontRole;
  size?: number;
};

/**
 * A label chip attached to an anchor with a leader line and an arrow at the
 * target. Both endpoints are derived from the anchor's current rect, so the
 * pointer moves with the object instead of with a hand-tuned coordinate.
 */
export function drawAnchorLabel(ctx: SKRSContext2D, opts: AnchorLabelOptions): Rect | null {
  const alpha = clamp01(opts.alpha ?? 1);
  if (alpha <= 0.02) return null;
  const size = opts.size ?? 26;
  const role = opts.role ?? 'mono';
  const labelW = textWidth(ctx, opts.label, role, 600, size);
  const subW = opts.sub ? textWidth(ctx, opts.sub, 'mono', 400, size * 0.82) : 0;
  const padX = Math.round(size * 0.85);
  const w = Math.max(labelW, subW) + padX * 2;
  const h = opts.sub ? size * 2.5 : size * 1.9;

  const chip = placeChip({
    anchor: opts.anchor,
    w,
    h,
    bounds: opts.bounds,
    obstacles: opts.obstacles ?? [],
    gap: opts.gap ?? 30,
    prefer: opts.prefer
  });

  const tail = anchorEdgePoint(opts.anchor, chip);
  const head = chipEdgePoint(chip, opts.anchor);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgba(opts.color, 0.7);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  // Elbow when the chip had to move off the anchor's centre line.
  if (chip.side === 'above' || chip.side === 'below') {
    ctx.lineTo(head.x, head.y + (chip.side === 'above' ? 6 : -6));
    ctx.lineTo(head.x, head.y);
  } else {
    ctx.lineTo(head.x, head.y);
  }
  ctx.stroke();

  // Anchor dot: unambiguous proof of the exact point being marked.
  ctx.fillStyle = opts.color;
  ctx.beginPath();
  ctx.arc(tail.x, tail.y, 5.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = opts.filled ? opts.color : rgba('#060b14', 0.9);
  roundRect(ctx, chip.x, chip.y, chip.w, chip.h, Math.round(chip.h / 2));
  ctx.fill();
  ctx.strokeStyle = opts.filled ? rgba('#000000', 0.18) : rgba(opts.color, 0.6);
  ctx.lineWidth = 2;
  ctx.stroke();

  const ink = opts.filled ? '#06101a' : opts.color;
  if (opts.sub) {
    drawText(ctx, opts.label, {
      box: { x: chip.x + padX * 0.4, y: chip.y + chip.h * 0.14, w: chip.w - padX * 0.8, h: chip.h * 0.48 },
      role,
      weight: 600,
      size: size * 0.92,
      minSize: size * 0.62,
      maxLines: 1,
      align: 'center',
      valign: 'middle',
      color: ink,
      group: opts.group,
      truncateOk: true
    });
    drawText(ctx, opts.sub, {
      box: { x: chip.x + padX * 0.4, y: chip.y + chip.h * 0.52, w: chip.w - padX * 0.8, h: chip.h * 0.4 },
      role: 'mono',
      weight: 400,
      size: size * 0.8,
      minSize: size * 0.55,
      maxLines: 1,
      align: 'center',
      valign: 'middle',
      color: opts.filled ? rgba('#06101a', 0.75) : rgba(opts.pal.ink, 0.82),
      group: opts.group,
      truncateOk: true
    });
  } else {
    drawText(ctx, opts.label, {
      box: { x: chip.x + padX * 0.4, y: chip.y, w: chip.w - padX * 0.8, h: chip.h },
      role,
      weight: 600,
      size: size * 0.92,
      minSize: size * 0.62,
      maxLines: 1,
      align: 'center',
      valign: 'middle',
      color: ink,
      group: opts.group,
      truncateOk: true
    });
  }

  ctx.restore();
  recordPointer(ctx, opts.group, { anchor: opts.anchorId, tail, head, target: opts.anchor });
  return { x: chip.x, y: chip.y, w: chip.w, h: chip.h };
}

/** Rounded label used for markers, counters and callouts. */
export function drawChip(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  opts: {
    size?: number;
    color: string;
    ink?: string;
    alpha?: number;
    align?: 'left' | 'center' | 'right';
    mono?: boolean;
    weight?: number;
    filled?: boolean;
    padX?: number;
    height?: number;
    maxWidth?: number;
    group?: string;
    role?: FontRole;
    /** Set when a cut is expected and should not be reported by the audit. */
    truncateOk?: boolean;
  }
): { width: number; height: number; text: string; left: number } {
  const size = opts.size ?? 26;
  const role: FontRole = opts.role ?? (opts.mono === false ? 'text' : 'mono');
  const height = opts.height ?? Math.round(size * 2.05);
  const alpha = clamp01(opts.alpha ?? 1);
  const maxWidth = opts.maxWidth ?? DESIGN_W - SAFE * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  const padX = opts.padX ?? Math.round(size * 0.72);
  const cut = ellipsize(ctx, label, Math.max(size * 2, maxWidth - padX * 2), role, opts.weight ?? 600, size);
  const width = cut.width + padX * 2;
  const left =
    opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x;

  if (opts.filled) {
    ctx.fillStyle = opts.color;
  } else {
    ctx.fillStyle = rgba('#060b14', 0.85);
  }
  roundRect(ctx, left, y - height / 2, width, height, Math.round(height / 2));
  ctx.fill();
  ctx.strokeStyle = opts.filled ? rgba('#000000', 0.15) : rgba(opts.color, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = fontString(role, opts.weight ?? 600, size);
  ctx.fillStyle = opts.filled ? '#06101a' : opts.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cut.text, left + width / 2, y + 1);
  ctx.restore();

  // A cut chip is a layout signal, not a silent loss of meaning.
  if (alpha >= 0.15) {
    recordText(
      ctx,
      opts.group ?? 'chip',
      { x: left, y: y - height / 2, w: width, h: height },
      label,
      cut.truncated && !opts.truncateOk
    );
  }

  return { width, height, text: cut.text, left };
}

/* ------------------------------------------------------------------ overlays */

export function hudHeader(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { watermark: string; step: string; alpha?: number }
): void {
  const k = dims.width / DESIGN_W;
  const alpha = clamp01(opts.alpha ?? 1);
  const S = SAFE * k;
  const width = dims.width - S * 2;
  const size = 22 * k;
  const baseline = (BAND.headerTop + 16) * k;
  const watermark = (opts.watermark || 'VISUAL CS LAB').toUpperCase();
  const watermarkWidth = Math.min(width * 0.6, textWidth(ctx, watermark, 'mono', 600, size));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontString('mono', 600, size);
  ctx.fillStyle = rgba(pal.ink, 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(watermark, S, baseline);

  const restWidth = width - watermarkWidth - 24 * k;
  const step = ellipsize(ctx, opts.step, Math.max(0, restWidth), 'mono', 600, size);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(pal.ink, 0.62);
  ctx.fillText(step.text, dims.width - S, baseline);
  ctx.fillStyle = rgba(pal.ink, 0.12);
  ctx.fillRect(S, BAND.headerRule * k, width, Math.max(1, 1.4 * k));
  ctx.restore();
}

/**
 * The operation banner: what is happening, and the state it produced. It owns the
 * band between the header and the stage, and both lines are fitted so a long
 * `mid = floor((low + high) / 2)` banner stays inside the frame.
 */
export function hudOperation(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { label: string; detail: string; accent?: string; alpha?: number; y?: number }
): number {
  const k = dims.width / DESIGN_W;
  const alpha = clamp01(opts.alpha ?? 1);
  if (alpha <= 0.01) return 0;
  const S = SAFE * k;
  const top = (opts.y ?? BAND.operationTop) * k;
  const color = opts.accent ?? pal.accent;
  const width = dims.width - S * 2 - 30 * k;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(S, top + 8 * k, Math.max(2, 6 * k), 76 * k);

  const label = drawText(ctx, opts.label, {
    box: { x: S + 26 * k, y: top, w: width, h: 54 * k },
    role: 'display',
    weight: 600,
    size: 54 * k,
    minSize: 34 * k,
    maxLines: 1,
    color: pal.ink,
    group: 'operation-label'
  });
  drawText(ctx, opts.detail, {
    box: { x: S + 28 * k, y: top + 58 * k, w: width, h: 46 * k },
    role: 'mono',
    weight: 400,
    size: 26 * k,
    minSize: 20 * k,
    maxLines: 2,
    lineHeight: 1.24,
    color: rgba(pal.ink, 0.68),
    group: 'operation-detail'
  });
  ctx.restore();
  return top + label.height + 60 * k;
}

/** A single, high-contrast moment: a returned value or a found index. */
export function toast(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { text: string; sub?: string; color: string; alpha: number; y?: number; scale?: number }
): void {
  const k = dims.width / DESIGN_W;
  const alpha = clamp01(opts.alpha);
  if (alpha <= 0.01) return;
  const centerY = (opts.y ?? (BAND.resultTop + 66)) * k;
  const scale = opts.scale ?? 1;
  const S = SAFE * k;
  const maxWidth = dims.width - S * 2;
  const padX = 40 * k;

  const textFit = fitText(ctx, opts.text, {
    box: { x: 0, y: 0, w: maxWidth - padX * 2, h: 58 * k },
    role: 'mono',
    weight: 600,
    size: 44 * k,
    minSize: 26 * k,
    maxLines: 1
  });
  const subFit = opts.sub
    ? fitText(ctx, opts.sub, {
        box: { x: 0, y: 0, w: maxWidth - padX * 2, h: 56 * k },
        role: 'mono',
        weight: 400,
        size: 24 * k,
        minSize: 18 * k,
        maxLines: 2,
        lineHeight: 1.25
      })
    : null;

  const width = Math.min(maxWidth, Math.max(textFit.width, subFit?.width ?? 0) + padX * 2);
  const height = textFit.height + (subFit?.height ?? 0) + (subFit ? 30 * k : 24 * k);
  const top = centerY - height / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(dims.width / 2, centerY);
  ctx.scale(scale, scale);
  ctx.translate(-dims.width / 2, -centerY);
  ctx.fillStyle = rgba('#050a12', 0.92);
  roundRect(ctx, (dims.width - width) / 2, top, width, height, Math.min(height / 2, 40 * k));
  ctx.fill();
  ctx.strokeStyle = rgba(opts.color, 0.72);
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, opts.text, {
    box: { x: (dims.width - width) / 2 + padX, y: top + 12 * k, w: width - padX * 2, h: textFit.height },
    role: 'mono',
    weight: 600,
    size: 44 * k,
    minSize: 26 * k,
    maxLines: 1,
    align: 'center',
    color: opts.color,
    alpha,
    group: 'result'
  });
  if (subFit && opts.sub) {
    drawText(ctx, opts.sub, {
      box: {
        x: (dims.width - width) / 2 + padX,
        y: top + textFit.height + 14 * k,
        w: width - padX * 2,
        h: subFit.height
      },
      role: 'mono',
      weight: 400,
      size: 24 * k,
      minSize: 18 * k,
      maxLines: 2,
      lineHeight: 1.25,
      align: 'center',
      color: rgba(pal.ink, 0.7),
      alpha,
      group: 'result'
    });
  }
}

/** The explanation strip at the bottom, inside the safe margin. */
export function captionBar(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { text: string; alpha?: number; accent?: string }
): void {
  const k = dims.width / DESIGN_W;
  const alpha = clamp01(opts.alpha ?? 1);
  const value = (opts.text || '').trim();
  if (alpha <= 0.01 || !value) return;
  const S = SAFE * k;
  const padX = 40 * k;
  const maxWidth = dims.width - S * 2 - padX * 2;

  const fitted = fitText(ctx, value, {
    box: { x: 0, y: 0, w: maxWidth, h: 168 * k },
    role: 'text',
    weight: 500,
    size: 36 * k,
    minSize: 22 * k,
    maxLines: 3,
    lineHeight: 1.36
  });

  const cardH = fitted.height + 52 * k;
  const top = dims.height - BAND.captionGap * k - cardH;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba('#050810', 0.8);
  roundRect(ctx, S, top, dims.width - S * 2, cardH, 22 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.2);
  ctx.lineWidth = 1.4 * k;
  ctx.stroke();
  ctx.fillStyle = rgba(opts.accent ?? pal.accent, 0.95);
  ctx.fillRect(S + 14 * k, top + 18 * k, 4 * k, cardH - 36 * k);
  ctx.restore();

  drawText(ctx, value, {
    box: { x: S + padX, y: top + 26 * k, w: maxWidth, h: fitted.height },
    role: 'text',
    weight: 500,
    size: 36 * k,
    minSize: 22 * k,
    maxLines: 3,
    lineHeight: 1.36,
    color: rgba(pal.ink, 0.9),
    alpha,
    group: 'caption'
  });
}

export function footer(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { progress: number; mark: string; alpha?: number }
): void {
  const k = dims.width / DESIGN_W;
  const S = SAFE * k;
  const y = dims.height - BAND.footer * k;
  const alpha = clamp01(opts.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.ink, 0.1);
  ctx.fillRect(S, y, dims.width - S * 2, Math.max(1, 2 * k));
  ctx.fillStyle = rgba(pal.accent, 0.85);
  ctx.fillRect(S, y, (dims.width - S * 2) * clamp01(opts.progress), Math.max(1, 2.6 * k));
  const size = 20 * k;
  const label = textWidth(ctx, 'SILENT SHORT · NO AUDIO TRACK', 'mono', 400, size);
  text(ctx, 'SILENT SHORT · NO AUDIO TRACK', S, y + 30 * k, {
    size,
    color: rgba(pal.ink, 0.34),
    mono: true,
    weight: 400,
    maxWidth: dims.width - S * 2 - label * 0.9
  });
  text(ctx, (opts.mark || '').toUpperCase(), dims.width - S, y + 30 * k, {
    size,
    color: rgba(pal.ink, 0.34),
    mono: true,
    weight: 400,
    align: 'right',
    maxWidth: dims.width * 0.4
  });
  ctx.restore();
}

/** Restrained brand ending: the mark, the name, one line. */
export function brandEnd(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  brand: BrandLike,
  progress: number
): void {
  const k = dims.width / DESIGN_W;
  const p = clamp01(progress);
  const mark = easeOutCubic(track(p, 0.02, 0.3));
  const name = easeOutCubic(track(p, 0.14, 0.42));
  const tag = easeOutCubic(track(p, 0.3, 0.6));
  const size = 148 * k;
  const cx = dims.width / 2;
  const baseY = dims.height * 0.44;
  const width = dims.width - SAFE * 2 * k;

  ctx.save();
  ctx.globalAlpha = mark;
  ctx.fillStyle = rgba(pal.accent, 0.14);
  roundRect(ctx, cx - size / 2, baseY - size / 2, size, size, 34 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.6);
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = fontString('display', 700, 58 * k);
  ctx.fillStyle = pal.accent;
  ctx.fillText('VL', cx, baseY + 3 * k);
  ctx.restore();

  drawText(ctx, brand.name || 'Visual CS Lab', {
    box: { x: SAFE * k, y: baseY + 150 * k, w: width, h: 92 * k },
    role: 'display',
    weight: 700,
    size: 72 * k,
    minSize: 40 * k,
    maxLines: 1,
    align: 'center',
    color: pal.ink,
    alpha: name,
    group: 'brand'
  });

  ctx.save();
  ctx.globalAlpha = name;
  ctx.strokeStyle = rgba(pal.accent, 0.9);
  ctx.lineWidth = 4 * k;
  ctx.beginPath();
  ctx.moveTo(cx - 120 * k * name, baseY + 282 * k);
  ctx.lineTo(cx + 120 * k * name, baseY + 282 * k);
  ctx.stroke();
  ctx.restore();

  drawText(ctx, 'Code-driven CS animation', {
    box: { x: SAFE * k, y: baseY + 300 * k, w: width, h: 44 * k },
    role: 'text',
    weight: 500,
    size: 32 * k,
    minSize: 22 * k,
    maxLines: 1,
    align: 'center',
    color: rgba(pal.ink, 0.72),
    alpha: tag,
    group: 'brand'
  });

  if (brand.outro) {
    drawText(ctx, brand.outro, {
      box: { x: SAFE * k, y: baseY + 348 * k, w: width, h: 52 * k },
      role: 'mono',
      weight: 400,
      size: 24 * k,
      minSize: 18 * k,
      maxLines: 1,
      align: 'center',
      color: rgba(pal.accent, 0.9),
      alpha: tag,
      group: 'brand',
      truncateOk: true
    });
  }
}

/** Soft fade used between beats so nothing snaps. */
export function curtain(ctx: SKRSContext2D, dims: Dims, pal: Palette, alpha: number): void {
  const a = clamp01(alpha);
  if (a <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = mix(pal.bg, '#000000', 0.4);
  ctx.fillRect(0, 0, dims.width, dims.height);
  ctx.restore();
}

export { easeOutCubic, lerp, track, overlapArea };
