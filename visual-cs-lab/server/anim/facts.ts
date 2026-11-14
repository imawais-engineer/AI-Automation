/**
 * The labelled panel a traversal lesson shows on its complexity beat: a short
 * heading and up to three fact rows, inside the caption strip and the right rail.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import {
  SAFE,
  chromeScale,
  frameRhythm,
  inkTone,
  isLandscape,
  type Dims,
  type Palette
} from './stage.ts';
import { drawText } from '../render/layout.ts';
import { rgba, roundRect } from '../render/paint.ts';

export type Fact = { label: string; value: string };

export function factsPanel(
  ctx: SKRSContext2D,
  dims: Dims,
  pal: Palette,
  title: string,
  facts: Fact[],
  alpha: number
): void {
  const k = chromeScale(dims);
  // A landscape frame stacks the same panel in a shorter, narrower block centred
  // over the stage, so it never runs into the caption strip below it.
  const v = frameRhythm(dims);
  const land = isLandscape(dims);
  const S = SAFE * k;
  const width = land ? Math.min(dims.width - S * 2, 1180 * k) : dims.width - S * 2 - 40 * k;
  const x0 = land ? (dims.width - width) / 2 : S;
  const top = 420 * k * v + (land ? 130 * k : 0);
  const rows = facts.slice(0, 3);
  const height = (150 * k + rows.length * 118 * k + 40 * k) * v;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.scrim, pal.dark ? 0.74 : 0.92);
  roundRect(ctx, x0, top, width, height, 26 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, pal.dark ? 0.24 : 0.4);
  ctx.lineWidth = 1.6 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, title || 'Complexity', {
    box: { x: x0 + 34 * k, y: top + 34 * k * v, w: width - 68 * k, h: 70 * k * v },
    role: 'display',
    weight: 700,
    size: 46 * k,
    minSize: 30 * k,
    maxLines: 2,
    lineHeight: 1.1,
    color: pal.ink,
    alpha,
    group: 'facts-title'
  });

  rows.forEach((fact, index) => {
    const y = top + 140 * k * v + index * 118 * k * v;
    drawText(ctx, fact.label.toUpperCase(), {
      box: { x: x0 + 34 * k, y, w: width - 68 * k, h: 30 * k * v },
      role: 'mono',
      weight: 600,
      size: 22 * k,
      minSize: 16 * k,
      maxLines: 1,
      color: inkTone(pal, 0.5),
      alpha,
      group: 'facts-label'
    });
    drawText(ctx, fact.value, {
      box: { x: x0 + 34 * k, y: y + 34 * k * v, w: width - 68 * k, h: 56 * k * v },
      role: 'text',
      weight: 600,
      size: 34 * k,
      minSize: 22 * k,
      maxLines: 2,
      lineHeight: 1.2,
      color: inkTone(pal, 0.92),
      alpha,
      group: 'facts-value'
    });
  });
}
