import type { SKRSContext2D } from '@napi-rs/canvas';

import type { BinarySearchVisual, Scene } from '../scenes.ts';
import { easeOut, lerp, mix, rgba, roundRect } from './paint.ts';
import { MONO, SANS } from './typography.ts';


const MID_COLOR = '#fbbf24';

/**
 * Which trace step is on screen at `elapsedMs`, plus how far into that step we
 * are (0 = comparison just appeared, 1 = range reduced). Steps share a scene's
 * duration evenly, so the 7 second trace scene gives each comparison its own beat.
 */
export function traceProgress(
  stepCount: number,
  durationMs: number,
  elapsedMs: number
): { index: number; local: number } {
  if (stepCount <= 0) return { index: 0, local: 1 };
  const segment = Math.max(1, durationMs / stepCount);
  const clamped = Math.max(0, Math.min(durationMs - 1, elapsedMs));
  const index = Math.min(stepCount - 1, Math.floor(clamped / segment));
  const local = Math.max(0, Math.min(1, (clamped - index * segment) / segment));
  return { index, local };
}

type Pill = (label: string, y: number, color?: string) => number;

export type BinaryPanelOptions = {
  ctx: SKRSContext2D;
  scene: Scene;
  visual: BinarySearchVisual;
  elapsedMs: number;
  accent: string;
  ink: string;
  k: number;
  pad: number;
  maxWidth: number;
  W: number;
  H: number;
  contentTop: number;
  pill: Pill;
};

/**
 * Draws the binary search array: index labels, target, LOW/HIGH/MID pointers,
 * the current comparison, eliminated ranges and the successful match. Sizes are
 * derived from the cell width, so the 540-wide preview stays readable on mobile.
 */
