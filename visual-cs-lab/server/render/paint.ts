import type { SKRSContext2D } from '@napi-rs/canvas';

/** Small paint helpers shared by the frame renderer and its panels. */

export function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '#0b1220').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 11,
    parseInt(full.slice(2, 4), 16) || 18,
    parseInt(full.slice(4, 6), 16) || 32
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${channel(r1, r2)},${channel(g1, g2)},${channel(b1, b2)})`;
}

/**
 * Mix two hex colours and return hex, for palette tokens that are later passed to
 * `rgba()`. `mix` returns `rgb(...)`, which `rgba` cannot read — its fallback is
 * near-black, which is how a paper surface became an unreadable night card.
 */
export function mixHex(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  const part = (value: number) => value.toString(16).padStart(2, '0');
  return `#${part(channel(r1, r2))}${part(channel(g1, g2))}${part(channel(b1, b2))}`;
}

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
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

export function easeOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
