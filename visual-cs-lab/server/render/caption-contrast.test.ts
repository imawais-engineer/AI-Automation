/**
 * Painted-caption legibility guard.
 *
 * `theme-contrast.test.ts` checks the palette tokens a theme hands out. This test
 * paints the real caption strip — the band every video reads along the bottom —
 * and measures the pixels Skia actually produced, so a theme cannot ship copy the
 * viewer has to squint at. Stroke cores are measured rather than every edge pixel:
 * anti-aliasing deliberately blends a glyph into its surface, and it is the ink
 * core, not the blend, that a viewer reads.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createCanvas } from '@napi-rs/canvas';

import { THEMES, themePalette } from '../themes.ts';
import { captionBar, paletteOf } from '../anim/stage.ts';

const CAPTION = 'Doubling the input doubles a linear curve and quadruples a quadratic one, so pick the shape before the size.';

type Rect = { x: number; y: number; w: number; h: number };

function luminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function pixels(data: Uint8ClampedArray, width: number, rect: Rect) {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const at = (x: number, y: number) => (y * width + x) * 4;
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  return { x0, y0, w, h, at, inside };
}

/** The strip's own surface: the colour most of it is painted in. */
function surfaceOf(data: Uint8ClampedArray, width: number, rect: Rect): [number, number, number] {
  const { x0, y0, w, h, at } = pixels(data, width, rect);
  const counts = new Map<string, number>();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = at(x, y);
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [r, g, b] = winner.split(',').map(Number);
  return [r, g, b];
}

/** Contrasts of ink cores — ink pixels whose four neighbours are ink as well. */
function coreContrasts(data: Uint8ClampedArray, width: number, rect: Rect, surface: [number, number, number]): number[] {
  const { x0, y0, w, h, at, inside } = pixels(data, width, rect);
  const distance = (x: number, y: number) => {
    const i = at(x, y);
    return Math.abs(data[i] - surface[0]) + Math.abs(data[i + 1] - surface[1]) + Math.abs(data[i + 2] - surface[2]);
  };
  const ink = (x: number, y: number) => inside(x, y) && distance(x, y) > 90;
  const base = luminance(...surface);
  const ratios: number[] = [];
  for (let y = y0 + 1; y < y0 + h - 1; y++) {
    for (let x = x0 + 1; x < x0 + w - 1; x++) {
      if (!ink(x, y) || !ink(x - 1, y) || !ink(x + 1, y) || !ink(x, y - 1) || !ink(x, y + 1)) continue;
      const i = at(x, y);
      const value = luminance(data[i], data[i + 1], data[i + 2]);
      const [high, low] = value > base ? [value, base] : [base, value];
      ratios.push((high + 0.05) / (low + 0.05));
    }
  }
  return ratios.sort((a, b) => a - b);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

test('the caption strip stays readable on every theme', () => {
  for (const theme of THEMES) {
    const { background, panel, ink, accent } = themePalette(theme);
    const pal = paletteOf({ name: theme.name, background, panel, ink, accent, watermark: 'VISUAL CS LAB', outro: '' });
    // Painted at the master design size: at half scale a stroke is thin enough
    // that most of its pixels are partial coverage, which no video frame has.
    const dims = { width: 1080, height: 1920 };
    const canvas = createCanvas(dims.width, dims.height);
    const ctx = canvas.getContext('2d');

    // The stage the strip sits on, so the card is measured against real pixels.
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, dims.width, dims.height);
    const card = captionBar(ctx, dims, pal, { text: CAPTION, alpha: 1 });
    assert.ok(card.h > 0, `${theme.id} drew no caption strip`);

    const inset = { x: card.x + 26, y: card.y + 10, w: card.w - 34, h: card.h - 20 };
    const data = ctx.getImageData(0, 0, dims.width, dims.height).data;
    const surface = surfaceOf(data, dims.width, inset);
    const ratios = coreContrasts(data, dims.width, inset, surface);

    assert.ok(ratios.length > 500, `${theme.id} produced only ${ratios.length} ink cores`);
    const worst = percentile(ratios, 0.05);
    const typical = percentile(ratios, 0.5);
    assert.ok(worst >= 4.5, `${theme.id} caption ink dips to ${worst.toFixed(2)}:1`);
    assert.ok(typical >= 7, `${theme.id} caption ink sits at ${typical.toFixed(2)}:1`);
  }
});
