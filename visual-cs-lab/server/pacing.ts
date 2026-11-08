/**
 * How long a video should be, measured from its own content.
 *
 * A lesson is not cut to a fixed slot. Every beat is authored in seconds of
 * screen time, the trace earns one readable beat per verified step, and the
 * narration and captions are measured against the pace a person actually reads
 * and listens at. The longest of those demands sets the length, so a
 * two-comparison search is short, a fifteen-step traversal is long, and no beat
 * is ever squeezed to hit a round number.
 */

export type PacingBasis = {
  /** Total length of the video, branded opening and closing included. */
  seconds: number;
  /** Time the animated work itself needs. */
  beatSeconds: number;
  /** Time the narration and the on-screen copy need to be read and heard. */
  copySeconds: number;
  narrationSeconds: number;
  readSeconds: number;
  bookendSeconds: number;
  /** The demand that set the length. */
  drivenBy: 'animation' | 'narration' | 'reading';
};

/** Words a narrator says per second (≈145 wpm). */
export const SPEECH_WORDS_PER_SECOND = 2.4;

/** Words on screen a viewer comfortably reads per second. */
export const READ_WORDS_PER_SECOND = 3.6;

/** A video is never shorter than a hook, a lesson and a closing allow. */
export const MIN_SECONDS = 20;

/** An upper guard: a runaway trace is reported, never rendered for minutes. */
export const MAX_SECONDS = 180;

/**
 * Dwell each verified step keeps on screen, per animation kind.
 *
 * These are the whole point of content-driven length: the trace beat is sized
 * from the number of verified steps instead of being a fixed block, so a long
 * trace is not animated at double speed to fit 45 seconds.
 */
export const STEP_SECONDS: Record<'stack' | 'binary-search' | 'array' | 'linked-list' | 'structure', number> = {
  stack: 3.4,
  'binary-search': 3.4,
  array: 3.0,
  'linked-list': 3.2,
  structure: 3.0
};

export function wordCount(text: string): number {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Seconds the narration takes at a natural speaking pace, plus a short breath. */
export function speechSeconds(text: string): number {
  const count = wordCount(text);
  return count === 0 ? 0 : count / SPEECH_WORDS_PER_SECOND + 0.6;
}

/** Seconds a viewer needs to read the copy that shares the frame with the animation. */
export function readSeconds(text: string): number {
  const count = wordCount(text);
  return count === 0 ? 0 : count / READ_WORDS_PER_SECOND;
}

/**
 * The length the content asks for.
 *
 * `beats` is the sum of the authored beat seconds, `copy` every line that shares
 * the frame with the animation. Narration and reading are not added to the
 * animation — they run together — so the largest demand wins.
 */
export function contentDuration(input: {
  beats: number;
  narration?: string;
  copy: string[];
  bookendsMs: number;
}): PacingBasis {
  const bookendSeconds = Math.max(0, input.bookendsMs) / 1000;
  const narrationSeconds = speechSeconds(input.narration || '');
  const read = readSeconds(input.copy.filter(Boolean).join(' '));
  const copySeconds = Math.max(narrationSeconds, read);
  const beatSeconds = Math.max(0, input.beats);

  const demand = Math.max(beatSeconds, copySeconds);
  const drivenBy: PacingBasis['drivenBy'] =
    demand === beatSeconds ? 'animation' : read >= narrationSeconds ? 'reading' : 'narration';

  const raw = demand + bookendSeconds;
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.ceil(raw)));

  return {
    seconds,
    beatSeconds: Math.round(beatSeconds * 10) / 10,
    copySeconds: Math.round(copySeconds * 10) / 10,
    narrationSeconds: Math.round(narrationSeconds * 10) / 10,
    readSeconds: Math.round(read * 10) / 10,
    bookendSeconds: Math.round(bookendSeconds * 10) / 10,
    drivenBy
  };
}

/**
 * Keeps a media title honest about the length it actually publishes at
 * ("Stacks in 45 Seconds" → "Stacks in 39 Seconds").
 */
export function retitleForDuration(title: string, seconds: number): string {
  const value = Math.round(seconds);
  if (!Number.isFinite(value) || value <= 0) return title;
  return String(title || '').replace(
    /\bin\s+\d+\s+(seconds)\b/gi,
    (_match, word: string) => `in ${value} ${word}`
  );
}
