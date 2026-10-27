import type { SKRSContext2D } from '@napi-rs/canvas';
import type { Scene } from '../scenes.ts';
import type { Brand } from '../db.ts';
import { drawBinarySearchPanel } from './binary-search-panel.ts';
import { easeOut, rgba, roundRect, wrap } from './paint.ts';
import { MONO, SANS } from './typography.ts';

export type FrameOptions = {
  width: number;
  height: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Frame of a scene, in ms, where the outgoing fade starts. */
const EXIT_MS = 200;
const ENTER_MS = 280;

type Ctx = SKRSContext2D;

function grid(
  ctx: Ctx,
  W: number,
  H: number,
  k: number,
  pad: number,
  accent: string,
  elapsedMs: number
): void {
  // A slow drift keeps the frame alive without pulling attention off the algorithm.
  const step = Math.round(64 * k);
  const drift = ((elapsedMs / 1000) * 5 * k) % step;
  ctx.fillStyle = rgba(accent, 0.055);
  const dot = Math.max(1, Math.round(2 * k));
  for (let y = pad - step + drift; y < H; y += step) {
    for (let x = pad; x < W - pad / 2; x += step) {
      ctx.fillRect(Math.round(x), Math.round(y), dot, dot);
    }
  }
}

function background(
  ctx: Ctx,
  W: number,
  H: number,
  k: number,
  pad: number,
  brand: Brand,
  accent: string,
  elapsedMs: number
): void {
  ctx.fillStyle = brand.background || '#0b1220';
  ctx.fillRect(0, 0, W, H);

  const breathe = 0.06 + Math.sin(elapsedMs / 2600) * 0.015;
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, H * 0.72);
  glow.addColorStop(0, rgba(accent, breathe));
  glow.addColorStop(0.55, rgba(accent, 0.02));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  grid(ctx, W, H, k, pad, accent, elapsedMs);

  // Vignette: keeps captions and code readable against the glow.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

/** Draws one frame of a scene. `elapsedMs` is time inside that scene. */
export function drawFrame(
  ctx: Ctx,
  scene: Scene,
  sceneIndex: number,
  sceneCount: number,
  elapsedMs: number,
  brand: Brand,
  opts: FrameOptions
): void {
  const W = opts.width;
  const H = opts.height;
  const k = W / 1080;
  const pad = Math.round(72 * k);
  const accent = brand.accent || '#22d3ee';
  const ink = brand.ink || '#e6edf7';
  const sceneMs = Math.max(1, scene.durationMs);
  const enter = easeOut(elapsedMs / ENTER_MS);
  const exit = easeOut((sceneMs - elapsedMs) / EXIT_MS);
  const alpha = Math.min(enter, exit);
  const rise = Math.round((1 - enter) * 22 * k);

  background(ctx, W, H, k, pad, brand, accent, elapsedMs);

  // header
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `600 ${Math.round(24 * k)}px ${MONO}`;
  ctx.fillStyle = rgba(ink, 0.45);
  ctx.fillText(String(brand.watermark || brand.name).toUpperCase(), pad, pad + Math.round(18 * k));
  const counter = `${String(sceneIndex + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(counter, W - pad, pad + Math.round(18 * k));
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ink, 0.12);
  ctx.fillRect(pad, pad + Math.round(34 * k), W - pad * 2, Math.max(1, Math.round(1.5 * k)));
  ctx.globalAlpha = 1;

  const contentTop = pad + Math.round(86 * k);
  const maxWidth = W - pad * 2;

  const pill = (label: string, y: number, color = accent) => {
    ctx.font = `700 ${Math.round(23 * k)}px ${MONO}`;
    const width = ctx.measureText(label).width + Math.round(38 * k);
    ctx.fillStyle = rgba(color, 0.16);
    roundRect(ctx, pad, y, width, Math.round(50 * k), Math.round(25 * k));
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pad + Math.round(19 * k), y + Math.round(25 * k));
    ctx.textBaseline = 'alphabetic';
    return y + Math.round(50 * k);
  };

  const paragraph = (
    text: string,
    y: number,
    size: number,
    color: string,
    maxLines: number,
    weight = 400
  ) => {
    ctx.font = `${weight} ${Math.round(size * k)}px ${SANS}`;
    ctx.fillStyle = color;
    const lineHeight = Math.round(size * 1.38 * k);
    const lines = wrap(ctx, text, maxWidth, maxLines);
    lines.forEach((line, i) => ctx.fillText(line, pad, y + i * lineHeight));
    return y + lines.length * lineHeight;
  };

  /** Lines that fade and rise in one after another. */
  const staggered = (
    lines: string[],
    x: number,
    y: number,
    size: number,
    lineHeight: number,
    color: string,
    weight = 800,
    delay = 90
  ) => {
    ctx.font = `${weight} ${Math.round(size * k)}px ${SANS}`;
    ctx.textAlign = x === W / 2 ? 'center' : 'left';
    lines.forEach((line, i) => {
      const local = easeOut((elapsedMs - i * delay) / 300);
      ctx.globalAlpha = alpha * local;
      ctx.fillStyle = color;
      ctx.fillText(line, x, y + i * lineHeight + Math.round((1 - local) * 16 * k));
    });
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'left';
    return y + lines.length * lineHeight;
  };

  ctx.globalAlpha = alpha;
  ctx.translate(0, rise);

  if (scene.type === 'hook') {
    let cursor = pill('HOOK', contentTop);
    cursor += Math.round(52 * k);
    ctx.font = `800 ${Math.round(82 * k)}px ${SANS}`;
    const lines = wrap(ctx, scene.title, maxWidth, 4);
    cursor = staggered(lines, pad, cursor + Math.round(66 * k), 82, Math.round(96 * k), ink, 800, 110);
    // accent rule grows under the headline
    const grow = easeOut((elapsedMs - 260) / 420);
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fillRect(pad, cursor + Math.round(6 * k), Math.round(150 * k * grow), Math.round(6 * k));
    const subAlpha = easeOut((elapsedMs - 460) / 420);
    ctx.globalAlpha = alpha * subAlpha;
    paragraph(scene.subtitle, cursor + Math.round(56 * k), 40, rgba(ink, 0.74), 4);
    ctx.globalAlpha = alpha;
  } else if ((scene.type === 'concept' || scene.type === 'trace') && scene.visual?.kind === 'binary-search') {
    drawBinarySearchPanel({
      ctx,
      scene,
      visual: scene.visual,
      elapsedMs,
      accent,
      ink,
      k,
      pad,
      maxWidth,
      W,
      H,
      contentTop,
      pill
    });
  } else if (scene.type === 'concept') {
    let cursor = pill('CONCEPT', contentTop) + Math.round(48 * k);
    ctx.font = `800 ${Math.round(64 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    const lines = wrap(ctx, scene.title, maxWidth, 2);
    cursor = staggered(lines, pad, cursor + Math.round(44 * k), 64, Math.round(74 * k), ink, 800, 90);
    paragraph(scene.subtitle, cursor + Math.round(24 * k), 42, rgba(ink, 0.78), 9);
  } else if (scene.type === 'code' && scene.code) {
    let cursor = pill('IMPLEMENTATION', contentTop) + Math.round(42 * k);
    ctx.font = `700 ${Math.round(42 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    ctx.fillText(scene.title.slice(0, 34), pad, cursor + Math.round(28 * k));
    cursor += Math.round(72 * k);
    const panelH = Math.round(scene.code.lines.length * 46 * k + 56 * k);
    ctx.fillStyle = 'rgba(3,8,18,.72)';
    roundRect(ctx, pad, cursor, maxWidth, panelH, Math.round(24 * k));
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.25);
    ctx.lineWidth = Math.max(1, Math.round(2 * k));
    ctx.stroke();
    ctx.font = `400 ${Math.round(28 * k)}px ${MONO}`;
    scene.code.lines.forEach((line, i) => {
      const y = cursor + Math.round(46 * k) + i * Math.round(46 * k);
      ctx.globalAlpha = alpha * easeOut((elapsedMs - i * 45) / 260);
      if (i === scene.code!.highlight) {
        ctx.fillStyle = rgba(accent, 0.16);
        ctx.fillRect(pad + Math.round(8 * k), y - Math.round(28 * k), maxWidth - Math.round(16 * k), Math.round(40 * k));
      }
      ctx.fillStyle = i === scene.code!.highlight ? accent : rgba(ink, 0.82);
      ctx.fillText(line, pad + Math.round(26 * k), y);
    });
    ctx.globalAlpha = alpha;
  } else if (scene.type === 'execution' && scene.visual?.kind === 'stack') {
    cursorForStack(ctx, scene, elapsedMs, { W, H, k, pad, accent, ink, pill, contentTop, alpha });
  } else if (scene.type === 'complexity') {
    let cursor = pill('COMPLEXITY', contentTop) + Math.round(58 * k);
    ctx.font = `600 ${Math.round(24 * k)}px ${MONO}`;
    ctx.fillStyle = rgba(ink, 0.5);
    ctx.fillText('TIME COMPLEXITY', pad, cursor);
    cursor += Math.round(26 * k);
    const hero = scene.subtitle || '—';
    cursor = staggered([hero], pad, cursor + Math.round(96 * k), 116, Math.round(120 * k), accent, 800, 80) + Math.round(28 * k);

    const facts = scene.facts?.length
      ? scene.facts
      : [
          { label: 'SPACE', value: (scene.caption.split('Space:')[1] || '—').replace(/\.$/, '').trim() },
          { label: 'NOTE', value: 'Each comparison halves the range.' }
        ];
    const gap = Math.round(18 * k);
    const cardW = Math.floor((maxWidth - gap) / 2);
    const cardH = Math.round(150 * k);
    facts.slice(0, 4).forEach((fact, i) => {
      const local = easeOut((elapsedMs - 380 - i * 140) / 340);
      if (local <= 0) return;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = pad + col * (cardW + gap);
      const y = cursor + row * (cardH + gap) + Math.round((1 - local) * 24 * k);
      ctx.globalAlpha = alpha * local;
      ctx.fillStyle = 'rgba(255,255,255,.045)';
      roundRect(ctx, x, y, cardW, cardH, Math.round(18 * k));
      ctx.fill();
      ctx.strokeStyle = rgba(accent, 0.2);
      ctx.lineWidth = Math.max(1, Math.round(1.6 * k));
      ctx.stroke();
      ctx.font = `700 ${Math.round(20 * k)}px ${MONO}`;
      ctx.fillStyle = rgba(accent, 0.85);
      ctx.fillText(fact.label.toUpperCase(), x + Math.round(22 * k), y + Math.round(42 * k));
      ctx.font = `700 ${Math.round(34 * k)}px ${SANS}`;
      ctx.fillStyle = ink;
      const lines = wrap(ctx, fact.value, cardW - Math.round(44 * k), 3);
      lines.forEach((line, lineIndex) =>
        ctx.fillText(line, x + Math.round(22 * k), y + Math.round(88 * k) + lineIndex * Math.round(38 * k))
      );
      ctx.globalAlpha = alpha;
    });

    if (scene.title) {
      const takeAlpha = easeOut((elapsedMs - 900) / 420);
      ctx.globalAlpha = alpha * takeAlpha;
      const takeY = Math.min(
        H - Math.round(230 * k),
        cursor + Math.ceil(facts.length / 2) * (cardH + gap) + Math.round(40 * k)
      );
      ctx.fillStyle = rgba(ink, 0.14);
      ctx.fillRect(pad, takeY, maxWidth, Math.max(1, Math.round(1.5 * k)));
      ctx.font = `700 ${Math.round(20 * k)}px ${MONO}`;
      ctx.fillStyle = rgba(accent, 0.9);
      ctx.fillText('TAKEAWAY', pad, takeY + Math.round(36 * k));
      ctx.font = `600 ${Math.round(33 * k)}px ${SANS}`;
      ctx.fillStyle = ink;
      const lines = wrap(ctx, scene.title, maxWidth, 3);
      lines.forEach((line, i) => ctx.fillText(line, pad, takeY + Math.round(76 * k) + i * Math.round(42 * k)));
      ctx.globalAlpha = alpha;
    }
  } else if (scene.type === 'summary') {
    let cursor = pill('TAKEAWAY', contentTop) + Math.round(50 * k);
    ctx.font = `800 ${Math.round(60 * k)}px ${SANS}`;
    const lines = wrap(ctx, scene.title, maxWidth, 5);
    cursor = staggered(lines, pad, cursor + Math.round(48 * k), 60, Math.round(74 * k), ink, 800, 100) + Math.round(34 * k);
    paragraph(scene.subtitle, cursor, 36, rgba(ink, 0.64), 3);
    const ctaAlpha = easeOut((elapsedMs - 640) / 420);
    ctx.globalAlpha = alpha * ctaAlpha;
    paragraph(scene.caption, cursor + Math.round(72 * k), 40, accent, 3, 700);
    ctx.globalAlpha = alpha;
  } else if (scene.type === 'brand') {
    const centreY = H / 2 - Math.round(70 * k);
    const mark = easeOut(elapsedMs / 480);
    const size = Math.round(132 * k);
    const markX = W / 2 - size / 2;
    const markY = centreY - Math.round(250 * k) + Math.round((1 - mark) * 18 * k);
    ctx.globalAlpha = alpha * mark;
    ctx.fillStyle = rgba(accent, 0.14);
    roundRect(ctx, markX, markY, size, size, Math.round(30 * k));
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.55);
    ctx.lineWidth = Math.max(1, Math.round(2 * k));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(56 * k)}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText('VL', W / 2, markY + size / 2 + Math.round(20 * k));

    ctx.font = `600 ${Math.round(22 * k)}px ${MONO}`;
    ctx.fillStyle = rgba(ink, 0.55);
    ctx.fillText('CODE-DRIVEN CS SHORTS', W / 2, markY + size + Math.round(54 * k));

    ctx.font = `800 ${Math.round(78 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    ctx.fillText(brand.name, W / 2, centreY);

    const sweep = easeOut((elapsedMs - 320) / 520);
    ctx.fillStyle = accent;
    const lineW = Math.round(220 * k * sweep);
    ctx.fillRect(W / 2 - lineW / 2, centreY + Math.round(38 * k), lineW, Math.round(5 * k));

    const tagAlpha = easeOut((elapsedMs - 520) / 460);
    ctx.globalAlpha = alpha * tagAlpha;
    ctx.font = `400 ${Math.round(34 * k)}px ${SANS}`;
    ctx.fillStyle = rgba(ink, 0.7);
    const tagline = wrap(ctx, scene.subtitle, maxWidth, 3);
    tagline.forEach((line, i) => ctx.fillText(line, W / 2, centreY + Math.round(108 * k) + i * Math.round(44 * k)));
    if (brand.outro) {
      ctx.font = `600 ${Math.round(26 * k)}px ${MONO}`;
      ctx.fillStyle = accent;
      ctx.fillText(brand.outro, W / 2, centreY + Math.round(108 * k) + tagline.length * Math.round(44 * k) + Math.round(46 * k));
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = alpha;
  }

  ctx.translate(0, -rise);
  ctx.globalAlpha = 1;

  // caption bar: slides up and fades in, always above the progress bar
  if (scene.caption && scene.type !== 'brand') {
    const captionFade = easeOut((elapsedMs - 220) / 280);
    if (captionFade > 0) {
      ctx.globalAlpha = captionFade;
      const style = (() => {
        try {
          return JSON.parse(brand.caption_style || '{}') as { size?: number; background?: string };
        } catch {
          return {} as { size?: number; background?: string };
        }
      })();
      const size = Math.round((style.size || 42) * k);
      ctx.font = `600 ${size}px ${SANS}`;
      const lines = wrap(ctx, scene.caption, maxWidth - Math.round(64 * k), 3);
      const lineHeight = Math.round(size * 1.34);
      const boxH = lines.length * lineHeight + Math.round(44 * k);
      const boxY = H - Math.round(150 * k) - boxH + Math.round((1 - captionFade) * 14 * k);
      ctx.fillStyle = style.background || 'rgba(3,8,18,.78)';
      roundRect(ctx, pad, boxY, maxWidth, boxH, Math.round(20 * k));
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(pad, boxY, Math.round(6 * k), boxH);
      ctx.fillStyle = ink;
      lines.forEach((line, i) => {
        ctx.fillText(line, pad + Math.round(30 * k), boxY + Math.round(30 * k) + i * lineHeight);
      });
      ctx.globalAlpha = 1;
    }
  }

  // brand signature
  ctx.font = `600 ${Math.round(19 * k)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(ink, 0.28);
  ctx.fillText('VL · VISUAL CS LAB', W - pad, H - Math.round(66 * k));
  ctx.textAlign = 'left';

  // timeline progress
  const barY = H - Math.round(44 * k);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(pad, barY, maxWidth, Math.round(6 * k));
  const overall = (sceneIndex + clamp01(elapsedMs / sceneMs)) / Math.max(1, sceneCount);
  ctx.fillStyle = accent;
  ctx.fillRect(pad, barY, maxWidth * overall, Math.round(6 * k));
}

type StackChrome = {
  W: number;
  H: number;
  k: number;
  pad: number;
  accent: string;
  ink: string;
  pill: (label: string, y: number, color?: string) => number;
  contentTop: number;
  alpha: number;
};

function cursorForStack(
  ctx: Ctx,
  scene: Scene,
  elapsedMs: number,
  chrome: StackChrome
): void {
  if (scene.visual?.kind !== 'stack') return;
  const { W, H, k, pad, accent, ink, pill, contentTop, alpha } = chrome;
  const visual = scene.visual;
  let cursor = pill(`STEP ${visual.step} / ${visual.total}`, contentTop) + Math.round(52 * k);
  const label =
    visual.op === 'push'
      ? `PUSH(${visual.value})`
      : visual.op === 'pop'
        ? visual.returned === null
          ? 'POP → EMPTY'
          : `POP → ${visual.returned}`
        : `TOP → ${visual.top ?? 'EMPTY'}`;
  const labelIn = easeOut(elapsedMs / 320);
  ctx.globalAlpha = alpha * labelIn;
  ctx.font = `800 ${Math.round(56 * k)}px ${SANS}`;
  ctx.fillStyle = accent;
  ctx.fillText(label, pad, cursor + Math.round((1 - labelIn) * 16 * k) + Math.round(30 * k));
  ctx.globalAlpha = alpha;
  cursor += Math.round(64 * k);

  const cell = Math.round(146 * k);
  const gap = Math.round(14 * k);
  const baseY = Math.round(H * 0.68);
  const centreX = W / 2 - cell / 2;

  (visual.items || []).forEach((value, index) => {
    const isTop = index === visual.items.length - 1;
    const isNewest = isTop && visual.op === 'push';
    const appear = isNewest ? easeOut((elapsedMs - 120) / 320) : 1;
    const y = baseY - (index + 1) * (cell + gap);
    const shift = isNewest ? Math.round((1 - appear) * -44 * k) : 0;
    ctx.globalAlpha = alpha * (0.35 + 0.65 * appear);
    ctx.fillStyle = isTop ? rgba(accent, 0.2) : 'rgba(255,255,255,.05)';
    roundRect(ctx, centreX, y + shift, cell, cell, Math.round(18 * k));
    ctx.fill();
    ctx.strokeStyle = isTop ? accent : 'rgba(255,255,255,.16)';
    ctx.lineWidth = Math.max(1, Math.round((isTop ? 3 : 2) * k));
    ctx.stroke();
    ctx.fillStyle = isTop ? accent : ink;
    ctx.font = `800 ${Math.round(48 * k)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(value), centreX + cell / 2, y + shift + cell / 2 + Math.round(16 * k));
    ctx.font = `500 ${Math.round(22 * k)}px ${MONO}`;
    ctx.fillStyle = rgba(ink, 0.42);
    ctx.fillText(`#${index}`, centreX + cell / 2, y + shift + cell - Math.round(16 * k));
    ctx.textAlign = 'left';
    ctx.globalAlpha = alpha;
  });

  if (visual.items.length === 0) {
    ctx.strokeStyle = rgba(ink, 0.28);
    ctx.setLineDash([Math.round(10 * k), Math.round(10 * k)]);
    roundRect(ctx, centreX, baseY - cell, cell, cell, Math.round(18 * k));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(ink, 0.45);
    ctx.font = `600 ${Math.round(26 * k)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('empty', centreX + cell / 2, baseY - cell / 2 + Math.round(10 * k));
    ctx.textAlign = 'left';
  }

  if (visual.top !== null && visual.items.length > 0) {
    const topIndex = visual.items.length - 1;
    const y = baseY - (topIndex + 1) * (cell + gap) + cell / 2;
    const arrowX = centreX + cell + Math.round(28 * k);
    const bob = Math.sin(elapsedMs / 520) * Math.round(4 * k);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(arrowX + bob, y);
    ctx.lineTo(arrowX + Math.round(26 * k) + bob, y - Math.round(13 * k));
    ctx.lineTo(arrowX + Math.round(26 * k) + bob, y + Math.round(13 * k));
    ctx.closePath();
    ctx.fill();
    ctx.font = `700 ${Math.round(26 * k)}px ${MONO}`;
    ctx.fillText('TOP', arrowX + Math.round(36 * k), y + Math.round(9 * k));
  }

  if (visual.op === 'pop' && visual.returned !== null) {
    const fly = easeOut(elapsedMs / 700);
    const y = baseY - (visual.items.length + 1) * (cell + gap) - Math.round(fly * 70 * k);
    ctx.globalAlpha = alpha * (1 - fly * 0.85);
    ctx.fillStyle = rgba(accent, 0.18);
    roundRect(ctx, centreX, y, cell, cell, Math.round(18 * k));
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, Math.round(3 * k));
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = `800 ${Math.round(48 * k)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(visual.returned), centreX + cell / 2, y + cell / 2 + Math.round(16 * k));
    ctx.textAlign = 'left';
    ctx.globalAlpha = alpha;
  }

  ctx.font = `500 ${Math.round(26 * k)}px ${MONO}`;
  ctx.fillStyle = rgba(ink, 0.55);
  ctx.fillText(`size ${visual.items.length} · LIFO`, pad, baseY + Math.round(48 * k));
}

/** Total duration of a scene list, in milliseconds. */
export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
}
