/**
 * Anchor-based placement for pointers, markers and labels.
 *
 * A pointer is never positioned by a hand-picked coordinate: it is attached to an
 * anchor rect computed from the target object's *current* rendered bounds (block
 * position, scale, camera transform), and its label chip is placed in the first
 * free slot around that anchor. Because the rect is recomputed on every frame,
 * the pointer follows its target through pushes, pops, camera moves and zooms.
 */

import { recordMissingAnchor } from './audit.ts';

export type Rect = { x: number; y: number; w: number; h: number };

export type Side = 'right' | 'left' | 'above' | 'below';

export type PlacedChip = { x: number; y: number; w: number; h: number; side: Side };

/** Collects the anchor rects a scene can attach pointers to. */
export class AnchorMap {
  private rects = new Map<string, Rect>();

  set(id: string, rect: Rect): Rect {
    this.rects.set(id, rect);
    return rect;
  }

  get(id: string): Rect | null {
    return this.rects.get(id) ?? null;
  }

  /**
   * A missing target is never replaced with an arbitrary coordinate: the caller
   * must skip the pointer, and the audit reports which anchor failed so the scene
   * is flagged for validation.
   */
  require(id: string): Rect | null {
    const rect = this.rects.get(id);
    if (!rect) recordMissingAnchor(id);
    return rect ?? null;
  }

  clear(): void {
    this.rects.clear();
  }
}

export function overlapArea(a: Rect, b: Rect, pad = 0): number {
  const width = Math.min(a.x + a.w + pad, b.x + b.w + pad) - Math.max(a.x - pad, b.x - pad);
  const height = Math.min(a.y + a.h + pad, b.y + b.h + pad) - Math.max(a.y - pad, b.y - pad);
  return width > 0 && height > 0 ? width * height : 0;
}

export function containsPoint(rect: Rect, point: { x: number; y: number }, tolerance = 0): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.x <= rect.x + rect.w + tolerance &&
    point.y >= rect.y - tolerance &&
    point.y <= rect.y + rect.h + tolerance
  );
}

function inside(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x >= bounds.x - 0.5 &&
    rect.y >= bounds.y - 0.5 &&
    rect.x + rect.w <= bounds.x + bounds.w + 0.5 &&
    rect.y + rect.h <= bounds.y + bounds.h + 0.5
  );
}

/**
 * Places a label chip beside an anchor: the first candidate that stays inside
 * `bounds` and clears every obstacle wins; otherwise the least-bad candidate is
 * used so the label stays attached to its target instead of drifting away.
 */
export function placeChip(args: {
  anchor: Rect;
  w: number;
  h: number;
  bounds: Rect;
  obstacles?: Rect[];
  gap?: number;
  prefer?: Side[];
}): PlacedChip {
  const { anchor, w, h, bounds } = args;
  const gap = args.gap ?? 26;
  const obstacles = args.obstacles ?? [];
  const centerX = anchor.x + anchor.w / 2;
  const centerY = anchor.y + anchor.h / 2;

  const candidates: PlacedChip[] = [
    { x: anchor.x + anchor.w + gap, y: centerY - h / 2, w, h, side: 'right' },
    { x: anchor.x - gap - w, y: centerY - h / 2, w, h, side: 'left' },
    { x: centerX - w / 2, y: anchor.y - gap - h, w, h, side: 'above' },
    { x: centerX - w / 2, y: anchor.y + anchor.h + gap, w, h, side: 'below' }
  ];

  const order = args.prefer && args.prefer.length > 0
    ? [...candidates].sort((a, b) => args.prefer!.indexOf(a.side) - args.prefer!.indexOf(b.side))
    : candidates;

  let best = order[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of order) {
    const clipped = inside(candidate, bounds) ? 0 : 1;
    const collision = obstacles.reduce((sum, obstacle) => sum + overlapArea(candidate, obstacle, 4), 0);
    // Being outside the frame is worse than overlapping something inside it.
    const score = clipped * 1e7 + collision;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
    if (score === 0) break;
  }
  return best;
}

/** The point on the anchor edge facing the placed chip — where a leader line attaches. */
export function anchorEdgePoint(anchor: Rect, chip: PlacedChip): { x: number; y: number } {
  const anchorCenterY = anchor.y + anchor.h / 2;
  if (chip.side === 'right') return { x: anchor.x + anchor.w, y: anchorCenterY };
  if (chip.side === 'left') return { x: anchor.x, y: anchorCenterY };
  if (chip.side === 'above') return { x: anchor.x + anchor.w / 2, y: anchor.y };
  return { x: anchor.x + anchor.w / 2, y: anchor.y + anchor.h };
}

/** The point on the chip edge facing the anchor. */
export function chipEdgePoint(chip: PlacedChip, anchor: Rect): { x: number; y: number } {
  const chipCenterY = chip.y + chip.h / 2;
  if (chip.side === 'right') return { x: chip.x, y: chipCenterY };
  if (chip.side === 'left') return { x: chip.x + chip.w, y: chipCenterY };
  if (chip.side === 'above') return { x: chip.x + chip.w / 2, y: chip.y + chip.h };
  return { x: chip.x + chip.w / 2, y: chip.y };
}

/**
 * Horizontal placement for a marker that must sit exactly under an index: the
 * chip is centred on the column unless that would run past the frame edge, in
 * which case it is clamped and the stem leans towards the true column.
 */
export function placeMarker(args: {
  centerX: number;
  y: number;
  w: number;
  h: number;
  bounds: Rect;
  obstacles?: Rect[];
}): Rect {
  const { centerX, y, w, h, bounds } = args;
  const obstacles = args.obstacles ?? [];
  let x = centerX - w / 2;
  x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, x));
  if (obstacles.some((obstacle) => overlapArea({ x, y: y - h / 2, w, h }, obstacle, 2) > 0)) {
    for (const lift of [h + 8, h * 2 + 12]) {
      const lifted = { x, y: y - h / 2 - lift, w, h };
      if (!obstacles.some((obstacle) => overlapArea(lifted, obstacle, 2) > 0) && lifted.y >= bounds.y) {
        return lifted;
      }
    }
  }
  return { x, y: y - h / 2, w, h };
}
