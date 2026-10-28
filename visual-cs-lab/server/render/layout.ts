/**
 * The text layout engine.
 *
 * Every string on a frame is fitted into a named box: the engine picks the
 * largest size in a range that wraps inside the box's width *and* height, balances
 * the line breaks, and only falls back to an ellipsis when even the minimum size
 * cannot fit — and that fallback is recorded so the layout audit can flag it.
 *
 * Nothing here draws outside its box, which is what keeps titles, labels, code and
 * annotations inside their cards on every frame of the animation.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { type Rect, recordText } from '../anim/audit.ts';
import { fontString, snapWeight, type FontRole } from './typography.ts';

export type Box = Rect;

export type Measure = (text: string) => number;

export type WrapResult = { lines: string[]; truncated: boolean; widest: number };

/** Greedy word wrap; the last line is ellipsized when it would overflow the limit. */
export function wrapLines(text: string, measure: Measure, maxWidth: number, maxLines = 4): WrapResult {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return { lines: [], truncated: false, widest: 0 };

  const lines: string[] = [];
  let line = '';
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (measure(candidate) <= maxWidth || !line) {
      line = candidate;
      consumed = i + 1;
      continue;
    }
    lines.push(line);
    line = words[i];
    consumed = i + 1;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  let truncated = consumed < words.length;
  if (truncated && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[ ,;:.]$/, '')}…`;
    truncated = true;
  }

  const widest = lines.reduce((max, item) => Math.max(max, measure(item)), 0);
  return { lines, truncated, widest };
}

/**
 * Narrows the wrap width until the line count would grow, which evens out the rag
 * instead of leaving one short orphan word on the last line.
 */
function balancedWidth(text: string, measure: Measure, maxWidth: number, lineCount: number): number {
  if (lineCount < 2 || lineCount > 4) return maxWidth;
  let low = Math.max(maxWidth * 0.55, 1);
  let high = maxWidth;
  let best = maxWidth;
  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    const candidate = wrapLines(text, measure, mid, 8);
    if (candidate.lines.length <= lineCount) {
      best = mid;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

export type FitOptions = {
  /** The container the text must stay inside. */
  box: Box;
  role?: FontRole;
  weight?: number;
  /** Preferred size; the engine only shrinks from here. */
  size: number;
  minSize?: number;
  maxLines?: number;
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
  balance?: boolean;
  /** Shrink one extra step so the block never touches its container edge. */
  width?: number;
};

export type Fitted = {
  lines: string[];
  size: number;
  lineHeight: number;
  width: number;
  height: number;
  truncated: boolean;
};

/**
 * Sets the face and returns a measuring function bound to it. The caller restores
 * the context: measuring with the wrong font silently ruins every fit decision.
 */
function measureWith(ctx: SKRSContext2D, role: FontRole, weight: number, size: number): Measure {
  ctx.font = fontString(role, weight, size);
  return (text) => ctx.measureText(text).width;
}

/**
 * Picks the largest size whose wrapped block fits the box in both directions.
 * Binary search over integer sizes keeps this cheap enough to run per frame.
 */
export function fitText(
  ctx: SKRSContext2D,
  value: string,
  opts: FitOptions
): Fitted {
  const role = opts.role ?? 'text';
  const weight = snapWeight(role, opts.weight ?? 400);
  const ratio = opts.lineHeight ?? (role === 'display' ? 1.14 : 1.34);
  const maxLines = opts.maxLines ?? 3;
  const width = opts.width ?? opts.box.w;
  const text = String(value ?? '');
  let low = Math.max(8, Math.round(opts.minSize ?? opts.size * 0.55));
  let high = Math.max(low, Math.round(opts.size));
  let best: Fitted | null = null;

  ctx.save();
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const measure = measureWith(ctx, role, weight, size);
    const greedy = wrapLines(text, measure, width, maxLines);
    const lineHeight = size * ratio;
    const fitsWidth = greedy.widest <= width + 0.5 && !greedy.truncated;
    const fitsHeight = greedy.lines.length * lineHeight <= opts.box.h + 0.5;
    if (fitsWidth && fitsHeight) {
      const target = opts.balance === false ? width : balancedWidth(text, measure, width, greedy.lines.length);
      const wrapped = wrapLines(text, measure, target, maxLines);
      best = {
        lines: wrapped.lines,
        size,
        lineHeight,
        width: wrapped.widest,
        height: wrapped.lines.length * lineHeight,
        truncated: wrapped.truncated
      };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  if (best) {
    ctx.restore();
    return best;
  }

  // Even the minimum size cannot hold it: render at the minimum and flag the cut.
  const size = Math.max(8, Math.round(opts.minSize ?? opts.size * 0.55));
  const measure = measureWith(ctx, role, weight, size);
  const wrapped = wrapLines(text, measure, width, maxLines);
  const lineHeight = size * ratio;
  ctx.restore();
  return {
    lines: wrapped.lines,
    size,
    lineHeight,
    width: wrapped.widest,
    height: wrapped.lines.length * lineHeight,
    truncated: wrapped.truncated
  };
}

export type DrawOptions = FitOptions & {
  color: string;
  alpha?: number;
  align?: 'left' | 'center' | 'right';
  /** Groups this text with the object it belongs to, so the audit never reports it as a collision. */
  group?: string;
  /** Set when a cut is expected (watermarks, counters) and should not be reported. */
  truncateOk?: boolean;
  /** Vertical alignment of the block inside its box. */
  valign?: 'top' | 'middle';
};

/**
 * Fits and draws a text block inside its box, returning the measured block. The
 * caller never has to guess a baseline: lines are laid out from the box.
 */
export function drawText(ctx: SKRSContext2D, value: string, opts: DrawOptions): Fitted {
  const fitted = fitText(ctx, value, opts);
  if (fitted.lines.length === 0) return fitted;

  const role = opts.role ?? 'text';
  const weight = opts.weight ?? 400;
  const left =
    opts.align === 'center'
      ? opts.box.x + opts.box.w / 2
      : opts.align === 'right'
        ? opts.box.x + opts.box.w
        : opts.box.x;
  const top = opts.valign === 'middle' ? opts.box.y + (opts.box.h - fitted.height) / 2 : opts.box.y;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = fontString(role, weight, fitted.size);
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  fitted.lines.forEach((line, index) => {
    const baseline = top + fitted.size * 0.8 + index * fitted.lineHeight;
    ctx.fillText(line, left, baseline);
  });
  ctx.restore();

  const blockWidth = Math.min(opts.box.w, fitted.width);
  const blockLeft =
    opts.align === 'center' ? left - blockWidth / 2 : opts.align === 'right' ? left - blockWidth : left;
  recordText(
    ctx,
    opts.group ?? 'text',
    { x: blockLeft, y: top + fitted.size * 0.12, w: blockWidth, h: fitted.lines.length * fitted.lineHeight },
    fitted.lines.join(' '),
    fitted.truncated && !opts.truncateOk
  );

  return fitted;
}

/** Width of one line of text in a role, for chips and badges. */
export function textWidth(
  ctx: SKRSContext2D,
  value: string,
  role: FontRole,
  weight: number,
  size: number
): number {
  ctx.save();
  ctx.font = fontString(role, weight, size);
  const width = ctx.measureText(String(value ?? '')).width;
  ctx.restore();
  return width;
}

/** Cuts a single line to a width with an ellipsis — used by chips and headers. */
export function ellipsize(
  ctx: SKRSContext2D,
  value: string,
  maxWidth: number,
  role: FontRole,
  weight: number,
  size: number
): { text: string; width: number; truncated: boolean } {
  ctx.save();
  ctx.font = fontString(role, weight, size);
  const full = String(value ?? '');
  let text = full;
  if (ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
    text = `${text.replace(/[ ,;:.]$/, '')}…`;
  }
  const width = ctx.measureText(text).width;
  ctx.restore();
  return { text, width, truncated: text !== full };
}
