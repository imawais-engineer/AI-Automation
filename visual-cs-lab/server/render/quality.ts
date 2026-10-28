/**
 * Output quality checks for a rendered MP4.
 *
 * The checks run against the actual file: container and stream metadata parsed
 * from ffmpeg's probe output, a full decode pass that counts real frames, and
 * pixel statistics from frames sampled at the start, middle and end. A job is
 * only *quality checked* when every automated check passes; questions a machine
 * cannot honestly answer (is the explanation correct, is the text legible on a
 * phone) are returned as explicit human-review items instead of a false pass.
 */

import type { OutputProfile } from './profiles.ts';
import { durationToleranceSeconds } from './profiles.ts';

export type MediaInfo = {
  container: string;
  codec: string;
  pixelFormat: string;
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
};

export type RenderCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type FrameSample = {
  /** Where in the file the frame was taken, in seconds. */
  at: number;
  width: number;
  height: number;
  mean: number;
  stddev: number;
  inkFraction: number;
  signature: number[];
};

export type RenderValidation = {
  ok: boolean;
  media: MediaInfo | null;
  checks: RenderCheck[];
  humanReview: string[];
  samples: FrameSample[];
  validatedAt: string;
};

const MB = 1024 * 1024;

/** Parses the `Input #0 … Video: …` block ffmpeg prints for an existing file. */
export function parseMediaInfo(stderr: string): MediaInfo | null {
  if (!stderr) return null;
  const stream = stderr.match(/Stream #\d+:\d+[^:]*: Video: ([a-zA-Z0-9_]+)(?:[^\n]*?)(?:\(([a-zA-Z0-9_]+)\))?[^\n]*/);
  const videoLine = (stderr.split('\n').find((line) => /Stream #\d+:\d+.*: Video:/.test(line)) || '').trim();
  if (!videoLine) return null;

  const codec = stream?.[1] || (videoLine.match(/Video: ([a-zA-Z0-9_]+)/)?.[1] ?? '');
  const dimension = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const pixelFormat =
    videoLine.match(/Video: [a-zA-Z0-9_]+[^\n]*?, (yuv[a-z0-9]+|rgb[a-z0-9]+|gray[a-z0-9]*|nv12|p010le)/)?.[1] || '';
  const container = (stderr.match(/Input #0, ([a-zA-Z0-9_,]+)/)?.[1] || '').split(',')[0];
  const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;

  if (!dimension || !codec) return null;
  return {
    container,
    codec,
    pixelFormat,
    width: Number(dimension[1]),
    height: Number(dimension[2]),
    durationSeconds,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr)
  };
}

/** Luma statistics for one decoded frame, plus a coarse signature for comparison. */
export function frameSample(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  at: number,
  signatureCols = 32,
  signatureRows = 57
): FrameSample {
  const total = width * height;
  let sum = 0;
  let sumSquares = 0;
  let ink = 0;
  for (let i = 0; i < total; i++) {
    const offset = i * 4;
    const luma = 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
    sum += luma;
    sumSquares += luma * luma;
    if (luma > 96) ink++;
  }
  const mean = total > 0 ? sum / total : 0;
  const variance = total > 0 ? Math.max(0, sumSquares / total - mean * mean) : 0;

  const signature: number[] = [];
  for (let row = 0; row < signatureRows; row++) {
    for (let col = 0; col < signatureCols; col++) {
      const x = Math.min(width - 1, Math.floor(((col + 0.5) / signatureCols) * width));
      const y = Math.min(height - 1, Math.floor(((row + 0.5) / signatureRows) * height));
      const offset = (y * width + x) * 4;
      signature.push(0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]);
    }
  }

  return {
    at,
    width,
    height,
    mean,
    stddev: Math.sqrt(variance),
    inkFraction: total > 0 ? ink / total : 0,
    signature
  };
}

/** Mean absolute luma difference between two sampled frames (0 = identical). */
export function frameDifference(a: FrameSample, b: FrameSample): number {
  const length = Math.min(a.signature.length, b.signature.length);
  if (length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Math.abs(a.signature[i] - b.signature[i]);
  return sum / length;
}

export type ValidationInput = {
  profile: OutputProfile;
  expectedFrames: number;
  bytes: number;
  head: Buffer;
  media: MediaInfo | null;
  decodedFrames: number;
  samples: FrameSample[];
  decodeError?: string;
};

const MIN_STDDEV = 4;
const MIN_INK = 0.004;
const MIN_FRAME_DIFFERENCE = 1.5;

/** Assembles the automated checks for one rendered file. */
export function assessRender(input: ValidationInput): RenderValidation {
  const { profile, expectedFrames, bytes, head, media, decodedFrames, samples } = input;
  const checks: RenderCheck[] = [];
  const push = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });

  const isMp4 = head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp';
  push('file', 'Output file exists', bytes > 0, bytes > 0 ? `${(bytes / MB).toFixed(2)} MB` : 'the file is empty');
  push('container', 'MP4 container', isMp4, isMp4 ? 'ftyp box present' : 'the file is not an MP4 container');
  push('codec', 'H.264 video', media?.codec === 'h264', media ? media.codec || 'unknown codec' : 'no video stream found');
  push(
    'pixel_format',
    'yuv420p pixel format',
    media?.pixelFormat === 'yuv420p',
    media?.pixelFormat ? media.pixelFormat : 'unreported'
  );
  push(
    'resolution',
    `Resolution ${profile.width}×${profile.height}`,
    media?.width === profile.width && media?.height === profile.height,
    media ? `${media.width}×${media.height}` : 'unreported'
  );
  push(
    'even',
    'Even dimensions for H.264',
    Boolean(media && media.width % 2 === 0 && media.height % 2 === 0),
    media ? `${media.width}×${media.height}` : 'unreported'
  );
  push(
    'audio',
    'Silent video (no audio track)',
    media ? !media.hasAudio : false,
    media ? (media.hasAudio ? 'an audio stream is present' : 'no audio stream') : 'unreported'
  );

  const expectedSeconds = expectedFrames / profile.fps;
  const tolerance = durationToleranceSeconds(profile.fps);

  // A file can have the right duration and resolution while carrying almost no
  // image data: a 20s 4K clip at 0.36 MB is ~0.14 Mbit/s and visibly mushy. The
  // floor scales with the pixel count so 4K is held to a higher bar than HD.
  const bitrateMbps = expectedSeconds > 0 ? (bytes * 8) / expectedSeconds / 1e6 : 0;
  const pixelRatio = (profile.width * profile.height) / (1080 * 1920);
  // Flat motion graphics compress well, but a file this far under the floor is
  // mush rather than stylised: HD needs 0.55 Mbit/s, 4K 2.2 Mbit/s.
  const minMbps = Math.max(0.2, pixelRatio * 0.55);
  push(
    'bitrate',
    `Bitrate ≥ ${minMbps.toFixed(1)} Mbit/s`,
    bitrateMbps >= minMbps,
    `${bitrateMbps.toFixed(2)} Mbit/s in ${(bytes / MB).toFixed(2)} MB over ${expectedSeconds.toFixed(1)}s`
  );

  push(
    'duration',
    `Duration ${expectedSeconds.toFixed(2)}s ±1 frame`,
    Boolean(media) && Math.abs(media!.durationSeconds - expectedSeconds) <= tolerance,
    media ? `${media.durationSeconds.toFixed(3)}s (expected ${expectedSeconds.toFixed(3)}s)` : 'unreported'
  );
  push(
    'frames',
    `Frame count ${expectedFrames}`,
    decodedFrames === expectedFrames,
    input.decodeError
      ? `decode failed: ${input.decodeError}`
      : `${decodedFrames} frames decoded`
  );

  const blankSamples = samples.filter((sample) => sample.stddev < MIN_STDDEV || sample.inkFraction < MIN_INK);
  push(
    'samples',
    'Sampled frames are not blank',
    samples.length >= 3 && blankSamples.length === 0,
    samples.length === 0
      ? 'no frames could be sampled'
      : blankSamples.length === 0
        ? `${samples.length} frames sampled at ${samples.map((sample) => `${sample.at.toFixed(1)}s`).join(', ')}`
        : `blank or near-blank frame at ${blankSamples.map((sample) => `${sample.at.toFixed(1)}s`).join(', ')}`
  );

  let minDifference = Number.POSITIVE_INFINITY;
  for (let i = 1; i < samples.length; i++) {
    minDifference = Math.min(minDifference, frameDifference(samples[i - 1], samples[i]));
  }
  push(
    'motion',
    'Video is animated, not a still image',
    samples.length >= 2 && minDifference >= MIN_FRAME_DIFFERENCE,
    samples.length < 2
      ? 'not enough frames to compare'
      : `smallest difference between sampled frames ${Number.isFinite(minDifference) ? minDifference.toFixed(2) : '—'}`
  );

  const humanReview = [
    'Text legibility on a phone screen: step through the sampled frames at 100%.',
    'Educational accuracy: confirm the explanation matches the verified trace.',
    'Platform requirements: safe margins, caption length and the destination app’s upload limits.'
  ];

  return {
    ok: checks.every((check) => check.ok),
    media,
    checks,
    humanReview,
    samples,
    validatedAt: new Date().toISOString()
  };
}

export function parseValidation(raw: string | null | undefined): RenderValidation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RenderValidation;
    return parsed && Array.isArray(parsed.checks) ? parsed : null;
  } catch {
    return null;
  }
}
