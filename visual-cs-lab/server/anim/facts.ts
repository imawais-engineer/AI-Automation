/**
 * The labelled panel a traversal lesson shows on its complexity beat: a short
 * heading and up to three fact rows, inside the caption strip and the right rail.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

import { DESIGN_W, SAFE, inkTone, type Dims, type Palette } from './stage.ts';
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
  const k = dims.width / DESIGN_W;
  const S = SAFE * k;
  const width = dims.width - S * 2 - 40 * k;
  const top = 420 * k;
  const rows = facts.slice(0, 3);
  const height = 150 * k + rows.length * 118 * k + 40 * k;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(pal.scrim, pal.dark ? 0.74 : 0.92);
  roundRect(ctx, S, top, width, height, 26 * k);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.accent, pal.dark ? 0.24 : 0.4);
  ctx.lineWidth = 1.6 * k;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, title || 'Complexity', {
    box: { x: S + 34 * k, y: top + 34 * k, w: width - 68 * k, h: 70 * k },
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
    const y = top + 140 * k + index * 118 * k;
    drawText(ctx, fact.label.toUpperCase(), {
      box: { x: S + 34 * k, y, w: width - 68 * k, h: 30 * k },
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
      box: { x: S + 34 * k, y: y + 34 * k, w: width - 68 * k, h: 56 * k },
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
