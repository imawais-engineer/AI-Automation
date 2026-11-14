/**
 * Palette legibility guard.
 *
 * The renderer was built on a dark stage, where a night pill and half-strength
 * light ink read fine. A light theme inherits the same drawing code, so its
 * surfaces and ink have to be checked: a palette token that reaches `rgba()` as
 * `rgb(...)` silently falls back to near-black, and chips or captions then carry
 * dark ink on a dark card. These assertions cover every theme the rotation hands
 * out, so a light theme cannot ship unreadable copy again.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { THEMES, themePalette, type Theme } from '../themes.ts';
import { chipPaint, inkTone, paletteOf, type Palette } from '../anim/stage.ts';
import { rgba } from './paint.ts';

/** WCAG relative luminance of a colour, ignoring alpha (callers blend first). */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function channels(color: string): [number, number, number, number] {
  const functional = color.match(/rgba?\(([^)]+)\)/);
  if (functional) {
    const [r, g, b, a] = functional[1].split(',').map((part) => Number(part.trim()));
    return [r, g, b, Number.isFinite(a) ? a : 1];
  }
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
}

/** Paints `foreground` over an opaque `background`, then measures the contrast. */
function contrast(foreground: string, background: string): number {
  const [fr, fg, fb, fa] = channels(foreground);
  const [br, bg, bb] = channels(background);
  const blended = luminance([fr * fa + br * (1 - fa), fg * fa + bg * (1 - fa), fb * fa + bb * (1 - fa)]);
  const base = luminance([br, bg, bb]);
  const [high, low] = blended > base ? [blended, base] : [base, blended];
  return (high + 0.05) / (low + 0.05);
}

/** The palette a video rendered in this theme actually draws with. */
function paletteFor(theme: Theme): Palette {
  const { background, panel, ink, accent } = themePalette(theme);
  return paletteOf({ name: theme.name, background, panel, ink, accent, watermark: 'VISUAL CS LAB', outro: '' });
}

test('a light scrim is a hex token the overlay helpers can read', () => {
  for (const theme of THEMES) {
    const pal = paletteFor(theme);
    assert.match(pal.scrim, /^#[0-9a-f]{6}$/i, `${theme.id} scrim should be hex`);
    // rgba() falls back to near-black on anything it cannot parse, which is how a
    // paper caption became a night card with dark copy on it.
    assert.notEqual(rgba(pal.scrim, 0.9), rgba('#0b1220', 0.9), `${theme.id} scrim must parse as its own colour`);
  }
});

test('every label chip keeps its text readable', () => {
  for (const theme of THEMES) {
    const pal = paletteFor(theme);
    for (const accent of [pal.accent, pal.coral, pal.violet, pal.ink]) {
      const paint = chipPaint(pal, accent);
      const ratio = contrast(paint.ink, paint.surface);
      assert.ok(ratio >= 4.5, `${theme.id} chip on ${accent} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('secondary copy keeps its contrast on every theme', () => {
  for (const theme of THEMES) {
    const pal = paletteFor(theme);
    for (const alpha of [0.5, 0.6, 0.68, 0.78, 0.9]) {
      const ratio = contrast(inkTone(pal, alpha), pal.bg);
      assert.ok(ratio >= 4.5, `${theme.id} ink at ${alpha} is ${ratio.toFixed(2)}:1`);
    }
  }
});
