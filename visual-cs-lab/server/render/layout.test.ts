import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';

import { placeChip, placeMarker, type Rect } from '../anim/anchors.ts';
import { fitText, wrapLines } from './layout.ts';
import { fontStatus, snapWeight } from './typography.ts';

/** Deterministic stand-in for Skia's text metrics: 0.55em per character. */
const measure = (size: number) => (text: string) => text.length * size * 0.55;

test('wrapping never exceeds the line limit and marks the cut', () => {
  const result = wrapLines('one two three four five six seven eight', measure(20), 120, 2);
  assert.equal(result.lines.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.lines[1].endsWith('…'));
  for (const line of result.lines) assert.ok(measure(20)(line) <= 120 + 0.5, line);
});

test('short copy wraps without a cut', () => {
  const result = wrapLines('LIFO in motion', measure(20), 400, 3);
  assert.deepEqual(result.lines, ['LIFO in motion']);
  assert.equal(result.truncated, false);
});

test('fitted text shrinks until it fits its box in both directions', () => {
  const ctx = createCanvas(400, 400).getContext('2d');
  const box = { x: 0, y: 0, w: 320, h: 120 };
  const fitted = fitText(ctx, 'Searching a sorted array? Check the middle first.', {
    box,
    role: 'display',
    weight: 700,
    size: 90,
    minSize: 30,
    maxLines: 3,
    lineHeight: 1.14
  });
  assert.ok(fitted.lines.length > 1, 'it breaks into several lines');
  assert.ok(fitted.size <= 90 && fitted.size >= 30);
  assert.ok(fitted.height <= box.h + 0.5, `height ${fitted.height} fits ${box.h}`);
  assert.ok(fitted.width <= box.w + 0.5, `width ${fitted.width} fits ${box.w}`);
  assert.equal(fitted.truncated, false);
});

test('text too long for its box is cut, not left to overflow', () => {
  const ctx = createCanvas(400, 400).getContext('2d');
  const box = { x: 0, y: 0, w: 120, h: 40 };
  const fitted = fitText(ctx, 'POP on an empty stack returns EMPTY and the size stays zero forever', {
    box,
    role: 'text',
    size: 40,
    minSize: 12,
    maxLines: 1
  });
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.width <= box.w + 0.5);
});

test('labels are placed beside their anchor and kept inside the frame', () => {
  const anchor: Rect = { x: 300, y: 400, w: 200, h: 120 };
  const bounds: Rect = { x: 0, y: 0, w: 1080, h: 1920 };
  const right = placeChip({ anchor, w: 140, h: 60, bounds });
  assert.equal(right.side, 'right');
  assert.ok(right.x >= anchor.x + anchor.w);

  // A block hugging the right edge has no room on the right, so the chip flips.
  const edge: Rect = { x: 940, y: 400, w: 120, h: 100 };
  const flipped = placeChip({ anchor: edge, w: 140, h: 60, bounds });
  assert.equal(flipped.side, 'left');
  assert.ok(flipped.x + flipped.w <= bounds.w + 0.5);
});

test('a label avoids an obstacle instead of overlapping it', () => {
  const anchor: Rect = { x: 300, y: 400, w: 200, h: 120 };
  const obstacles: Rect[] = [{ x: 520, y: 380, w: 160, h: 100 }];
  const placed = placeChip({ anchor, w: 160, h: 60, bounds: { x: 0, y: 0, w: 1080, h: 1920 }, obstacles });
  assert.notEqual(placed.side, 'right');
});

test('marker chips are clamped into the frame and never stack on top of each other', () => {
  const bounds: Rect = { x: 40, y: 0, w: 1000, h: 600 };
  const first = placeMarker({ centerX: 20, y: 300, w: 120, h: 44, bounds });
  assert.ok(first.x >= bounds.x);

  const second = placeMarker({ centerX: 20, y: 300, w: 120, h: 44, bounds, obstacles: [first] });
  assert.ok(second.y < first.y, 'the new marker is lifted clear of the first');
});

test('font weights snap to the bundled faces and every face is registered', () => {
  assert.equal(snapWeight('display', 500), 600);
  assert.equal(snapWeight('display', 800), 700);
  assert.equal(snapWeight('text', 550), 600);
  assert.equal(snapWeight('mono', 500), 400);
  const status = fontStatus();
  assert.equal(status.ok, true, status.failures.join('; '));
  assert.equal(status.faces, 7);
});
