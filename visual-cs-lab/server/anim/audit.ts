/**
 * The layout audit recorder.
 *
 * The renderer records what it actually drew — text blocks, solid objects and
 * pointers — while it draws. `anim/inspect.ts` then replays sampled moments with
 * the recorder on and checks the recorded geometry: text escaping the safe area,
 * text sitting on top of an animated object, a pointer that missed its target, or
 * an anchor id that resolved to nothing.
 *
 * Nothing here fakes a pass: the numbers are the ones Skia measured for the exact
 * strings and fonts the video uses.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type AuditShape = {
  kind: 'text' | 'object' | 'pointer';
  /** Timestamp of the moment this was drawn at. */
  at: number;
  /** Shapes that belong together (a block and its value) share a group. */
  group: string;
  /** Device-pixel rect for text and objects. */
  rect?: Rect;
  text?: string;
  /** Pointer tail (on the target) and head (on the label). */
  tail?: { x: number; y: number };
  head?: { x: number; y: number };
  /** The object the pointer is supposed to touch. */
  target?: Rect | null;
  anchor?: string;
  /** Set when the drawn text had to be cut to fit its container. */
  truncated?: boolean;
};

type Transform = { a: number; b: number; c: number; d: number; e: number; f: number };

let active = false;
let shapes: AuditShape[] = [];
let missingAnchors: string[] = [];
let currentAt = 0;

export function beginAudit(at = 0): void {
  active = true;
  shapes = [];
  missingAnchors = [];
  currentAt = at;
}

export function endAudit(): { shapes: AuditShape[]; missingAnchors: string[] } {
  active = false;
  const out = { shapes, missingAnchors };
  shapes = [];
  missingAnchors = [];
  return out;
}

export function auditActive(): boolean {
  return active;
}

/** Applies the canvas' current transform to a rect, so every record is device space. */
export function projectRect(ctx: { getTransform(): Transform }, rect: Rect): Rect {
  const m = ctx.getTransform();
  const points = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h]
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

export function recordText(ctx: { getTransform(): Transform }, group: string, rect: Rect, text?: string, truncated?: boolean): void {
  if (!active) return;
  shapes.push({ kind: 'text', at: currentAt, group, rect: projectRect(ctx, rect), text, truncated });
}

export function recordObject(ctx: { getTransform(): Transform }, group: string, rect: Rect, label?: string): void {
  if (!active) return;
  shapes.push({ kind: 'object', at: currentAt, group, rect: projectRect(ctx, rect), text: label });
}

export function recordPointer(
  ctx: { getTransform(): Transform },
  group: string,
  opts: { anchor: string; tail: { x: number; y: number }; head: { x: number; y: number }; target: Rect | null }
): void {
  if (!active) return;
  const tail = projectRect(ctx, { x: opts.tail.x, y: opts.tail.y, w: 0, h: 0 });
  const head = projectRect(ctx, { x: opts.head.x, y: opts.head.y, w: 0, h: 0 });
  shapes.push({
    kind: 'pointer',
    at: currentAt,
    group,
    anchor: opts.anchor,
    tail: { x: tail.x, y: tail.y },
    head: { x: head.x, y: head.y },
    target: opts.target ? projectRect(ctx, opts.target) : null
  });
}

export function recordMissingAnchor(anchor: string): void {
  if (!active) return;
  if (!missingAnchors.includes(anchor)) missingAnchors.push(anchor);
}
