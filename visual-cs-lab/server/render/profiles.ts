/**
 * Output profiles and the frame arithmetic the encoder relies on.
 *
 * Everything here is pure so the timeline can be tested without touching a
 * canvas or ffmpeg: a 20 second lesson at 30 fps is exactly 600 frames, and the
 * per-scene frame counts are allocated so they add up to that number, never one
 * frame short of it.
 */

export type Preset = 'preview' | 'hd' | 'master' | '4k';

export type OutputProfile = {
  width: number;
  height: number;
  fps: number;
  label: string;
  purpose: string;
  /** x264 quality for this profile; lower is better looking and larger. */
  crf: string;
  /** x264 speed preset. */
  x264: string;
  /** Target bitrate for profiles that must stream at a guaranteed rate. */
  bitrate?: string;
  /** VBV buffer that goes with `bitrate`. */
  bufsize?: string;
};

export const PROFILES: Record<Preset, OutputProfile> = {
  preview: {
    width: 540,
    height: 960,
    fps: 30,
    label: 'Preview 540×960',
    purpose: 'Fast iteration while editing the storyboard.',
    crf: '21',
    x264: 'veryfast'
  },
  hd: {
    width: 1080,
    height: 1920,
    fps: 30,
    label: 'HD Shorts 1080×1920',
    purpose: 'Default publication output for Reels, Shorts and TikTok.',
    crf: '19',
    x264: 'veryfast'
  },
  master: {
    width: 1080,
    height: 1920,
    fps: 30,
    label: 'Master 1080×1920',
    purpose: 'Highest-quality 1080×1920 upload: near-lossless H.264 at a high bitrate.',
    crf: '15',
    x264: 'medium',
    // A guaranteed 16 Mbit/s: the upload master is not a web-optimised file.
    bitrate: '16M',
    bufsize: '32M'
  },
  '4k': {
    width: 2160,
    height: 3840,
    fps: 30,
    label: '4K vertical 2160×3840',
    purpose: 'Optional high-resolution master; slow and memory hungry.',
    crf: '21',
    x264: 'veryfast'
  }
};

/** How many frames a lesson of `durationMs` produces at `fps`. */
export function totalFrames(durationMs: number, fps: number): number {
  return Math.max(1, Math.round((Math.max(0, durationMs) / 1000) * fps));
}

/**
 * Frames per scene, in order, summing to exactly `totalFrames(sum(ms), fps)`.
 *
 * Per-scene rounding alone can lose or gain a frame (2.5 s at 24 fps is 60,
 * but 3.5 s is 84 exactly while a 7 s scene at 30 fps is 210); largest-remainder
 * allocation keeps the encoded duration equal to the storyboard to the frame.
 */
export function allocateFrames(durationsMs: number[], fps: number): number[] {
  const exact = durationsMs.map((ms) => (Math.max(0, ms) / 1000) * fps);
  const frames = exact.map((value) => Math.floor(value));
  const target = totalFrames(
    durationsMs.reduce((sum, ms) => sum + Math.max(0, ms), 0),
    fps
  );
  let remainder = target - frames.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remainder > 0 && order.length > 0; i++, remainder--) {
    frames[order[i % order.length].index] += 1;
  }
  // A scene never disappears: it always owns at least one frame.
  return frames.map((value) => Math.max(1, value));
}

/** Duration a frame count encodes to, in seconds. */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/** One frame of tolerance, rounded up a little for container time bases. */
export function durationToleranceSeconds(fps: number): number {
  return 2 / fps + 0.001;
}

/** H.264 needs even dimensions; every profile is already even, but guard edits. */
export function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
