import type { SKRSContext2D } from '@napi-rs/canvas';
import type { Scene } from '../scenes.ts';
import type { Brand } from '../db.ts';

const SANS = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '#0b1220').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 11,
    parseInt(full.slice(2, 4), 16) || 18,
    parseInt(full.slice(4, 6), 16) || 32
  ];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${channel(r1, r2)},${channel(g1, g2)},${channel(b1, b2)})`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
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
  if (consumed < words.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[ ,;:.]$/, '')}…`;
  }
  return lines;
}

function easeOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

export type FrameOptions = {
  width: number;
  height: number;
};

/** Draws one frame of a scene. `elapsedMs` is time inside that scene. */
export function drawFrame(
  ctx: SKRSContext2D,
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
  const entry = easeOut(elapsedMs / 380);
  const sceneProgress = Math.min(1, elapsedMs / Math.max(1, scene.durationMs));

  // background
  ctx.fillStyle = brand.background || '#0b1220';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createLinearGradient(0, 0, W, H);
  glow.addColorStop(0, rgba(accent, 0.1));
  glow.addColorStop(0.55, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let y = pad; y < H; y += Math.round(64 * k)) {
    for (let x = pad; x < W - pad / 2; x += Math.round(64 * k)) {
      ctx.fillRect(x, y, Math.round(2 * k) || 1, Math.round(2 * k) || 1);
    }
  }

  // header
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `600 ${Math.round(26 * k)}px ${MONO}`;
  ctx.fillStyle = rgba(ink, 0.55);
  ctx.fillText(brand.watermark || brand.name, pad, pad + Math.round(20 * k));
  const counter = `${String(sceneIndex + 1).padStart(2, '0')} / ${String(sceneCount).padStart(2, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(counter, W - pad, pad + Math.round(20 * k));
  ctx.textAlign = 'left';

  const contentTop = pad + Math.round(86 * k);
  const maxWidth = W - pad * 2;

  const pill = (label: string, y: number, color = accent) => {
    ctx.font = `700 ${Math.round(24 * k)}px ${MONO}`;
    const width = ctx.measureText(label).width + Math.round(40 * k);
    ctx.fillStyle = rgba(color, 0.16);
    roundRect(ctx, pad, y, width, Math.round(52 * k), Math.round(26 * k));
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pad + Math.round(20 * k), y + Math.round(26 * k));
    ctx.textBaseline = 'alphabetic';
    return y + Math.round(52 * k);
  };

  const paragraph = (text: string, y: number, size: number, color: string, maxLines: number, weight = 400) => {
    ctx.font = `${weight} ${Math.round(size * k)}px ${SANS}`;
    ctx.fillStyle = color;
    const lineHeight = Math.round(size * 1.38 * k);
    const lines = wrap(ctx, text, maxWidth, maxLines);
    lines.forEach((line, i) => ctx.fillText(line, pad, y + i * lineHeight));
    return y + lines.length * lineHeight;
  };

  ctx.globalAlpha = entry;
  let cursor = contentTop;

  if (scene.type === 'hook') {
    cursor = pill('HOOK', cursor) + Math.round(54 * k);
    ctx.font = `800 ${Math.round(84 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    const lines = wrap(ctx, scene.title, maxWidth, 5);
    const lineHeight = Math.round(100 * k);
    lines.forEach((line, i) => ctx.fillText(line, pad, cursor + i * lineHeight));
    cursor += lines.length * lineHeight + Math.round(26 * k);
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fillRect(pad, cursor - Math.round(18 * k), Math.round(120 * k), Math.round(6 * k));
    cursor += Math.round(26 * k);
    paragraph(scene.subtitle, cursor, 40, rgba(ink, 0.72), 4);
  } else if (scene.type === 'concept') {
    cursor = pill('CONCEPT', cursor) + Math.round(50 * k);
    ctx.font = `800 ${Math.round(68 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    ctx.fillText(scene.title, pad, cursor + Math.round(48 * k));
    cursor += Math.round(120 * k);
    paragraph(scene.subtitle, cursor, 42, rgba(ink, 0.78), 9);
  } else if (scene.type === 'code' && scene.code) {
    cursor = pill('IMPLEMENTATION', cursor) + Math.round(44 * k);
    ctx.font = `700 ${Math.round(44 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    ctx.fillText(scene.title.slice(0, 34), pad, cursor + Math.round(30 * k));
    cursor += Math.round(76 * k);
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
      if (i === scene.code!.highlight) {
        ctx.fillStyle = rgba(accent, 0.16);
        ctx.fillRect(pad + Math.round(8 * k), y - Math.round(28 * k), maxWidth - Math.round(16 * k), Math.round(40 * k));
      }
      ctx.fillStyle = i === scene.code!.highlight ? accent : rgba(ink, 0.82);
      ctx.fillText(line, pad + Math.round(26 * k), y);
    });
  } else if (scene.type === 'execution' && scene.visual) {
    const visual = scene.visual;
    cursor = pill(`STEP ${visual.step} / ${visual.total}`, cursor);
    cursor += Math.round(34 * k);
    const label =
      visual.op === 'push'
        ? `PUSH(${visual.value})`
        : visual.op === 'pop'
          ? visual.returned === null
            ? 'POP → EMPTY'
            : `POP → ${visual.returned}`
          : `TOP → ${visual.top ?? 'EMPTY'}`;
    ctx.font = `800 ${Math.round(58 * k)}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText(label, pad, cursor + Math.round(40 * k));
    cursor += Math.round(58 * k);

    const cell = Math.round(150 * k);
    const gap = Math.round(14 * k);
    const baseY = Math.round(H * 0.68);
    const centreX = W / 2 - cell / 2;

    (visual.items || []).forEach((value, index) => {
      const isTop = index === visual.items.length - 1;
      const isNewest = isTop && visual.op === 'push';
      const appear = isNewest ? easeOut((elapsedMs - 120) / 320) : 1;
      const y = baseY - (index + 1) * (cell + gap);
      const shift = isNewest ? Math.round((1 - appear) * -40 * k) : 0;
      ctx.globalAlpha = entry * (0.35 + 0.65 * appear);
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
      ctx.globalAlpha = entry;
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

    // TOP pointer
    if (visual.top !== null && visual.items.length > 0) {
      const topIndex = visual.items.length - 1;
      const y = baseY - (topIndex + 1) * (cell + gap) + cell / 2;
      const arrowX = centreX + cell + Math.round(28 * k);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(arrowX, y);
      ctx.lineTo(arrowX + Math.round(26 * k), y - Math.round(13 * k));
      ctx.lineTo(arrowX + Math.round(26 * k), y + Math.round(13 * k));
      ctx.closePath();
      ctx.fill();
      ctx.font = `700 ${Math.round(26 * k)}px ${MONO}`;
      ctx.fillText('TOP', arrowX + Math.round(36 * k), y + Math.round(9 * k));
    }

    // popped value flies out of the stack
    if (visual.op === 'pop' && visual.returned !== null) {
      const fly = easeOut(elapsedMs / 700);
      const y = baseY - (visual.items.length + 1) * (cell + gap) - Math.round(fly * 70 * k);
      ctx.globalAlpha = entry * (1 - fly * 0.85);
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
      ctx.globalAlpha = entry;
    }

    ctx.font = `500 ${Math.round(26 * k)}px ${MONO}`;
    ctx.fillStyle = rgba(ink, 0.55);
    ctx.fillText(`size ${visual.items.length} · LIFO`, pad, baseY + Math.round(48 * k));
  } else if (scene.type === 'complexity') {
    cursor = pill('COMPLEXITY', cursor) + Math.round(52 * k);
    ctx.font = `800 ${Math.round(64 * k)}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText('Time', pad, cursor + Math.round(40 * k));
    cursor += Math.round(74 * k);
    cursor = paragraph(scene.subtitle, cursor, 46, ink, 3, 700) + Math.round(30 * k);
    ctx.font = `800 ${Math.round(40 * k)}px ${SANS}`;
    ctx.fillStyle = rgba(ink, 0.6);
    ctx.fillText('Space', pad, cursor + Math.round(20 * k));
    cursor += Math.round(46 * k);
    paragraph(scene.caption.split('Space:')[1]?.replace(/\.$/, '') || '—', cursor, 38, rgba(ink, 0.78), 3);
  } else if (scene.type === 'summary') {
    cursor = pill('TAKEAWAY', cursor) + Math.round(52 * k);
    ctx.font = `800 ${Math.round(62 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    const lines = wrap(ctx, scene.title, maxWidth, 5);
    const lineHeight = Math.round(78 * k);
    lines.forEach((line, i) => ctx.fillText(line, pad, cursor + Math.round(40 * k) + i * lineHeight));
    cursor += lines.length * lineHeight + Math.round(54 * k);
    paragraph(scene.subtitle, cursor, 36, rgba(ink, 0.62), 3);
    cursor += Math.round(70 * k);
    paragraph(scene.caption, cursor, 40, accent, 3, 700);
  } else if (scene.type === 'brand') {
    const centreY = H / 2 - Math.round(60 * k);
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(26 * k)}px ${MONO}`;
    ctx.fillStyle = accent;
    ctx.fillText('VISUAL CS LAB', W / 2, centreY - Math.round(90 * k));
    ctx.font = `800 ${Math.round(80 * k)}px ${SANS}`;
    ctx.fillStyle = ink;
    ctx.fillText(brand.name, W / 2, centreY);
    ctx.font = `400 ${Math.round(36 * k)}px ${SANS}`;
    ctx.fillStyle = rgba(ink, 0.66);
    ctx.fillText(scene.subtitle, W / 2, centreY + Math.round(60 * k));
    if (brand.outro) {
      ctx.font = `600 ${Math.round(30 * k)}px ${MONO}`;
      ctx.fillStyle = accent;
      ctx.fillText(brand.outro, W / 2, centreY + Math.round(126 * k));
    }
    ctx.textAlign = 'left';
  }

  ctx.globalAlpha = 1;

  // caption bar
  if (scene.caption && scene.type !== 'brand') {
    const captionFade = easeOut((elapsedMs - 180) / 260);
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
    const lines = wrap(ctx, scene.caption, maxWidth - Math.round(60 * k), 3);
    const lineHeight = Math.round(size * 1.34);
    const boxH = lines.length * lineHeight + Math.round(44 * k);
    const boxY = H - Math.round(160 * k) - boxH;
    ctx.fillStyle = style.background || 'rgba(3,8,18,.72)';
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

  // timeline progress
  const barY = H - Math.round(46 * k);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(pad, barY, maxWidth, Math.round(6 * k));
  const overall = (sceneIndex + sceneProgress) / Math.max(1, sceneCount);
  ctx.fillStyle = accent;
  ctx.fillRect(pad, barY, maxWidth * overall, Math.round(6 * k));
}

/** Total duration of a scene list, in milliseconds. */
export function totalDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
}
