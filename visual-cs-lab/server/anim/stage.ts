/**
 * Shared visual language of the motion engine: stage, 2.5D objects, cameras and
 * the on-screen overlays.
 *
 * The whole video is drawn in a 1080 × 1920 design space and scaled to whatever
 * the output profile asks for, so a 540 × 960 preview is the same composition as
 * the 1080 × 1920 export.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { clamp01, easeInCubic, easeOutCubic, lerp, track } from './easing.ts';
import { mix, rgba, roundRect, wrap } from '../render/paint.ts';
import { MONO, SANS } from '../render/typography.ts';

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

export function font(size: number, weight = 400, mono = false): string {
  return `${weight} ${Math.round(size)}px ${mono ? MONO : SANS}`;
}

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
    align?: CanvasTextAlign;
    alpha?: number;
    maxWidth?: number;
  }
): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = font(opts.size, opts.weight ?? 600, opts.mono);
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = opts.maxWidth ? wrap(ctx, value, opts.maxWidth, 4) : [value];
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * opts.size * 1.3));
  ctx.restore();
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

  const dx = Math.round(w * 0.05);
  const dy = Math.round(h * 0.16);
  const cx = opts.x + w / 2;
  const cy = opts.y + h / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (opts.scale && opts.scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(opts.scale, opts.scale);
    ctx.translate(-cx, -cy);
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

  ctx.font = font(opts.valueSize ?? h * 0.52, 700);
  ctx.fillStyle = tone === 'dim' ? rgba(pal.ink, 0.42) : tone === 'match' ? '#fff6f2' : pal.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(opts.value), cx, cy + h * 0.02);

  ctx.restore();
}

/** The TOP pointer: a connector from the top block to a labelled tab. */
export function drawTopPointer(
  ctx: SKRSContext2D,
  opts: {
    x: number;
    y: number;
    label: string;
    sub?: string;
    pal: Palette;
    alpha?: number;
    side?: 'right' | 'left';
    color?: string;
  }
): void {
  const { pal } = opts;
  const alpha = clamp01(opts.alpha ?? 1);
  if (alpha <= 0.02) return;
  const color = opts.color ?? pal.accent;
  const side = opts.side ?? 'right';
  const dir = side === 'right' ? 1 : -1;
  const chipW = 132;
  const chipH = 62;
  const gap = 54;
  const chipX = opts.x + dir * gap;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = rgba(color, 0.6);
  ctx.lineWidth = 2.4;
  ctx.setLineDash([9, 9]);
  ctx.beginPath();
  ctx.moveTo(opts.x, opts.y);
  ctx.lineTo(chipX, opts.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = rgba(color, 0.9);
  ctx.beginPath();
  ctx.moveTo(opts.x, opts.y);
  ctx.lineTo(opts.x + dir * 16, opts.y - 9);
  ctx.lineTo(opts.x + dir * 16, opts.y + 9);
  ctx.closePath();
  ctx.fill();

  const x = side === 'right' ? chipX : chipX - chipW;
  ctx.fillStyle = rgba('#050a12', 0.88);
  roundRect(ctx, x, opts.y - chipH / 2, chipW, chipH, 14);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(24, 700, true);
  ctx.fillStyle = color;
  ctx.fillText(opts.label, x + chipW / 2, opts.y - (opts.sub ? 10 : 0));
  if (opts.sub) {
    ctx.font = font(24, 700);
    ctx.fillStyle = pal.ink;
    ctx.fillText(opts.sub, x + chipW / 2, opts.y + 15);
  }
  ctx.restore();
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
  }
): { width: number; height: number } {
  const size = opts.size ?? 26;
  const height = opts.height ?? Math.round(size * 2.1);
  const alpha = clamp01(opts.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font(size, opts.weight ?? 700, opts.mono ?? true);
  const padX = opts.padX ?? Math.round(size * 0.72);
  const width = ctx.measureText(label).width + padX * 2;
  const left =
    opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x;

  if (opts.filled) {
    ctx.fillStyle = opts.color;
  } else {
    ctx.fillStyle = rgba('#060b14', 0.82);
  }
  roundRect(ctx, left, y - height / 2, width, height, Math.round(height / 2));
  ctx.fill();
  ctx.strokeStyle = opts.filled ? rgba('#000000', 0.15) : rgba(opts.color, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = opts.filled ? '#06101a' : opts.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left + width / 2, y + 1);
  ctx.restore();
  return { width, height };
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
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font(23 * k, 600, true);
  ctx.fillStyle = rgba(pal.ink, 0.45);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(opts.watermark.toUpperCase(), S, S + 14 * k);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(pal.ink, 0.55);
  ctx.fillText(opts.step, dims.width - S, S + 14 * k);
  ctx.fillStyle = rgba(pal.ink, 0.12);
  ctx.fillRect(S, S + 34 * k, dims.width - S * 2, Math.max(1, 1.4 * k));
  ctx.restore();
}

/** The operation banner: what is happening, and the state it produced. */
export function hudOperation(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { label: string; detail: string; accent?: string; alpha?: number; y?: number }
): void {
  const k = dims.width / DESIGN_W;
  const alpha = clamp01(opts.alpha ?? 1);
  if (alpha <= 0.01) return;
  const S = SAFE * k;
  const y = (opts.y ?? 190) * k;
  const color = opts.accent ?? pal.accent;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillRect(S, y - 54 * k, Math.max(2, 6 * k), 66 * k);
  ctx.font = font(58 * k, 800);
  ctx.fillStyle = pal.ink;
  ctx.fillText(opts.label, S + 24 * k, y);
  ctx.font = font(28 * k, 600, true);
  ctx.fillStyle = rgba(pal.ink, 0.6);
  ctx.fillText(opts.detail, S + 26 * k, y + 46 * k);
  ctx.restore();
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
  const y = (opts.y ?? 470) * k;
  const scale = opts.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(dims.width / 2, y);
  ctx.scale(scale, scale);
  ctx.font = font(46 * k, 800, true);
  const width = Math.min(dims.width - SAFE * 2 * k, ctx.measureText(opts.text).width + 96 * k);
  const height = (opts.sub ? 132 : 96) * k;
  ctx.fillStyle = rgba('#050a12', 0.9);
  roundRect(ctx, -width / 2, -height / 2, width, height, height / 2);
  ctx.fill();
  ctx.strokeStyle = rgba(opts.color, 0.7);
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color;
  ctx.fillText(opts.text, 0, opts.sub ? -18 * k : 2 * k);
  if (opts.sub) {
    ctx.font = font(24 * k, 600, true);
    ctx.fillStyle = rgba(pal.ink, 0.66);
    ctx.fillText(opts.sub, 0, 28 * k);
  }
  ctx.restore();
}

/** One or two lines of explanation at the bottom, inside the safe margin. */
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
  const maxWidth = dims.width - S * 2 - 30 * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font(36 * k, 600);
  const lines = wrap(ctx, value, maxWidth, 2);
  const lineHeight = 48 * k;
  const blockH = lines.length * lineHeight;
  const top = dims.height - 168 * k - blockH;
  ctx.fillStyle = rgba('#050810', 0.72);
  roundRect(ctx, S - 18 * k, top - 40 * k, dims.width - S * 2 + 36 * k, blockH + 56 * k, 22 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, 0.18);
  ctx.lineWidth = 1.4 * k;
  ctx.stroke();
  ctx.fillStyle = rgba(opts.accent ?? pal.accent, 0.95);
  ctx.fillRect(S, top - 26 * k, 4 * k, blockH + 12 * k);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgba(pal.ink, 0.88);
  lines.forEach((line, index) => ctx.fillText(line, S + 14 * k, top + index * lineHeight));
  ctx.restore();
}