export function drawBinarySearchPanel(opts: BinaryPanelOptions): number {
  const { ctx, scene, visual, elapsedMs, accent, ink, k, pad, W, H, pill } = opts;
  const array = visual.array;
  const target = visual.target;
  const n = Math.max(1, array.length);
  const foundColor = mix(accent, '#ffffff', 0.35);

  const isTrace = visual.mode === 'trace' && visual.steps.length > 0;
  const { index: stepIndex, local } = traceProgress(
    isTrace ? visual.steps.length : 0,
    scene.durationMs,
    elapsedMs
  );
  const step = isTrace ? visual.steps[stepIndex] : null;
  const comparing = local < 0.62;
  const shift = easeOut((local - 0.62) / 0.38);
  const matched = Boolean(step && step.comparison === 'equal');

  let cursor = pill(isTrace ? `TRACE ${stepIndex + 1} / ${visual.steps.length}` : 'CONCEPT', opts.contentTop);
  cursor += Math.round(26 * k);

  ctx.font = `600 ${Math.round(28 * k)}px ${MONO}`;
  ctx.fillStyle = rgba(ink, 0.55);
  ctx.fillText(
    `target ${target} · ${array.length} cell${array.length === 1 ? '' : 's'} · sorted input`,
    pad,
    cursor + Math.round(24 * k)
  );

  const statusY = cursor + Math.round(96 * k);
  let status = 'Check the middle, then keep the half that can still hold the target.';
  let action = 'mid = floor((low + high) / 2)';
  if (step) {
    const symbol = step.comparison === 'less' ? '<' : step.comparison === 'greater' ? '>' : '=';
    status = `a[${step.mid}] = ${step.midValue} ${symbol} ${target}`;
    if (step.comparison === 'equal') {
      action = `MATCH · index ${step.mid}`;
    } else if (step.comparison === 'less') {
      action = comparing
        ? `discard the left half of ${step.low}–${step.high}`
        : `low = ${step.nextLow} · searching ${step.nextLow}–${step.nextHigh}`;
    } else {
      action = comparing
        ? `discard the right half of ${step.low}–${step.high}`
        : `high = ${step.nextHigh} · searching ${step.nextLow}–${step.nextHigh}`;
    }
  }

  ctx.font = `800 ${Math.round(46 * k)}px ${SANS}`;
  ctx.fillStyle = matched ? foundColor : accent;
  ctx.fillText(status, pad, statusY);
  ctx.font = `600 ${Math.round(27 * k)}px ${MONO}`;
  ctx.fillStyle = rgba(ink, 0.68);
  ctx.fillText(action, pad, statusY + Math.round(46 * k));

  // array geometry
  const gap = Math.round(14 * k);
  const cellW = Math.max(
    Math.round(54 * k),
    Math.min(Math.round(160 * k), Math.floor((opts.maxWidth - gap * (n - 1)) / n))
  );
  const cellH = Math.round(cellW * 0.94);
  const totalW = n * cellW + (n - 1) * gap;
  const startX = Math.round(W / 2 - totalW / 2);
  const centreOf = (index: number) => startX + index * (cellW + gap) + cellW / 2;
  const arrayTop = Math.round(H * 0.47);
  const arrayBottom = arrayTop + cellH;
  const valueFont = Math.round(Math.min(66 * k, cellW * 0.44));
  const indexFont = Math.round(Math.min(34 * k, cellW * 0.24));

  const eliminatedAlpha = new Map<number, number>();
  if (step) {
    for (let i = 0; i < stepIndex; i++) {
      for (const index of visual.steps[i].eliminated) eliminatedAlpha.set(index, 1);
    }
    if (!comparing) {
      for (const index of step.eliminated) eliminatedAlpha.set(index, shift);
    }
  }

  for (let i = 0; i < array.length; i++) {
    const x = startX + i * (cellW + gap);
    const gone = eliminatedAlpha.get(i) ?? 0;
    const active = step ? i === step.mid : false;
    const isMatch = active && matched;

    ctx.globalAlpha = 1 - gone * 0.72;
    ctx.fillStyle = isMatch ? rgba(foundColor, 0.22) : active ? rgba(accent, 0.18) : 'rgba(255,255,255,.05)';
    roundRect(ctx, x, arrayTop, cellW, cellH, Math.round(16 * k));
    ctx.fill();
    ctx.strokeStyle = isMatch ? foundColor : active ? accent : 'rgba(255,255,255,.16)';
    ctx.lineWidth = Math.max(1, Math.round((active ? 3 : 2) * k));
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `800 ${valueFont}px ${SANS}`;
    ctx.fillStyle = isMatch ? foundColor : active ? accent : ink;
    ctx.fillText(String(array[i]), x + cellW / 2, arrayTop + cellH / 2 + Math.round(valueFont * 0.34));

    if (gone > 0.35) {
      ctx.strokeStyle = rgba(ink, 0.5);
      ctx.lineWidth = Math.max(1, Math.round(2 * k));
      ctx.beginPath();
      ctx.moveTo(x + Math.round(18 * k), arrayTop + Math.round(22 * k));
      ctx.lineTo(x + cellW - Math.round(18 * k), arrayTop + cellH - Math.round(22 * k));
      ctx.stroke();
    }

    ctx.font = `600 ${indexFont}px ${MONO}`;
    ctx.fillStyle = rgba(ink, active ? 0.85 : 0.42);
    ctx.fillText(String(i), x + cellW / 2, arrayBottom + Math.round(indexFont * 1.2));
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  if (step) {
    const arrowY = arrayTop - Math.round(14 * k);
    const labelY = arrowY - Math.round(34 * k);
    const lowX = comparing
      ? centreOf(step.low)
      : lerp(centreOf(step.low), centreOf(Math.max(0, Math.min(n - 1, step.nextLow))), shift);
    const highX = comparing
      ? centreOf(step.high)
      : lerp(centreOf(step.high), centreOf(Math.max(0, Math.min(n - 1, step.nextHigh))), shift);

    const pointer = (x: number, colour: string, label: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(x, arrowY);
      ctx.lineTo(x - Math.round(12 * k), arrowY - Math.round(20 * k));
      ctx.lineTo(x + Math.round(12 * k), arrowY - Math.round(20 * k));
      ctx.closePath();
      ctx.fill();
      ctx.font = `700 ${Math.round(34 * k)}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, labelY);
      ctx.textAlign = 'left';
    };

    if (Math.abs(lowX - highX) < Math.round(70 * k)) {
      pointer(lowX, accent, 'LOW · HIGH');
    } else {
      pointer(lowX, accent, 'LOW');
      pointer(highX, mix(accent, ink, 0.6), 'HIGH');
    }

    // MID sits below the index labels so it never covers LOW/HIGH
    const midX = centreOf(step.mid);
    const midArrowY = arrayBottom + Math.round(indexFont * 1.2) + Math.round(26 * k);
    ctx.fillStyle = MID_COLOR;
    ctx.beginPath();
    ctx.moveTo(midX, midArrowY);
    ctx.lineTo(midX - Math.round(12 * k), midArrowY + Math.round(20 * k));
    ctx.lineTo(midX + Math.round(12 * k), midArrowY + Math.round(20 * k));
    ctx.closePath();
    ctx.fill();
    ctx.font = `700 ${Math.round(34 * k)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('MID', midX, midArrowY + Math.round(50 * k));
    ctx.textAlign = 'left';
  } else {
    const labelY = arrayBottom + Math.round(58 * k);
    ctx.font = `700 ${Math.round(32 * k)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.fillText(`target ${target}`, W / 2, labelY);
    ctx.textAlign = 'left';
  }

  return arrayBottom;
}
