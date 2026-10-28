/**
 * Easing and time helpers for the motion engine.
 *
 * Everything here is a pure function of time, so a frame is fully determined by
 * its timestamp: the preview and the MP4 export draw the exact same moment.
 */

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Normalised progress of `t` inside [start, end]. */
export function track(t: number, start: number, end: number): number {
  if (end <= start) return t >= end ? 1 : 0;
  return clamp01((t - start) / (end - start));
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutQuint(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
}

/** Slight overshoot, then settle — used when a value lands on the stack. */
export function easeOutBack(t: number, overshoot = 1.2): number {
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

/** 0 → 1 → 0 across [start, start + duration]. */
export function bump(t: number, start: number, duration: number): number {
  const p = track(t, start, start + duration);
  return p <= 0 || p >= 1 ? 0 : Math.sin(p * Math.PI);
}

/** Fade in across `fadeInMs` and out across `fadeOutMs`, clamped to the beat. */
export function envelope(t: number, start: number, end: number, fadeInMs = 220, fadeOutMs = 260): number {
  const inAlpha = easeOutCubic(track(t, start, start + fadeInMs));
  const outAlpha = 1 - easeInCubic(track(t, end - fadeOutMs, end));
  return clamp01(Math.min(inAlpha, outAlpha));
}

/** Deterministic pseudo-random in [0,1) so particle-free detail never flickers. */
export function hashNoise(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