export function footer(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  opts: { progress: number; mark: string; alpha?: number }
): void {
  const k = dims.width / DESIGN_W;
  const S = SAFE * k;
  const y = dims.height - 74 * k;
  const alpha = clamp01(opts.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.ink, 0.1);
  ctx.fillRect(S, y, dims.width - S * 2, Math.max(1, 2 * k));
  ctx.fillStyle = rgba(pal.accent, 0.85);
  ctx.fillRect(S, y, (dims.width - S * 2) * clamp01(opts.progress), Math.max(1, 2.6 * k));
  ctx.font = font(22 * k, 600, true);
  ctx.fillStyle = rgba(pal.ink, 0.32);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('VERIFIED TRACE · NO AUDIO', S, y + 34 * k);
  ctx.textAlign = 'right';
  ctx.fillText(opts.mark.toUpperCase(), dims.width - S, y + 34 * k);
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
  ctx.font = font(58 * k, 800);
  ctx.fillStyle = pal.accent;
  ctx.fillText('VL', cx, baseY + 3 * k);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = name;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(74 * k, 800);
  ctx.fillStyle = pal.ink;
  ctx.fillText(brand.name || 'Visual CS Lab', cx, baseY + 230 * k);
  ctx.strokeStyle = rgba(pal.accent, 0.9);
  ctx.lineWidth = 4 * k;
  ctx.beginPath();
  ctx.moveTo(cx - 120 * k * name, baseY + 268 * k);
  ctx.lineTo(cx + 120 * k * name, baseY + 268 * k);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = tag;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(34 * k, 500);
  ctx.fillStyle = rgba(pal.ink, 0.72);
  ctx.fillText('Code-driven CS animation', cx, baseY + 336 * k);
  if (brand.outro) {
    ctx.font = font(26 * k, 600, true);
    ctx.fillStyle = rgba(pal.accent, 0.85);
    ctx.fillText(brand.outro, cx, baseY + 392 * k);
  }
  ctx.restore();
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

export { easeInCubic, easeOutCubic, lerp, track };
